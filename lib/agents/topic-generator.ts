/**
 * AI 글목록 자동 생성 에이전트.
 *
 * 발행 완료 글을 분석해서 다음 계획 토픽 5개를 만들고
 * 네이버 검색, 질문, 카페, 트렌드 신호를 함께 반영한다.
 */

import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
import { naverKeywordResearch } from "@/lib/skills/naver-keyword-research";
import { naverCafeSearch, naverKinSearch } from "@/lib/skills/naver-community-research";
import { hasOpenAIKey, requestOpenAIJson } from "@/lib/openai/responses";
import type { PostingRecord, Topic, TopicSeriesDetailPlan } from "@/lib/types/github-data";
import {
  ALLOWED_LOCALITY_TERMS,
  BLOCKED_OUTSIDE_LOCALITY_TERMS,
  buildPolicyPromptSection,
  filterBlockedTopics,
} from "./blog-workflow-policy";
import { PRIMARY_LOCALITY_PRIORITY, SECONDARY_LOCALITY_PRIORITY } from "./locality-keyword-agent";

export interface TopicGeneratorInput {
  userId: string;
  publishedTopics: Topic[];
  publishedPosts?: PostingRecord[];
  onProgress?: (msg: string) => void;
}

export interface PrePostingSeriesInput {
  userId: string;
  mainKeyword: string;
  preludeCount?: number;
}

export type SeriesWorkflowRole =
  | "preheat_criteria"
  | "preheat_experience"
  | "preheat_consulting"
  | "main_hub"
  | "followup";

export interface SeriesWorkflowPlannerInput {
  userId: string;
  targetTopic: string;
  targetKeyword: string;
  region?: string;
  productGroup?: string;
  targetUser?: string;
  preferredBlog?: "A" | "B" | "C" | "D" | "E" | null;
  existingTopics?: Topic[];
  existingPosts?: PostingRecord[];
}

export interface SeriesDetailPlannerInput {
  userId: string;
  mainKeyword: string;
  seriesTopics: Topic[];
}

export interface GeneratedTopic {
  topicId?: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  contentKind?: "hub" | "leaf";
  seriesId?: string;
  seriesRole?: "prelude" | "main";
  targetMainKeyword?: string;
  sequenceOrder?: number;
  prerequisiteTopicIds?: string[];
  rationale: string;
}

export interface TopicGeneratorOutput {
  generatedTopics: GeneratedTopic[];
  researchKeyword: string;
  competitionInfo: string;
}

export interface SeriesPostPlan {
  sequence: 1 | 2 | 3 | 4 | 5;
  role: SeriesWorkflowRole;
  title: string;
  mainKeyword: string;
  subKeywords: string[];
  searchIntent: string;
  hubLeafType: "hub" | "leaf";
  recommendedBlog: "A" | "B" | "C" | "D" | "E";
  purpose: string;
  outline: string[];
  internalLinkDirection: string;
  internalLinkSentence: string;
  cannibalizationRisk: "low" | "medium" | "high";
  riskReason: string;
  keywordDistanceScore: number;
}

export interface KeywordSafetyReport {
  reservedMainKeyword: string;
  duplicateTitlePrefixCount: number;
  exactMainKeywordUsedInPreheats: number;
  keywordDistanceScore: number;
  cannibalizationRisk: "low" | "medium" | "high";
  recommendations: string[];
}

export interface SeriesValidationChecklist {
  mainKeywordReservedForMainPost: boolean;
  preheatKeywordsAreDistributed: boolean;
  searchIntentIsDifferentEachPost: boolean;
  mainPostIsHub: boolean;
  preheatPostsAreLeaf: boolean;
  followupConnectsAfterMain: boolean;
  internalLinksAreDesigned: boolean;
  existingIndexChecked: boolean;
  existingPostHistoryChecked: boolean;
  cannibalizationRiskAcceptable: boolean;
}

export interface SeriesWorkflowOutput {
  seriesId: string;
  targetTopic: string;
  reservedMainKeyword: string;
  seriesPurpose: string;
  internalLinkStructure: string;
  keywordSafetyReport: KeywordSafetyReport;
  validationChecklist: SeriesValidationChecklist;
  generatedTopics: GeneratedTopic[];
  seriesPlans: SeriesPostPlan[];
  replacementTopicText: string;
}

export interface SeriesDetailPlannerOutput {
  seriesId: string;
  mainKeyword: string;
  plannedTopics: Array<{
    topicId: string;
    title: string;
    seriesRole: "prelude" | "main";
    sequenceOrder: number;
    detailPlan: TopicSeriesDetailPlan;
  }>;
}

function slugifyKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "keyword";
}

const DEFAULT_SERIES_BLOG_MAP: Record<SeriesWorkflowRole, Array<"A" | "B" | "C" | "D" | "E">> = {
  preheat_criteria: ["C", "E"],
  preheat_experience: ["C", "D"],
  preheat_consulting: ["B", "E"],
  main_hub: ["A", "B"],
  followup: ["E", "B", "D"],
};

function compactTitleForSeries(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function sharedPrefixLength(left: string, right: string): number {
  const a = left.normalize("NFKC");
  const b = right.normalize("NFKC");
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

function _tokenizeKeyword(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .map((token) => token.trim())
    .filter(Boolean);
}

function uniqueList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function chooseRecommendedBlog(
  role: SeriesWorkflowRole,
  preferredBlog?: "A" | "B" | "C" | "D" | "E" | null
): "A" | "B" | "C" | "D" | "E" {
  const candidates = DEFAULT_SERIES_BLOG_MAP[role];
  if (preferredBlog && candidates.includes(preferredBlog)) return preferredBlog;
  return candidates[0];
}

function deriveKeywordCore(targetKeyword: string): string {
  return derivePreludeTopicPhrase(targetKeyword)
    .replace(/\s+/g, " ")
    .trim();
}

function _buildSeriesKeywordCandidates(input: SeriesWorkflowPlannerInput): {
  criteriaKeyword: string;
  experienceKeyword: string;
  consultingKeyword: string;
  followupKeyword: string;
  supportKeywords: string[];
} {
  const core = deriveKeywordCore(input.targetKeyword);
  const hasMtl = /입호흡/u.test(input.targetKeyword);
  const product = input.productGroup?.trim() || (hasMtl ? "입호흡" : core.split(" ")[0] || "전자담배");

  const criteriaKeyword = /고르는법/u.test(core) ? core : `${product} 고르는법`;
  const experienceKeyword = hasMtl ? "입호흡 흡입압" : `${product} 사용감`;
  const consultingKeyword = hasMtl ? "전담 입문자" : `${product} 처음`;
  const followupKeyword = hasMtl ? "입호흡 액상 선택" : `${product} 관리법`;

  const supportKeywords = uniqueList([
    input.targetKeyword,
    `${product} 입문자`,
    `${product} 선택 기준`,
    input.region ? `${input.region} ${product}` : "",
    input.targetUser ? `${input.targetUser} ${product}` : "",
  ]);

  return {
    criteriaKeyword,
    experienceKeyword,
    consultingKeyword,
    followupKeyword,
    supportKeywords,
  };
}

function _buildInternalLinkSentence(params: {
  fromRole: SeriesWorkflowRole;
  mainTitle: string;
  criteriaTitle: string;
  followupTitle: string;
}): string {
  switch (params.fromRole) {
    case "preheat_criteria":
    case "preheat_experience":
    case "preheat_consulting":
      return `기준을 먼저 정리했다면, 다음 글에서는 이 기준을 바탕으로 ${params.mainTitle} 흐름을 이어서 확인해보겠습니다.`;
    case "main_hub":
      return `기기를 고른 뒤에도 만족도가 갈린다면, 다음 단계는 ${params.followupTitle} 글까지 함께 보는 것입니다.`;
    case "followup":
      return `아직 기기 선택이 끝나지 않았다면, 먼저 ${params.mainTitle} 글부터 확인한 뒤 다시 이 내용을 보면 더 이해가 쉽습니다.`;
  }
}

function _buildSeriesOutline(role: SeriesWorkflowRole): string[] {
  switch (role) {
    case "preheat_criteria":
      return [
        "처음부터 제품명으로 고르면 실패하는 이유",
        "연초와 비슷한 흡입감을 원하는지 확인하기",
        "관리 난이도와 유지비를 먼저 보는 기준",
        "기준이 정리된 뒤 추천 글을 봐야 하는 이유",
      ];
    case "preheat_experience":
      return [
        "같은 제품인데 만족도가 갈리는 이유",
        "흡입압·타격감·목넘김 차이 정리",
        "체감이 맞지 않을 때 생기는 불편",
        "추천 글에서 무엇을 중점적으로 봐야 하는지",
      ];
    case "preheat_consulting":
      return [
        "입문자가 매장에서 가장 많이 헷갈리는 질문",
        "예산·관리·호환성에서 먼저 물어볼 것",
        "상담 전에 정리하면 좋은 본인 기준",
        "추천 허브 글로 이어지는 체크리스트",
      ];
    case "main_hub":
      return [
        "입문자 기준으로 실패를 줄이는 전제 정리",
        "선행 글에서 다룬 기준 요약",
        "사용자 유형별 선택 포인트",
        "실제 추천 후보를 읽는 기준",
      ];
    case "followup":
      return [
        "기기 선택 뒤 만족도가 갈리는 이유",
        "액상·관리·세팅에서 다시 보는 기준",
        "구매 후 자주 겪는 불만 정리",
        "다시 본편으로 돌아가 봐야 할 조건",
      ];
  }
}

function _inferSearchIntent(role: SeriesWorkflowRole): string {
  switch (role) {
    case "preheat_criteria":
      return "추천 제품을 보기 전에 선택 기준을 알고 싶은 정보형 의도";
    case "preheat_experience":
      return "같은 제품인데 체감이 다른 이유를 알고 싶은 문제 인식형 의도";
    case "preheat_consulting":
      return "처음 구매 전 무엇을 물어봐야 할지 모르는 상담형 의도";
    case "main_hub":
      return "최종 선택을 위해 추천 후보를 비교하고 싶은 구매검토형 의도";
    case "followup":
      return "구매 후 만족도와 실패 요인을 줄이고 싶은 후속 관리형 의도";
  }
}

function _inferPurpose(role: SeriesWorkflowRole): string {
  switch (role) {
    case "preheat_criteria":
      return "본편 추천 글 전에 판단 기준을 만들어주는 예열글";
    case "preheat_experience":
      return "사용감 차이를 설명해 본편 추천 기준을 강화하는 예열글";
    case "preheat_consulting":
      return "구매 전 질문을 정리하고 본편 추천 글로 연결하는 예열글";
    case "main_hub":
      return "예열글 3편을 받아 사용자 유형별 추천으로 전환하는 중심 허브";
    case "followup":
      return "본편 이후 만족도 문제를 보완하고 역링크를 거는 후속글";
  }
}

function inferRiskLevel(distanceScore: number): "low" | "medium" | "high" {
  if (distanceScore >= 80) return "low";
  if (distanceScore >= 60) return "medium";
  return "high";
}

function buildReplacementTopicText(userId: string, plans: SeriesPostPlan[]): string {
  return plans
    .map((plan) => `${plan.recommendedBlog}|${userId}|${plan.title}`)
    .join("\n");
}

function buildCleanSeriesKeywordCandidates(input: SeriesWorkflowPlannerInput): {
  criteriaKeyword: string;
  experienceKeyword: string;
  consultingKeyword: string;
  followupKeyword: string;
  supportKeywords: string[];
} {
  const core = deriveKeywordCore(input.targetKeyword);
  const hasMtl = /입호흡/u.test(input.targetKeyword);
  const product = input.productGroup?.trim() || (hasMtl ? "입호흡 전자담배" : core.split(" ")[0] || "전자담배");

  return {
    criteriaKeyword: /고르는법|선택 기준/u.test(core) ? core : `${product} 고르는법`,
    experienceKeyword: hasMtl ? "입호흡 흡입압" : `${product} 사용감`,
    consultingKeyword: hasMtl ? "전담 입문자" : `${product} 처음`,
    followupKeyword: hasMtl ? "입호흡 액상 선택" : `${product} 관리법`,
    supportKeywords: uniqueList([
      input.targetKeyword,
      `${product} 입문자`,
      `${product} 선택 기준`,
      input.region ? `${input.region} ${product}` : "",
      input.targetUser ? `${input.targetUser} ${product}` : "",
    ]),
  };
}

function buildCleanInternalLinkSentence(params: {
  fromRole: SeriesWorkflowRole;
  mainTitle: string;
  followupTitle: string;
}): string {
  switch (params.fromRole) {
    case "preheat_criteria":
    case "preheat_experience":
    case "preheat_consulting":
      return `기준을 먼저 정리했다면, 다음 글에서는 이 기준을 바탕으로 ${params.mainTitle} 흐름을 이어서 확인해보겠습니다.`;
    case "main_hub":
      return `기기를 고른 뒤에도 만족도가 갈린다면, 다음 단계는 ${params.followupTitle} 글까지 함께 보는 것입니다.`;
    case "followup":
      return `아직 기기 선택이 끝나지 않았다면, 먼저 ${params.mainTitle} 글부터 확인한 뒤 다시 보는 편이 이해가 쉽습니다.`;
  }
}

function buildCleanSeriesOutline(role: SeriesWorkflowRole): string[] {
  switch (role) {
    case "preheat_criteria":
      return [
        "처음부터 제품명으로 고르면 실패하는 이유",
        "연초와 비슷한 흡입감을 원하는지 확인하기",
        "관리가 쉬운 기기를 원하는지 먼저 보기",
        "기준이 정리된 뒤 추천 글을 봐야 하는 이유",
      ];
    case "preheat_experience":
      return [
        "같은 제품인데 만족감이 갈리는 이유",
        "흡입압과 목넘김 차이 정리",
        "체감이 맞지 않을 때 생기는 불편",
        "추천 글에서 무엇을 중점으로 봐야 하는지",
      ];
    case "preheat_consulting":
      return [
        "입문자가 매장에서 가장 많이 헷갈리는 질문",
        "예산과 관리 편의성에서 먼저 물어볼 것",
        "상담 전에 정리하면 좋은 본인 기준",
        "추천 허브 글로 이어지는 체크리스트",
      ];
    case "main_hub":
      return [
        "입문자 기준으로 실패를 줄이는 추천 기준 정리",
        "예열글에서 다룬 판단 기준 요약",
        "사용자 유형별 선택 포인트",
        "실제 추천 후보를 좁히는 기준",
      ];
    case "followup":
      return [
        "기기를 골랐는데 만족감이 갈리는 이유",
        "액상과 관리, 세팅에서 다시 보는 기준",
        "구매 후 자주 겪는 불만 정리",
        "다시 본편으로 돌아가 점검할 조건",
      ];
  }
}

function inferCleanSearchIntent(role: SeriesWorkflowRole): string {
  switch (role) {
    case "preheat_criteria":
      return "추천 제품을 보기 전에 선택 기준을 알고 싶은 정보형 의도";
    case "preheat_experience":
      return "같은 제품인데 체감이 다른 이유를 알고 싶은 문제 인식형 의도";
    case "preheat_consulting":
      return "처음 구매 전 무엇을 물어봐야 할지 모르는 상담형 의도";
    case "main_hub":
      return "최종 선택을 위해 추천 후보를 비교하고 싶은 구매검토형 의도";
    case "followup":
      return "구매 후 만족도와 사용 문제를 줄이고 싶은 후속 관리형 의도";
  }
}

function inferCleanPurpose(role: SeriesWorkflowRole): string {
  switch (role) {
    case "preheat_criteria":
      return "본편 추천 글 전에 판단 기준을 먼저 만들어주는 예열글";
    case "preheat_experience":
      return "사용감 차이를 설명해 본편 추천 기준을 강화하는 예열글";
    case "preheat_consulting":
      return "구매 전 질문을 정리하고 본편 추천글로 연결하는 예열글";
    case "main_hub":
      return "예열글 3편을 받아 사용자 유형별 추천으로 전환하는 중심 허브";
    case "followup":
      return "본편 이후 만족도 문제를 보완하고 후속 고민을 받는 글";
  }
}

function derivePreludeTopicPhrase(mainKeyword: string): string {
  const normalized = mainKeyword.trim().replace(/\s+/g, " ");
  const suffixes = ["추천", "비교", "가격", "후기", "리뷰", "순위", "정리"];

  for (const suffix of suffixes) {
    if (normalized.endsWith(` ${suffix}`)) {
      return normalized.slice(0, -(suffix.length + 1)).trim();
    }
    if (normalized.endsWith(suffix) && normalized.length > suffix.length + 1) {
      return normalized.slice(0, -suffix.length).trim();
    }
  }

  return normalized;
}

function _buildPreludeTitles(mainKeyword: string, count: number): string[] {
  const keyword = derivePreludeTopicPhrase(mainKeyword);
  const templates = [
    `${keyword} 처음 볼 때 입호흡과 폐호흡 차이부터 정리`,
    `${keyword} 고르기 전에 보는 액상과 기기 기준`,
    `초보자가 ${keyword} 시작할 때 자주 놓치는 부분`,
  ];
  return templates.slice(0, count);
}

function derivePreludeAnchor(mainKeyword: string): string {
  const phrase = derivePreludeTopicPhrase(mainKeyword);
  const tokens = phrase.split(" ").filter(Boolean);
  return tokens.at(-1) ?? phrase;
}

function derivePreludePrimaryKeyword(mainKeyword: string, sequenceOrder: number): string {
  const base = derivePreludeTopicPhrase(mainKeyword);
  if (/입호흡/u.test(base) && sequenceOrder === 1) {
    return "입호흡 폐호흡 차이";
  }
  return base;
}

function buildDistributedPreludeTitles(mainKeyword: string, count: number): string[] {
  const keyword = derivePreludeTopicPhrase(mainKeyword);
  const anchor = derivePreludeAnchor(mainKeyword);
  const templates = [
    `${keyword} 보기 전에 핵심 개념부터 정리`,
    `${anchor} 고르기 전에 많이 보는 선택 기준`,
    `초보자가 ${anchor} 시작 전에 자주 놓치는 체크포인트`,
  ];
  return templates.slice(0, count);
}

export function runPrePostingSeriesPlanner(input: PrePostingSeriesInput): TopicGeneratorOutput {
  const mainKeyword = input.mainKeyword.trim().replace(/\s+/g, " ");
  if (!mainKeyword) {
    throw new Error("메인 키워드가 필요합니다.");
  }

  const preludeCount = Math.max(2, Math.min(4, input.preludeCount ?? 3));
  const seriesStamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const seriesId = `series-${slugifyKeyword(input.userId)}-${slugifyKeyword(mainKeyword)}-${seriesStamp}`;
  const plannedTopicIds = Array.from({ length: preludeCount + 1 }, (_, index) =>
    `topic-series-${seriesStamp}-${index + 1}`
  );
  const preludeTitles = buildDistributedPreludeTitles(mainKeyword, preludeCount);
  const preludeTopics: GeneratedTopic[] = preludeTitles.map((title, index) => ({
    topicId: plannedTopicIds[index],
    title,
    description: [
      `메인 키워드 "${mainKeyword}"를 바로 정면으로 쓰기 전에 검색자가 먼저 궁금해하는 하위 의도를 다룹니다.`,
      "본문에서는 메인 키워드를 억지 반복하지 않고 1~3회 자연스럽게 노출합니다.",
    ].join(" "),
    category: input.userId,
    tags: [mainKeyword, "선행포스팅", "키워드빌드업", index === 0 ? "개념정리" : index === 1 ? "선택기준" : "초보자가이드"],
    contentKind: "leaf",
    seriesId,
    seriesRole: "prelude",
    targetMainKeyword: mainKeyword,
    sequenceOrder: index + 1,
    prerequisiteTopicIds: [],
    rationale: "메인 추천 글의 주제권을 먼저 쌓기 위한 선행 포스팅입니다.",
  }));

  const mainTopic: GeneratedTopic = {
    topicId: plannedTopicIds[preludeCount],
    title: mainKeyword,
    description: [
      "선행 포스팅에서 쌓은 개념, 선택 기준, 초보자 질문을 묶어 메인 키워드를 정면으로 다루는 추천/정리 글입니다.",
      "메인 글 발행 전 같은 시리즈의 선행 포스팅이 먼저 발행되어야 합니다.",
    ].join(" "),
    category: input.userId,
    tags: [mainKeyword, "추천", "메인포스팅", "키워드시리즈"],
    contentKind: "hub",
    seriesId,
    seriesRole: "main",
    targetMainKeyword: mainKeyword,
    sequenceOrder: preludeCount + 1,
    prerequisiteTopicIds: plannedTopicIds.slice(0, preludeCount),
    rationale: "선행 포스팅 이후 메인 키워드를 정면으로 공략하는 최종 글입니다.",
  };

  return {
    generatedTopics: [...preludeTopics, mainTopic],
    researchKeyword: mainKeyword,
    competitionInfo: `선행 ${preludeCount}개 + 메인 1개 시리즈 설계`,
  };
}

export function runSeriesWorkflowPlanner(input: SeriesWorkflowPlannerInput): SeriesWorkflowOutput {
  const targetKeyword = input.targetKeyword.trim().replace(/\s+/g, " ");
  const targetTopic = input.targetTopic.trim().replace(/\s+/g, " ") || targetKeyword;
  if (!targetKeyword) throw new Error("본편 목표 키워드가 필요합니다.");

  const seriesStamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const seriesId = `series-workflow-${slugifyKeyword(input.userId)}-${slugifyKeyword(targetKeyword)}-${seriesStamp}`;
  const { criteriaKeyword, experienceKeyword, consultingKeyword, followupKeyword, supportKeywords } =
    buildCleanSeriesKeywordCandidates(input);
  const mainAnchor = targetKeyword.replace(/\s*추천/u, "").trim() || targetKeyword;
  const regionPrefix = input.region?.trim() ? `${input.region.trim()} ` : "";
  const targetUserLabel = input.targetUser?.trim() || "입문자";

  const mainTitle = `${targetKeyword}, ${targetUserLabel} 기준으로 실패 적은 선택 흐름 정리`;
  const criteriaTitle = `${regionPrefix}${criteriaKeyword} 먼저 정리하고 봐야 하는 이유`;
  const experienceTitle = `${experienceKeyword}이 맞지 않으면 왜 만족도가 갈릴까`;
  const consultingTitle = `${consultingKeyword}가 구매 전에 가장 많이 헷갈리는 질문 정리`;
  const followupTitle = `${followupKeyword}을 다시 봐야 만족도가 갈리는 이유`;

  const plans: SeriesPostPlan[] = [
    {
      sequence: 1,
      role: "preheat_criteria",
      title: criteriaTitle,
      mainKeyword: criteriaKeyword,
      subKeywords: uniqueList([mainAnchor, ...supportKeywords.slice(1, 3)]),
      searchIntent: inferCleanSearchIntent("preheat_criteria"),
      hubLeafType: "leaf",
      recommendedBlog: chooseRecommendedBlog("preheat_criteria", input.preferredBlog),
      purpose: inferCleanPurpose("preheat_criteria"),
      outline: buildCleanSeriesOutline("preheat_criteria"),
      internalLinkDirection: "예열글 1 → 본편",
      internalLinkSentence: buildCleanInternalLinkSentence({ fromRole: "preheat_criteria", mainTitle, followupTitle }),
      cannibalizationRisk: "low",
      riskReason: "본편 추천 키워드를 직접 반복하지 않고 선택 기준 쪽으로 분산했습니다.",
      keywordDistanceScore: 88,
    },
    {
      sequence: 2,
      role: "preheat_experience",
      title: experienceTitle,
      mainKeyword: experienceKeyword,
      subKeywords: uniqueList([mainAnchor, "흡입감", "목넘김"]),
      searchIntent: inferCleanSearchIntent("preheat_experience"),
      hubLeafType: "leaf",
      recommendedBlog: chooseRecommendedBlog("preheat_experience", input.preferredBlog),
      purpose: inferCleanPurpose("preheat_experience"),
      outline: buildCleanSeriesOutline("preheat_experience"),
      internalLinkDirection: "예열글 2 → 본편",
      internalLinkSentence: buildCleanInternalLinkSentence({ fromRole: "preheat_experience", mainTitle, followupTitle }),
      cannibalizationRisk: "low",
      riskReason: "체감 문제를 설명하는 정보형 글이라 구매검토형 본편과 직접 충돌하지 않습니다.",
      keywordDistanceScore: 84,
    },
    {
      sequence: 3,
      role: "preheat_consulting",
      title: consultingTitle,
      mainKeyword: consultingKeyword,
      subKeywords: uniqueList([mainAnchor, "전자담배 처음", "매장 질문"]),
      searchIntent: inferCleanSearchIntent("preheat_consulting"),
      hubLeafType: "leaf",
      recommendedBlog: chooseRecommendedBlog("preheat_consulting", input.preferredBlog),
      purpose: inferCleanPurpose("preheat_consulting"),
      outline: buildCleanSeriesOutline("preheat_consulting"),
      internalLinkDirection: "예열글 3 → 본편",
      internalLinkSentence: buildCleanInternalLinkSentence({ fromRole: "preheat_consulting", mainTitle, followupTitle }),
      cannibalizationRisk: "medium",
      riskReason: "상담형 의도라 전환 직전 검색과 맞닿아 있지만 본편 메인 키워드는 비워뒀습니다.",
      keywordDistanceScore: 72,
    },
    {
      sequence: 4,
      role: "main_hub",
      title: mainTitle,
      mainKeyword: targetKeyword,
      subKeywords: uniqueList([`${mainAnchor} 추천`, `${mainAnchor} 기기`, "전자담배 추천"]),
      searchIntent: inferCleanSearchIntent("main_hub"),
      hubLeafType: "hub",
      recommendedBlog: chooseRecommendedBlog("main_hub", input.preferredBlog),
      purpose: inferCleanPurpose("main_hub"),
      outline: buildCleanSeriesOutline("main_hub"),
      internalLinkDirection: "예열글 1/2/3 → 본편 → 후속글",
      internalLinkSentence: buildCleanInternalLinkSentence({ fromRole: "main_hub", mainTitle, followupTitle }),
      cannibalizationRisk: "medium",
      riskReason: "본편은 메인 키워드를 예약해 가져가므로 예열글보다 더 강한 허브 신호가 필요합니다.",
      keywordDistanceScore: 65,
    },
    {
      sequence: 5,
      role: "followup",
      title: followupTitle,
      mainKeyword: followupKeyword,
      subKeywords: uniqueList([mainAnchor, "관리법", "만족도"]),
      searchIntent: inferCleanSearchIntent("followup"),
      hubLeafType: "leaf",
      recommendedBlog: chooseRecommendedBlog("followup", input.preferredBlog),
      purpose: inferCleanPurpose("followup"),
      outline: buildCleanSeriesOutline("followup"),
      internalLinkDirection: "본편 → 후속글 / 후속글 → 본편",
      internalLinkSentence: buildCleanInternalLinkSentence({ fromRole: "followup", mainTitle, followupTitle }),
      cannibalizationRisk: "low",
      riskReason: "구매 후 만족도와 관리 흐름으로 비켜서 본편의 추천 의도를 보호합니다.",
      keywordDistanceScore: 82,
    },
  ];

  const existingTopics = input.existingTopics ?? [];
  const existingPosts = input.existingPosts ?? [];
  const reservedMainKeyword = targetKeyword;
  const exactMainKeywordUsedInPreheats = plans
    .slice(0, 3)
    .filter((plan) => plan.mainKeyword === reservedMainKeyword || plan.title.includes(reservedMainKeyword))
    .length;
  const duplicateTitlePrefixCount = plans.reduce((count, plan, index) => {
    const rest = plans.slice(index + 1);
    return count + rest.filter((candidate) => sharedPrefixLength(plan.title, candidate.title) >= 10).length;
  }, 0);
  const averageDistance = Math.round(plans.reduce((sum, plan) => sum + plan.keywordDistanceScore, 0) / plans.length);
  const existingConflicts = plans.flatMap((plan) => {
    const compact = compactTitleForSeries(plan.title);
    const matchedTopic = existingTopics.find((topic) => compactTitleForSeries(topic.title) === compact);
    const matchedPost = existingPosts.find((post) => compactTitleForSeries(post.title) === compact);
    return [matchedTopic?.title, matchedPost?.title].filter(Boolean) as string[];
  });
  const keywordDistanceScore = Math.max(
    0,
    averageDistance - duplicateTitlePrefixCount * 12 - exactMainKeywordUsedInPreheats * 20 - existingConflicts.length * 10
  );
  const keywordSafetyRisk = inferRiskLevel(keywordDistanceScore);

  const keywordSafetyReport: KeywordSafetyReport = {
    reservedMainKeyword,
    duplicateTitlePrefixCount,
    exactMainKeywordUsedInPreheats,
    keywordDistanceScore,
    cannibalizationRisk: keywordSafetyRisk,
    recommendations: uniqueList([
      duplicateTitlePrefixCount > 0 ? "예열글 제목 시작 패턴이 겹치지 않도록 다시 분산하는 편이 좋습니다." : "",
      exactMainKeywordUsedInPreheats > 0 ? "예열글에서는 본편 메인 키워드를 제목 앞쪽에 직접 쓰지 마세요." : "",
      existingConflicts.length > 0 ? `기존 글과 유사한 제목이 있어 분리 필요: ${existingConflicts.join(", ")}` : "",
      keywordSafetyRisk === "low" ? "현재 구조는 본편 키워드를 보호하면서 주변 유입을 모으는 데 무리가 없습니다." : "",
    ]),
  };

  const validationChecklist: SeriesValidationChecklist = {
    mainKeywordReservedForMainPost: exactMainKeywordUsedInPreheats === 0,
    preheatKeywordsAreDistributed: new Set(plans.slice(0, 3).map((plan) => plan.mainKeyword)).size === 3,
    searchIntentIsDifferentEachPost: new Set(plans.map((plan) => plan.searchIntent)).size === plans.length,
    mainPostIsHub: plans[3].hubLeafType === "hub",
    preheatPostsAreLeaf: plans.slice(0, 3).every((plan) => plan.hubLeafType === "leaf"),
    followupConnectsAfterMain: plans[4].internalLinkDirection.includes("본편"),
    internalLinksAreDesigned: plans.every((plan) => !!plan.internalLinkSentence.trim()),
    existingIndexChecked: true,
    existingPostHistoryChecked: true,
    cannibalizationRiskAcceptable: keywordSafetyReport.cannibalizationRisk !== "high",
  };

  const plannedTopicIds = plans.map((_, index) => `topic-series-workflow-${seriesStamp}-${index + 1}`);
  const generatedTopics: GeneratedTopic[] = plans.map((plan, index) => {
    const isMain = plan.role === "main_hub";
    const isPrelude = plan.role.startsWith("preheat");
    return {
      topicId: plannedTopicIds[index],
      title: plan.title,
      description: `${plan.purpose} 검색의도: ${plan.searchIntent}`,
      category: `${plan.recommendedBlog} blog`,
      tags: uniqueList([plan.mainKeyword, ...plan.subKeywords].slice(0, 6)),
      contentKind: plan.hubLeafType,
      seriesId,
      seriesRole: isMain ? "main" : isPrelude ? "prelude" : undefined,
      targetMainKeyword: reservedMainKeyword,
      sequenceOrder: plan.sequence,
      prerequisiteTopicIds: isMain ? plannedTopicIds.slice(0, 3) : [],
      rationale: `${plan.purpose} / 내부링크: ${plan.internalLinkDirection}`,
    };
  });

  return {
    seriesId,
    targetTopic,
    reservedMainKeyword,
    seriesPurpose: `${reservedMainKeyword} 본편 키워드를 보호하면서 예열글 3편과 후속글 1편으로 검색자 여정을 분산 설계합니다.`,
    internalLinkStructure: "예열글 1·2·3 → 본편 / 본편 → 후속글 / 후속글 → 본편",
    keywordSafetyReport,
    validationChecklist,
    generatedTopics,
    seriesPlans: plans.map((plan) => ({
      ...plan,
      cannibalizationRisk: plan.role === "main_hub" ? keywordSafetyReport.cannibalizationRisk : plan.cannibalizationRisk,
      riskReason:
        plan.role === "main_hub" && existingConflicts.length > 0
          ? `${plan.riskReason} 기존 유사 제목: ${existingConflicts.join(", ")}`
          : plan.riskReason,
    })),
    replacementTopicText: buildReplacementTopicText(input.userId, plans),
  };
}

function buildPreludeDetailPlan(params: {
  title: string;
  mainKeyword: string;
  sequenceOrder: number;
  internalLinkTitles: string[];
}): TopicSeriesDetailPlan {
  const primaryKeyword = derivePreludePrimaryKeyword(params.mainKeyword, params.sequenceOrder);
  const stageLabel =
    params.sequenceOrder === 1
      ? "기본 개념과 차이를 먼저 잡아주는 글"
      : params.sequenceOrder === 2
        ? "선택 기준과 실사용 판단 포인트를 잡아주는 글"
        : "초보자가 실제로 헷갈리는 상황을 정리해 주는 글";

  return {
    articleGoal: `${params.mainKeyword}를 바로 추천하기 전에 ${stageLabel}`,
    searchIntent:
      params.sequenceOrder === 1
        ? "비교형/기초이해형"
        : params.sequenceOrder === 2
          ? "선택기준형"
          : "문제해결형/초보자가이드형",
    readerQuestion:
      params.sequenceOrder === 1
        ? `${params.mainKeyword}를 보기 전에 입호흡/폐호흡이나 기초 개념부터 정리해야 하나?`
        : params.sequenceOrder === 2
          ? `${params.mainKeyword}를 보기 전에 어떤 기준으로 기기와 액상을 골라야 하나?`
          : `${params.mainKeyword}를 볼 때 초보자가 실제로 많이 놓치는 부분은 무엇인가?`,
    primaryKeyword,
    secondaryKeywords: [params.mainKeyword].filter(Boolean),
    recommendedSections: [
      "검색자가 먼저 헷갈리는 상황 정리",
      "비교 또는 선택 기준 제시",
      "실수하기 쉬운 포인트 정리",
      "메인 글로 이어지는 마무리",
    ],
    keywordPlacementRules: [
      `${params.mainKeyword}는 제목 반복용이 아니라 본문 맥락에서 1~3회 자연스럽게 노출한다.`,
      "첫 문단에는 현재 고민 상황을 먼저 쓰고, 메인 키워드는 그 다음에 연결한다.",
      "결론에서는 메인 추천 글로 이어질 수 있게 다음 읽을 글을 제안한다.",
    ],
    internalLinkTitles: params.internalLinkTitles,
    callToAction: "비교 기준을 정리한 뒤 다음 글에서 실제 추천 모델을 확인하도록 연결한다.",
    draftAngle: "선행 포스팅 역할에 맞게 과장 없이 이해와 판단 기준을 먼저 제공한다.",
  };
}

function buildMainDetailPlan(params: {
  title: string;
  mainKeyword: string;
  internalLinkTitles: string[];
}): TopicSeriesDetailPlan {
  return {
    articleGoal: `${params.mainKeyword}를 정면으로 다루면서 선행 포스팅에서 쌓은 개념과 기준을 하나로 묶는다.`,
    searchIntent: "추천형/전환형",
    readerQuestion: `${params.mainKeyword}를 지금 고른다면 어떤 기준으로 어떤 옵션을 먼저 봐야 하나?`,
    primaryKeyword: params.mainKeyword,
    secondaryKeywords: [],
    recommendedSections: [
      "추천 글을 찾는 현재 상황과 전제 정리",
      "선행 글에서 다룬 기준 요약",
      "사용자 상황별 추천 구간 정리",
      "내부링크로 선행 글과 연결되는 비교/보충 섹션",
      "상담 또는 다음 행동으로 이어지는 마무리",
    ],
    keywordPlacementRules: [
      `${params.mainKeyword}는 제목, 도입부, 핵심 비교 섹션, 결론에 일관되게 유지한다.`,
      "선행 글과 중복 설명은 요약으로 줄이고, 추천 판단과 전환 요소에 분량을 더 쓴다.",
      "내부링크는 실제 선행 글 제목 기준으로 연결한다.",
    ],
    internalLinkTitles: params.internalLinkTitles,
    callToAction: "상황별로 무엇을 먼저 봐야 하는지 정리한 뒤 방문/상담/추가 비교로 자연스럽게 연결한다.",
    draftAngle: "메인 키워드를 중심으로 실제 선택을 도와주는 추천 글답게 판단 기준과 상황별 분기를 분명히 한다.",
  };
}

export function regenerateSingleTopicDetailPlan(params: {
  seriesRole: "prelude" | "main";
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  mainKeyword: string;
  sequenceOrder: number;
  internalLinkTitles: string[];
}): TopicSeriesDetailPlan {
  const manualPrimaryKeyword = params.primaryKeyword.trim();
  const effectiveMainKeyword =
    params.seriesRole === "main"
      ? manualPrimaryKeyword || params.mainKeyword
      : params.mainKeyword;
  const base =
    params.seriesRole === "main"
      ? buildMainDetailPlan({
          title: params.title,
          mainKeyword: effectiveMainKeyword,
          internalLinkTitles: params.internalLinkTitles,
        })
      : buildPreludeDetailPlan({
          title: params.title,
          mainKeyword: effectiveMainKeyword,
          sequenceOrder: Math.max(1, params.sequenceOrder),
          internalLinkTitles: params.internalLinkTitles,
        });

  return {
    ...base,
    primaryKeyword: manualPrimaryKeyword || base.primaryKeyword,
    secondaryKeywords:
      params.secondaryKeywords.length > 0 ? params.secondaryKeywords : base.secondaryKeywords,
  };
}

export function runSeriesDetailPlanner(input: SeriesDetailPlannerInput): SeriesDetailPlannerOutput {
  const sortedTopics = input.seriesTopics
    .slice()
    .sort((left, right) => (left.sequenceOrder ?? 0) - (right.sequenceOrder ?? 0));
  const seriesId = sortedTopics[0]?.seriesId;
  if (!seriesId || sortedTopics.length === 0) {
    throw new Error("상세 설계를 만들 시리즈 토픽을 찾지 못했습니다.");
  }

  const plannedTopics = sortedTopics.map((topic) => {
    const internalLinkTitles = sortedTopics
      .filter((candidate) => candidate.topicId !== topic.topicId)
      .map((candidate) => candidate.title);
    const detailPlan =
      topic.seriesRole === "main"
        ? buildMainDetailPlan({
            title: topic.title,
            mainKeyword: input.mainKeyword,
            internalLinkTitles,
          })
        : buildPreludeDetailPlan({
            title: topic.title,
            mainKeyword: input.mainKeyword,
            sequenceOrder: topic.sequenceOrder ?? 0,
            internalLinkTitles,
          });

    return {
      topicId: topic.topicId,
      title: topic.title,
      seriesRole: topic.seriesRole ?? "prelude",
      sequenceOrder: topic.sequenceOrder ?? 0,
      detailPlan,
    };
  });

  return {
    seriesId,
    mainKeyword: input.mainKeyword,
    plannedTopics,
  };
}

function describeTrendLabel(trend: "rising" | "steady" | "falling"): string {
  if (trend === "rising") return "상승";
  if (trend === "falling") return "하락";
  return "보합";
}

function postToTopic(post: PostingRecord): Topic {
  return {
    topicId: post.topicId || post.postId,
    title: post.title,
    description: "",
    category: post.userId,
    tags: [],
    feasibility: null,
    relatedSources: post.naverPostUrl ? [post.naverPostUrl] : [],
    status: "published",
    assignedUserId: post.userId,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function extractMainCategory(topics: Topic[]): string {
  const counts = new Map<string, number>();
  for (const topic of topics) {
    if (topic.category) counts.set(topic.category, (counts.get(topic.category) ?? 0) + 1);
  }
  if (counts.size === 0) return "general";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function extractRepresentativeKeyword(topics: Topic[]): string {
  const counts = new Map<string, number>();

  for (const topic of topics) {
    for (const tag of topic.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    const firstWord = topic.title.split(/\s+/)[0];
    if (firstWord.length >= 2) {
      counts.set(firstWord, (counts.get(firstWord) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    return topics[0]?.title.split(/\s+/)[0] ?? "블로그";
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function parseGeneratedTopics(text: string): GeneratedTopic[] {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  const raw = jsonMatch?.[1] ?? text;

  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (Array.isArray(parsed)) return parsed as GeneratedTopic[];

    const obj = parsed as { topics?: GeneratedTopic[] };
    if (Array.isArray(obj.topics)) return obj.topics;
  } catch {
    // The caller will surface generation failure.
  }

  return [];
}

function normalizeGeneratedTopic(topic: GeneratedTopic, fallbackCategory: string): GeneratedTopic {
  return {
    topicId: topic.topicId,
    title: topic.title?.trim() ?? "",
    description: topic.description?.trim() ?? "",
    category: topic.category?.trim() || fallbackCategory,
    tags: Array.isArray(topic.tags) ? topic.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 6) : [],
    contentKind: topic.contentKind === "hub" || topic.contentKind === "leaf" ? topic.contentKind : undefined,
    seriesId: topic.seriesId,
    seriesRole: topic.seriesRole === "prelude" || topic.seriesRole === "main" ? topic.seriesRole : undefined,
    targetMainKeyword: topic.targetMainKeyword,
    sequenceOrder: topic.sequenceOrder,
    prerequisiteTopicIds: Array.isArray(topic.prerequisiteTopicIds) ? topic.prerequisiteTopicIds : undefined,
    rationale: topic.rationale?.trim() ?? "",
  };
}

function formatDirectCommunitySignals(params: {
  cafeSummary?: string;
  kinSummary?: string;
  cafeTitles?: string[];
  kinTitles?: string[];
}): string {
  return [
    `Cafe demand summary: ${params.cafeSummary || "none"}`,
    `KnowledgeIn problem summary: ${params.kinSummary || "none"}`,
    `Cafe examples: ${params.cafeTitles?.join(" / ") || "none"}`,
    `KnowledgeIn examples: ${params.kinTitles?.join(" / ") || "none"}`,
  ].join("\n");
}

const OPENAI_TOPIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    topics: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          contentKind: { type: "string", enum: ["hub", "leaf"] },
          rationale: { type: "string" },
        },
        required: ["title", "description", "category", "tags", "contentKind", "rationale"],
      },
    },
  },
  required: ["topics"],
} as const;

export async function runTopicGenerator(input: TopicGeneratorInput): Promise<TopicGeneratorOutput> {
  const { userId, onProgress } = input;
  const publishedTopics = input.publishedTopics.length > 0
    ? input.publishedTopics
    : (input.publishedPosts ?? []).map(postToTopic);

  onProgress?.(`${publishedTopics.length}개 기존 발행 글 분석 중...`);

  const representativeKeyword = extractRepresentativeKeyword(publishedTopics);
  const mainCategory = extractMainCategory(publishedTopics);

  onProgress?.(`네이버 키워드 리서치 "${representativeKeyword}"`);
  const [research, cafeResearch, kinResearch] = await Promise.all([
    naverKeywordResearch({ keyword: representativeKeyword, display: 20 }),
    naverCafeSearch({ keyword: representativeKeyword, display: 15 }),
    naverKinSearch({ keyword: representativeKeyword, display: 15 }),
  ]);

  const competitionInfo = research.error
    ? "네이버 리서치 불가"
    : [
        `블로그 ${research.blog.competition} (${research.blog.total.toLocaleString()}건)`,
        `지식인 ${research.kin.total.toLocaleString()}건`,
        `카페 ${research.cafe.total.toLocaleString()}건`,
        `트렌드 ${describeTrendLabel(research.datalabSearch.trend)}`,
        `직접카페 ${cafeResearch.demandSummary}`,
        `직접지식인 ${kinResearch.problemSummary}`,
      ].join(" / ");

  onProgress?.("다음 토픽 5개 생성 중...");

  const publishedTitles = publishedTopics
    .map((topic) => `- ${topic.title}${topic.contentKind ? ` [${topic.contentKind}]` : ""}`)
    .join("\n");
  const longtailHints = research.longtailSuggestions.slice(0, 5).join(", ");
  const relatedWords = research.relatedKeywords
    .slice(0, 8)
    .map((item) => item.word)
    .join(", ");
  const questionIntents = research.questionIntents.slice(0, 6).join(", ");
  const communitySignals = research.communitySignals.slice(0, 6).join(", ");
  const intentMix = research.summary.intentMix.join(" / ");
  const contentAngles = research.summary.contentAngles.join(", ");
  const directCommunitySignals = formatDirectCommunitySignals({
    cafeSummary: cafeResearch.demandSummary,
    kinSummary: kinResearch.problemSummary,
    cafeTitles: cafeResearch.items.slice(0, 3).map((item) => item.title),
    kinTitles: kinResearch.items.slice(0, 3).map((item) => item.title),
  });

  if (hasOpenAIKey()) {
    const model = process.env.OPENAI_TOPIC_MODEL ?? "gpt-4.1-mini";
    const result = await requestOpenAIJson<{ topics: GeneratedTopic[] }>({
      model,
      input: [
        {
          role: "system",
          content: [
            "You generate Korean Naver Blog posting plans.",
            "Return Korean topics only.",
            "Avoid duplicate titles and avoid topics already covered.",
            "Balance hub and leaf topics based on gaps in the published list.",
            "Use Naver search-intent friendly longtail wording.",
            "Reflect question-style demand from KnowledgeIn and lived-experience demand from Cafe.",
            "When direct cafe and KnowledgeIn signals are provided, use them to make topics concrete and practical.",
            "If the trend is rising, prioritize timely topics over generic evergreen clones.",
            "Locality rule: generate only Incheon operating-area topics when using a place name.",
            `Allowed localities: ${ALLOWED_LOCALITY_TERMS.join(", ")}.`,
            `Never generate outside localities: ${BLOCKED_OUTSIDE_LOCALITY_TERMS.join(", ")}.`,
            `Locality priority first: ${PRIMARY_LOCALITY_PRIORITY.join(", ")}.`,
            `Locality priority second: ${SECONDARY_LOCALITY_PRIORITY.join(", ")}.`,
            "Use other Incheon-area localities only after the first and second priority pools have been covered.",
            buildPolicyPromptSection(),
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `User id: ${userId.trim().toLowerCase()}`,
            "Published posts:",
            publishedTitles || "- none",
            "",
            `Main category: ${mainCategory}`,
            `Research keyword: ${representativeKeyword}`,
            `Competition: ${research.blog.competition}`,
            `KnowledgeIn total: ${research.kin.total}`,
            `Cafe total: ${research.cafe.total}`,
            `Trend: ${research.datalabSearch.trend} (latest ${research.datalabSearch.latestRatio}, avg ${research.datalabSearch.averageRatio})`,
            `Related keywords: ${relatedWords || "none"}`,
            `Longtail hints: ${longtailHints || "none"}`,
            `Question intents: ${questionIntents || "none"}`,
            `Community signals: ${communitySignals || "none"}`,
            `Intent mix: ${intentMix || "none"}`,
            `Content angles: ${contentAngles || "none"}`,
            "",
            "Direct Naver community signals:",
            directCommunitySignals,
            "",
            "Generate exactly 5 next posting topics.",
            "Each topic must include contentKind hub or leaf.",
            "Prefer missing hub/leaf coverage over small keyword variations.",
            "Prefer topics that answer repeated community demand and repeated KnowledgeIn questions over generic keyword-only titles.",
            "Title length should be within 50 Korean characters.",
            "If a title needs a local modifier, use only Incheon/Bupyeong/Mansu/Guwol/Namdong/Songdo/Cheongna/Yeonsu/Juan/Ganseok/Geomdan-area wording.",
            "Do not suggest Seoul, Busan, Daegu, Gimpo, Gyeonggi, or other outside-area topics. Bucheon/Sang-dong/Jung-dong are allowed because they are in the user's priority pool.",
            `Priority localities first: ${PRIMARY_LOCALITY_PRIORITY.join(", ")}.`,
            `Secondary localities next: ${SECONDARY_LOCALITY_PRIORITY.join(", ")}.`,
            "Only after those are exhausted, recommend other Incheon localities.",
          ].join("\n"),
        },
      ],
      schemaName: "next_posting_topics",
      schema: OPENAI_TOPIC_SCHEMA,
      maxOutputTokens: 2200,
      temperature: 0.45,
      signal: AbortSignal.timeout(90_000),
    });

    const generatedTopics = filterBlockedTopics(
      result.topics.map((topic) => normalizeGeneratedTopic(topic, mainCategory)),
    )
      .filter((topic) => topic.title)
      .slice(0, 5);

    onProgress?.(`다음 토픽 ${generatedTopics.length}개 생성 완료`);
    return { generatedTopics, researchKeyword: representativeKeyword, competitionInfo };
  }

  const client = getAnthropicClient();
  const response = await client.messages.create(
    {
      model: MODELS.sonnet,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `사용자(${userId})의 발행 완료 글 목록입니다.
아래 목록과 네이버 리서치 결과를 참고해서 다음 신규 글목록 5개를 추천해 주세요.

## 기존 발행 글 목록
${publishedTitles}

## 주력 카테고리
${mainCategory}

## 네이버 리서치 결과 (키워드 "${representativeKeyword}")
- 블로그 경쟁도: ${research.blog.competition}
- 지식인 결과 수: ${research.kin.total}
- 카페 결과 수: ${research.cafe.total}
- 데이터랩 추세: ${describeTrendLabel(research.datalabSearch.trend)} (latest ${research.datalabSearch.latestRatio}, avg ${research.datalabSearch.averageRatio})
- 연관 키워드: ${relatedWords || "없음"}
- 롱테일 제안: ${longtailHints || "없음"}
- 질문 의도: ${questionIntents || "없음"}
- 카페 신호: ${communitySignals || "없음"}
- 의도 요약: ${intentMix || "없음"}
- 추천 각도: ${contentAngles || "없음"}

## 직접 네이버 커뮤니티 신호
${directCommunitySignals}

## 요구사항
1. 기존 발행 글과 겹치지 않으면서 자연스럽게 이어지는 주제
2. 이미 발행된 허브글이 적으면 먼저 리프글을 보강하고, 리프글만 많으면 상위 허브글을 제안
3. 5개 안에 hub와 leaf를 균형 있게 섞되, 현재 목록의 빈틈을 우선
4. 네이버 검색 의도가 드러나는 롱테일 키워드를 포함
5. 지식인 질문 수요와 카페 실수요를 제목/설명에 반영
6. 데이터랩 상승 추세면 시의성 있는 주제를 우선
7. category는 "${mainCategory}" 계열 유지
8. contentKind는 반드시 "hub" 또는 "leaf" 중 하나로 지정

## 출력 형식 (JSON 코드블록)
\`\`\`json
[
  {
    "title": "포스팅 제목 (50자 이내)",
    "description": "이 글에서 다룰 핵심 내용 (2~3문장)",
    "category": "${mainCategory}",
    "tags": ["태그1", "태그2", "태그3"],
    "contentKind": "hub",
    "rationale": "왜 이 주제를 추천하는지와 기존 글/허브-리프 구조상 필요한 이유"
  }
]
\`\`\`

반드시 5개를 출력해 주세요.`,
        },
      ],
    },
    { signal: AbortSignal.timeout(60_000) },
  );

  const text = response.content.find((block) => block.type === "text");
  const rawText = text?.type === "text" ? text.text : "";
  const generatedTopics = filterBlockedTopics(
    parseGeneratedTopics(rawText).map((topic) => normalizeGeneratedTopic(topic, mainCategory)),
  )
    .filter((topic) => topic.title)
    .slice(0, 5);

  onProgress?.(`다음 토픽 ${generatedTopics.length}개 생성 완료`);

  return { generatedTopics, researchKeyword: representativeKeyword, competitionInfo };
}
