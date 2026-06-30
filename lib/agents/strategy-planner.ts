import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
import { runToolUseLoop } from "@/lib/anthropic/tool-executor";
import { userProfileLoader } from "@/lib/skills/user-profile-loader";
import { userCorpusRetriever } from "@/lib/skills/user-corpus-retriever";
import { topicFeasibilityJudge } from "@/lib/skills/topic-feasibility-judge";
import { sourceResolver } from "@/lib/skills/source-resolver";
import { reviewRecordAudit } from "@/lib/skills/review-record-audit";
import { naverKeywordResearch } from "@/lib/skills/naver-keyword-research";
import { naverContentFetcher } from "@/lib/skills/naver-content-fetcher";
import { naverCafeSearch, naverKinSearch } from "@/lib/skills/naver-community-research";
import { readJsonFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { PostingIndex, Topic, TopicIndex } from "@/lib/types/github-data";
import type { ArticleStage, ArticleType, DuplicateMode, KeywordContract, SearchCombinationTarget, StrategyPlanResult } from "./types";
import { normalizeUserId } from "@/lib/utils/normalize";
import { buildContentTopologyPlan } from "./content-topology";
import { buildPolicyPromptSection } from "./blog-workflow-policy";
import { naverLogicAgent } from "./naver-logic-agent";
import { getPublicationLearningSummary } from "./user-learning";
import { classifySearchCombination, normalizeSearchPhrase, sanitizeMainKeywordCandidate } from "./search-combination-utils";
import { buildArticleContract, evaluateStrategyQualityGate } from "./article-contract-utils";
import { buildExistingArticleSummaries, buildOverlapReport } from "./overlap-report-utils";
import { resolveTopicIntent } from "./topic-intent-resolver";
import { buildArticlePlan } from "./article-plan.ts";

const STRATEGY_LOOP_TIMEOUT_MS = 120_000;
const SIMPLE_STRATEGY_TIMEOUT_MS = 45_000;
const ANTHROPIC_CREDIT_BLOCK_MESSAGE =
  "Anthropic API 크레딧이 부족해 전략 수립을 중단합니다. 결제/크레딧을 충전한 뒤 다시 실행해 주세요.";

function stringifyStrategyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isFatalStrategyProviderError(error: unknown): boolean {
  const message = stringifyStrategyError(error).toLowerCase();
  return (
    message.includes("credit balance is too low") ||
    (message.includes("invalid_request_error") && message.includes("credit balance"))
  );
}

const ALLOWED_VAPE_TOPIC_CLARIFICATION = [
  "## Allowed vape topic clarification",
  "- Electronic-cigarette/vape device recommendations, liquid selection guides, beginner guides, local shop recommendation posts, setup guides, troubleshooting posts, and product reviews are allowed.",
  "- Do not block a topic only because it contains electronic cigarette, vape, liquid, or device.",
  "- Block only cessation-focused angles such as how to quit vape liquid or stop using electronic cigarette liquid.",
  "- If a topic is allowed, return only the required strategy JSON. Do not return a refusal essay.",
].join("\n");

const SYSTEM_PROMPT = `
당신은 네이버 블로그 그룹 운영을 위한 전략 플래너입니다.
주어진 토픽을 분석해 사용자 말투와 검색의도, 블로그 역할, 허브/리프 구조에 맞는 글쓰기 전략을 JSON으로만 반환하세요.

## 작업 순서
1. user_profile_loader로 사용자 프로필과 금지 표현을 확인합니다.
2. user_corpus_retriever로 대표 코퍼스 2개를 읽고 문체/구조를 파악합니다.
3. topic_feasibility_judge로 주제 실현 가능성과 금지 요소를 확인합니다.
4. naver_keyword_research로 메인 키워드와 연관 검색 흐름을 조사합니다.
5. naver_content_fetcher로 상위 노출 글의 공통 구조와 누락 포인트를 파악합니다.
6. 참조 URL이 있으면 source_resolver로 사실성을 검증합니다.
7. review_record_audit로 과거 발행 패턴과 중복 리스크를 확인합니다.
8. 위 정보를 합쳐 전략 JSON 하나만 출력합니다.

## 출력 형식
\`\`\`json
{
  "title": "전략 제목",
  "outline": [
    {
      "heading": "섹션 제목",
      "subPoints": ["하위 포인트"],
      "contentDirection": "작성 방향 + 인간 지문 포인트(직접 써봤더니/실제 가격 X원/N일 사용 결과/처음엔 몰랐던 부분 등 구체 경험) + AEO 발췌 문장 위치(첫 섹션: AI 브리핑 인용용 핵심 요약 1~2문장)",
      "estimatedParagraphs": 2
    }
  ],
  "keyPoints": ["핵심 포인트"],
  "estimatedLength": 1700,
  "tone": "friendly",
  "keywords": ["메인키워드", "서브키워드"],
  "keywordContract": {
    "mainKeyword": "실제 네이버 검색창 입력어 (24자 이내, 자연어 문장 금지)",
    "subKeywords": ["검색어1", "검색어2"],
    "bridgeKeywords": []
  },
  "suggestedSources": [],
  "rationale": "전략 근거"
}
\`\`\`

## 반드시 지킬 규칙
- JSON 이외의 문장은 출력하지 않습니다.
- 가격, 할인, 쿠폰, 증정, 프로모션 문구는 전략에 넣지 않습니다.
- 금지 주제가 아니라면 전자담배/액상/기기/입문/추천/리뷰/문제해결 글은 정상 허용합니다.
- 검색의도와 블로그 역할(A~E), 허브/리프 구조를 함께 반영합니다.
- naver_content_fetcher에서 파악한 상위 글의 공통점은 참고하되, 제목/목차/결론/링크 구조는 그대로 베끼지 않습니다.
- keywordContract.mainKeyword와 subKeywords는 반드시 실제 네이버 검색창에 입력하는 형태여야 합니다.
  - 올바른 예: "전자담배 입문", "입호흡 전자담배 추천", "액상형 전자담배 차이"
  - 잘못된 예: "2025년 기준 입호흡 전자담배 추천 TOP5 인천 만수동만수르 픽" (글 제목이므로 금지)
  - 잘못된 예: "전자담배를 처음 시작하는 분들을 위한 가이드" (자연어 문장이므로 금지)
  - 24자를 초과하거나 조사/어미로 끝나는 표현은 키워드가 아닙니다.

## 2026 네이버 알고리즘 대응 설계 (필수)

### 검색의도 분류 및 채널 전략
- 키워드 유형을 판단하세요: "informational"(왜·방법·이유·차이·가이드 계열) vs "commercial"(추천·비교·순위·리뷰·구매 계열)
- informational → AI 브리핑 노출 우선 전략: 아웃라인 첫 번째 섹션 contentDirection에 "AI 브리핑 발췌용 핵심 요약 1~2문장(수치·날짜 포함, 완결 문장)" 명시
- commercial → VIEW탭 + 개인화 피드 전략: 경험 기반 섹션(실제 가격·사용 기간·전후 비교)을 아웃라인 앞쪽에 배치

### AEO 구조 (Naver AI 브리핑 인용 최적화)
- informational 키워드: 첫 번째 아웃라인 섹션 subPoints에 "독자의 핵심 질문 직접 답변" 항목 포함
- 소제목, 비교표, 단계별 목록 형식을 outline 섹션 contentDirection에 명시
- 날짜/수치/조건이 포함된 팩트 문장 위치를 각 섹션 contentDirection에 지정

### 인간 지문 (Human Fingerprint) — D.I.A.+ AI 탐지 방지
- 각 섹션 contentDirection에 경험 삽입 포인트 최소 1개 명시:
  예) "직접 N일 써본 결과 ~를 발견함", "실제 가격 X원 기준으로 비교", "처음엔 ~인 줄 알았는데 실제로는 ~"
- 구체 수치·날짜·시행착오가 없는 일반론 섹션은 D.I.A.+에서 AI 생성 문서로 분류됩니다.

### 체류시간 구조
- 아웃라인 첫 번째 섹션 contentDirection에 "목차형 요약(독자가 원하는 정보를 3~4줄로 빠르게 스캔)" 포함
- 중간 섹션 하나의 contentDirection에 "관심 전환 장치: 예상과 달랐던 결과 또는 흔히 놓치는 포인트" 명시
- 마지막 섹션 contentDirection에 "재방문 유도: bridgeKeyword 방향의 다음 주제로 자연스럽게 연결" 포함
`.trim();

function buildPolicySystemPrompt(): string {
  return `${buildPolicyPromptSection()}\n\n${ALLOWED_VAPE_TOPIC_CLARIFICATION}\n\n${SYSTEM_PROMPT}`;
}

const TOOLS: Tool[] = [
  {
    name: "user_profile_loader",
    description: "사용자 프로필과 금지 표현 목록을 GitHub 데이터 저장소에서 불러옵니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        userId: { type: "string", description: "사용자 ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "user_corpus_retriever",
    description: "사용자 코퍼스 샘플을 읽어 문체와 구조 패턴을 파악합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        userId: { type: "string" },
        limit: { type: "number", description: "불러올 샘플 수" },
        category: { type: "string", description: "선택 카테고리 필터" },
      },
      required: ["userId"],
    },
  },
  {
    name: "topic_feasibility_judge",
    description: "주제가 정책상 허용되는지, 검색형 글로 풀 수 있는지 판정합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        topic: { type: "object", description: "Topic 객체" },
        userProfile: { type: "object", description: "사용자 프로필" },
        forbiddenExpressions: { type: "object", description: "금지 표현 목록" },
      },
      required: ["topic", "userProfile", "forbiddenExpressions"],
    },
  },
  {
    name: "source_resolver",
    description: "참조 URL의 제목과 요약을 확인해 사실성 검증 근거를 만듭니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "검증할 URL 목록" },
      },
      required: ["urls"],
    },
  },
  {
    name: "review_record_audit",
    description: "과거 발행 패턴을 읽어 중복 리스크와 반복 구조를 점검합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        userId: { type: "string" },
        limit: { type: "number", description: "최근 기록 조회 수" },
      },
      required: ["userId"],
    },
  },
  {
    name: "naver_keyword_research",
    description: "네이버 블로그 검색 기준으로 메인 키워드와 연관 흐름을 조사합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        keyword: { type: "string", description: "조사할 대표 키워드" },
        display: { type: "number", description: "조회할 블로그 결과 수" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "naver_content_fetcher",
    description: "상위 블로그 글의 본문을 읽고 공통 구조와 검색의도 충족 방식을 요약합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "수집할 블로그 글 URL 목록 (최대 5개 권장)",
        },
        keyword: { type: "string", description: "요약 컨텍스트에 사용할 기준 키워드" },
      },
      required: ["urls", "keyword"],
    },
  },
  {
    name: "naver_cafe_search",
    description:
      "Search recent Naver cafe articles to detect live demand, repeated comparison language, and community interest around the topic.",
    input_schema: {
      type: "object" as const,
      properties: {
        keyword: { type: "string", description: "Keyword or product phrase to inspect in cafe communities" },
        display: { type: "number", description: "Number of cafe articles to inspect (default 20)" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "naver_kin_search",
    description:
      "Search Naver KnowledgeIn to detect recurring user questions, confusion, and pain points before writing.",
    input_schema: {
      type: "object" as const,
      properties: {
        keyword: { type: "string", description: "Keyword or product phrase to inspect in KnowledgeIn" },
        display: { type: "number", description: "Number of questions to inspect (default 20)" },
      },
      required: ["keyword"],
    },
  },
];

async function loadTopic(topicId: string): Promise<Topic> {
  const path = Paths.topicsIndex();
  if (!(await fileExists(path))) {
    throw new Error("topics index 파일이 없습니다.");
  }

  const { data } = await readJsonFile<TopicIndex>(path);
  const topic = data.topics.find((item) => item.topicId === topicId);
  if (!topic) {
    throw new Error(`topicId "${topicId}"를 찾을 수 없습니다.`);
  }
  return topic;
}

async function loadExistingArticleSummariesForUser(userId: string) {
  if (!(await fileExists(Paths.postingListIndex())) || !(await fileExists(Paths.topicsIndex()))) {
    return [];
  }

  const [{ data: postingIndex }, { data: topicIndex }] = await Promise.all([
    readJsonFile<PostingIndex>(Paths.postingListIndex()),
    readJsonFile<TopicIndex>(Paths.topicsIndex()),
  ]);

  return buildExistingArticleSummaries({
    posts: postingIndex.posts,
    topics: topicIndex.topics,
    userId,
  });
}

function parseStrategyFromText(text: string): StrategyPlanResult {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    try {
      return JSON.parse(jsonMatch[1].trim()) as StrategyPlanResult;
    } catch {
      // 다음 파싱 시도
    }
  }

  const codeMatch = text.match(/```\s*([\s\S]*?)```/);
  if (codeMatch?.[1]) {
    try {
      return JSON.parse(codeMatch[1].trim()) as StrategyPlanResult;
    } catch {
      // 다음 파싱 시도
    }
  }

  let depth = 0;
  let start = -1;
  let best = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        if (candidate.length > best.length) best = candidate;
      }
    }
  }

  if (best) {
    try {
      return JSON.parse(best) as StrategyPlanResult;
    } catch {
      // 마지막 에러로 처리
    }
  }

  const preview = text.slice(0, 500).replace(/\n/g, " ");
  throw new Error(`strategy-planner JSON 파싱 실패. 응답 미리보기: ${preview}`);
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

interface DirectKeywordIntent {
  mainKeyword: string;
  subKeywords: string[];
}

function parseKeywordList(value: string): string[] {
  return uniq(
    value
      .split(/[,/\n|]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function sanitizeDirectIntent(rawDirectIntent: DirectKeywordIntent | null): DirectKeywordIntent | null {
  if (!rawDirectIntent) return null;

  const mainKeyword = rawDirectIntent.mainKeyword
    ? sanitizeMainKeywordCandidate(rawDirectIntent.mainKeyword) ?? ""
    : "";
  const subKeywords = uniq(
    rawDirectIntent.subKeywords
      .map((keyword) => sanitizeAiKeyword(normalizeKeyword(keyword)))
      .filter((keyword): keyword is string => keyword !== null)
      .filter((keyword) => !isGenericKeyword(keyword))
      .filter((keyword) => keyword.toLowerCase() !== mainKeyword.toLowerCase())
  );

  if (!mainKeyword && subKeywords.length === 0) return null;
  return { mainKeyword, subKeywords };
}

function decomposeMainKeyword(mainKeyword: string): { baseTopic: string; suffixKeyword: string | null } {
  const normalized = mainKeyword.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { baseTopic: "", suffixKeyword: null };
  }

  if (normalized.endsWith(" 추천")) {
    return { baseTopic: normalized.slice(0, -3).trim(), suffixKeyword: "추천" };
  }

  return { baseTopic: normalized, suffixKeyword: null };
}

function buildSearchCombinationPhrase(mainKeyword: string, modifiers: string[]): string {
  const { baseTopic, suffixKeyword } = decomposeMainKeyword(mainKeyword);
  const parts = [...modifiers.filter(Boolean), baseTopic, suffixKeyword].filter(Boolean);
  return uniq([parts.join(" ")]).at(0) ?? mainKeyword.trim();
}

function classifyCombinationRole(keyword: string): SearchCombinationTarget["role"] {
  if (/(시|도|구|군|동|읍|면|역)$/.test(keyword) || /(서울|인천|부천|부평|만수|구월|남동|계산)/.test(keyword)) {
    return "local";
  }
  if (/(만수르|매장|지점|스토어|샵|shop)/i.test(keyword)) {
    return "brand";
  }
  if (/(입호흡|폐호흡|액상|기기|초보|가성비|추천|비교|후기|리뷰)/.test(keyword)) {
    return "support";
  }
  return "mixed";
}

function buildTargetSearchCombinations(params: {
  topic: Topic;
  plan: StrategyPlanResult;
  directIntent: DirectKeywordIntent | null;
}): SearchCombinationTarget[] {
  const mainKeyword = [
    params.directIntent?.mainKeyword ?? "",
    sanitizeMainKeywordCandidate(params.plan.keywords[0] ?? "") ?? "",
    sanitizeMainKeywordCandidate(params.topic.targetMainKeyword ?? params.plan.targetMainKeyword ?? "") ?? "",
  ].find(Boolean) ?? "";
  if (!mainKeyword) return [];
  const fallbackSupports = uniq(
    params.plan.keywords
      .slice(1, 5)
      .map((keyword) => sanitizeAiKeyword(keyword))
      .filter((keyword): keyword is string => keyword !== null)
      .filter((keyword) => !isGenericKeyword(keyword))
  );
  const subKeywords = uniq([
    ...(params.directIntent?.subKeywords ?? []),
    ...fallbackSupports,
  ]).filter((keyword) => keyword.toLowerCase() !== mainKeyword.toLowerCase());

  const combinations: SearchCombinationTarget[] = [];
  const pushCombination = (
    phrase: string,
    role: SearchCombinationTarget["role"],
    priority: SearchCombinationTarget["priority"],
    rationale: string,
    suggestedPlacement: string
  ) => {
    const normalized = normalizeSearchPhrase(phrase);
    if (!normalized) return;
    if (combinations.some((item) => item.phrase.toLowerCase() === normalized.toLowerCase())) return;
    const classification = classifySearchCombination(normalized);
    combinations.push({
      phrase: normalized,
      displayIntent: classification.displayIntent,
      exactInsertionAllowed: classification.exactInsertionAllowed,
      exactBlockReason: classification.exactBlockReason,
      role,
      priority,
      rationale,
      suggestedPlacement,
    });
  };

  pushCombination(
    mainKeyword,
    "main",
    "core",
    "메인 키워드는 글 전체의 중심 검색축입니다.",
    "제목, 도입부, 결론"
  );

  for (const keyword of subKeywords) {
    pushCombination(
      buildSearchCombinationPhrase(mainKeyword, [keyword]),
      classifyCombinationRole(keyword),
      "core",
      `'${keyword}' 문맥을 메인 키워드와 직접 연결한 롱테일 조합입니다.`,
      /(시|도|구|군|동|읍|면|역)$/.test(keyword) || /(서울|인천|부천|부평|만수|구월|남동|계산)/.test(keyword)
        ? "도입부 또는 지역 체감 문단"
        : "선택 기준 또는 비교 문단"
    );
  }

  const localKeyword = subKeywords.find((keyword) => classifyCombinationRole(keyword) === "local");
  const supportKeyword = subKeywords.find((keyword) => classifyCombinationRole(keyword) === "support");
  const brandKeyword = subKeywords.find((keyword) => classifyCombinationRole(keyword) === "brand");

  if (localKeyword && supportKeyword) {
    pushCombination(
      buildSearchCombinationPhrase(mainKeyword, [localKeyword, supportKeyword]),
      "mixed",
      "core",
      "지역성과 사용상황을 함께 묶어 더 구체적인 검색 의도를 받는 조합입니다.",
      "도입부 이후 핵심 비교 문단"
    );
  }

  if (brandKeyword) {
    pushCombination(
      buildSearchCombinationPhrase(mainKeyword, [brandKeyword]),
      "brand",
      "support",
      "매장명/브랜드 경험을 신뢰 신호로 연결하는 조합입니다.",
      "실사용 경험 또는 방문 팁 문단"
    );
  }

  if (brandKeyword && supportKeyword) {
    pushCombination(
      buildSearchCombinationPhrase(mainKeyword, [brandKeyword, supportKeyword]),
      "mixed",
      "support",
      "매장/브랜드 경험과 사용상황을 결합한 신뢰형 롱테일 조합입니다.",
      "후반 실사용 정리 문단"
    );
  }

  return combinations.slice(0, 8);
}

function extractFallbackKeywords(topic: Topic): string[] {
  const titleWords = topic.title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2);
  return uniq([...topic.tags, ...titleWords, topic.category]).slice(0, 8);
}

function formatPublicationLearningBrief(summary: StrategyPlanResult["publicationLearning"]): string {
  if (!summary) {
    return "발행 학습 요약: 아직 누적 데이터가 충분하지 않습니다.";
  }

  return [
    `발행 학습 요약 출처: ${summary.source}`,
    `누적 발행 수: ${summary.totalEntries}`,
    `평균 평가 점수: ${summary.avgEvalScore ?? "없음"}`,
    `평균 분량: ${summary.avgWordCount ?? "없음"}`,
    `반복 제목 키워드: ${summary.topKeywords.join(", ") || "없음"}`,
    `자주 발행된 글 구조: ${summary.dominantContentKinds.join(", ") || "없음"}`,
    `최근 발행 제목 예시: ${summary.recentTitles.join(" / ") || "없음"}`,
    `최고 성과 제목: ${summary.bestPerformingTitle ?? "없음"}`,
    ...summary.guidance.map((item) => `- ${item}`),
  ].join("\n");
}

function extractDirectKeywordIntent(topic: Topic): DirectKeywordIntent | null {
  if (topic.source !== "direct") return null;

  const description = topic.description ?? "";
  const mainMatch = description.match(/메인키워드:\s*([^/\n]+?)(?:\s*\/|\s*$)/);
  const subMatch = description.match(/서브 키워드:\s*([^\n]+?)\s*$/);
  const mainKeyword = mainMatch?.[1]?.trim() || topic.tags[0]?.trim() || "";
  const subKeywords = parseKeywordList(subMatch?.[1]?.trim() || topic.tags.slice(1).join(", "));

  if (!mainKeyword) return null;
  return { mainKeyword, subKeywords };
}

function applyDirectKeywordPriority(
  plan: StrategyPlanResult,
  directIntent: DirectKeywordIntent | null
): StrategyPlanResult {
  if (!directIntent || (!directIntent.mainKeyword && directIntent.subKeywords.length === 0)) return plan;

  const orderedKeywords = uniq([
    ...(directIntent.mainKeyword ? [directIntent.mainKeyword] : []),
    ...directIntent.subKeywords,
    ...plan.keywords,
  ]).filter(Boolean);

  const keyPoints = uniq([
    directIntent.mainKeyword ? `${directIntent.mainKeyword}를 글의 중심 검색축으로 유지한다.` : "",
    directIntent.subKeywords.length > 0
      ? `${directIntent.subKeywords.join(", ")}는 보조 맥락으로 활용하되 메인 키워드를 대체하지 않는다.`
      : "",
    ...plan.keyPoints,
  ]).filter(Boolean);

  const rationalePrefix = directIntent.mainKeyword && directIntent.subKeywords.length > 0
    ? `직접 입력 토픽이므로 메인 키워드 '${directIntent.mainKeyword}'를 중심축으로 두고, 서브 키워드 '${directIntent.subKeywords.join(", ")}'는 보조 맥락으로 반영했습니다.`
    : directIntent.mainKeyword
      ? `직접 입력 토픽이므로 메인 키워드 '${directIntent.mainKeyword}'를 중심축으로 반영했습니다.`
      : directIntent.subKeywords.length > 0
        ? `직접 입력 토픽의 보조 검색어 '${directIntent.subKeywords.join(", ")}'를 맥락 키워드로 반영했습니다.`
        : "";

  return {
    ...plan,
    keywords: orderedKeywords,
    keyPoints,
    rationale: rationalePrefix ? `${rationalePrefix} ${plan.rationale}`.trim() : plan.rationale,
  };
}

function buildCommunityResearchBrief(params: {
  cafeSummary?: string;
  kinSummary?: string;
}): string {
  return [
    "Naver community research signals:",
    `- Cafe demand: ${params.cafeSummary || "unavailable"}`,
    `- KnowledgeIn problems: ${params.kinSummary || "unavailable"}`,
  ].join("\n");
}

function buildLocalFallbackStrategy(topic: Topic): StrategyPlanResult {
  const dp = topic.seriesDetailPlan;

  // seriesDetailPlan이 있으면 그 내용을 폴백 전략의 기반으로 사용
  if (dp) {
    const mainKeyword = dp.primaryKeyword || topic.title;
    const sections = dp.recommendedSections ?? [];
    const outline = sections.length > 0
      ? sections.map((heading, i) => ({
          heading,
          subPoints: [dp.articleGoal || "글 목표에 맞춰 작성"],
          contentDirection: i === 0
            ? `${dp.readerQuestion || "독자의 질문"}에 답하는 방식으로 시작합니다.`
            : dp.draftAngle || "설계된 방향으로 작성합니다.",
          estimatedParagraphs: 2,
        }))
      : [
          {
            heading: `${mainKeyword}를 찾는 이유`,
            subPoints: [dp.readerQuestion || "검색자의 상황과 고민을 먼저 정리"],
            contentDirection: "서론에서 검색의도와 현재 고민을 자연스럽게 연결합니다.",
            estimatedParagraphs: 2,
          },
          {
            heading: dp.articleGoal || "핵심 내용",
            subPoints: ["구체적인 판단 기준 제시", "실사용 관점에서 정리"],
            contentDirection: dp.draftAngle || "작성 각도에 맞춰 정리합니다.",
            estimatedParagraphs: 3,
          },
          {
            heading: "정리와 다음 단계",
            subPoints: ["핵심 요약", dp.callToAction || "다음 행동 제안"],
            contentDirection: "독자가 다음 행동을 자연스럽게 이어가도록 마무리합니다.",
            estimatedParagraphs: 2,
          },
        ];

    return {
      title: topic.title,
      outline,
      keyPoints: [
        dp.articleGoal || "검색의도에 바로 답하는 구조를 유지한다.",
        ...(dp.keywordPlacementRules ?? []).slice(0, 2),
      ].filter(Boolean),
      estimatedLength: 1800,
      tone: "friendly",
      keywords: [
        dp.primaryKeyword,
        ...(dp.secondaryKeywords ?? []),
      ].filter(Boolean),
      suggestedSources: topic.relatedSources,
      rationale: "AI 전략 수립이 지연되어 시리즈 상세 설계 기반의 안전 폴백 전략을 사용했습니다.",
    };
  }

  // seriesDetailPlan 없을 때 기존 폴백
  const keywords = extractFallbackKeywords(topic);
  const mainKeyword = keywords[0] ?? topic.title;

  return {
    title: topic.title,
    outline: [
      {
        heading: `${mainKeyword}를 찾는 이유`,
        subPoints: ["검색자가 궁금해하는 상황을 먼저 정리", "처음 확인해야 할 기준 제시"],
        contentDirection: "서론에서 검색의도와 현재 고민을 자연스럽게 연결합니다.",
        estimatedParagraphs: 2,
      },
      {
        heading: "선택 전에 보는 핵심 기준",
        subPoints: ["사용 목적", "실사용 편의", "비교할 때 놓치기 쉬운 부분"],
        contentDirection: "추상적인 말 대신 실제 판단 기준을 항목형으로 정리합니다.",
        estimatedParagraphs: 3,
      },
      {
        heading: "실제로 비교할 때 체크할 포인트",
        subPoints: ["방문 전 확인 사항", "상담 시 물어볼 질문", "초보자가 헷갈리는 차이"],
        contentDirection: "현장감 있는 예시와 체크리스트를 넣어 읽는 흐름을 살립니다.",
        estimatedParagraphs: 3,
      },
      {
        heading: "정리와 다음 확인 포인트",
        subPoints: ["핵심 요약", "이어서 보면 좋은 관련 주제", "다음 행동 제안"],
        contentDirection: "허브/리프 구조에 맞춰 다음 글로 자연스럽게 이어지게 마무리합니다.",
        estimatedParagraphs: 2,
      },
    ],
    keyPoints: [
      "검색의도에 바로 답하는 구조를 유지한다.",
      "과장 없이 실제 선택 기준을 구체적으로 제시한다.",
      "허브/리프 연결과 내부링크 흐름을 고려한다.",
    ],
    estimatedLength: 1800,
    tone: "friendly",
    keywords,
    suggestedSources: topic.relatedSources,
    rationale: "AI 전략 수립이 지연되어 토픽 제목, 카테고리, 태그 기반의 안전 폴백 전략을 사용했습니다.",
  };
}

function evaluatePublishableStrategyGate(plan: StrategyPlanResult) {
  const gate = evaluateStrategyQualityGate(plan);
  if (plan.strategySource !== "local_fallback") return gate;

  return {
    ok: false,
    blockingReasons: [
      "AI 전략 수립 실패로 안전 폴백 전략이 생성되어 발행용 writer 실행을 차단합니다. 다시 전략 수립을 실행해 주세요.",
      ...gate.blockingReasons,
    ],
    warnings: [
      ...(plan.strategyFallbackReason ? [`폴백 사유: ${plan.strategyFallbackReason}`] : []),
      ...gate.warnings,
    ],
  };
}

function buildUserMessage(
  topic: Topic,
  topicId: string,
  userId: string,
  directIntent: DirectKeywordIntent | null,
  publicationLearning: StrategyPlanResult["publicationLearning"],
  duplicateModeOverride?: DuplicateMode
): string {
  const seriesBrief = topic.seriesId
    ? [
        "선행 포스팅 설계 메타:",
        `- 시리즈 ID: ${topic.seriesId}`,
        `- 역할: ${topic.seriesRole === "main" ? "메인 글" : "선행 글"}`,
        `- 메인 키워드: ${topic.targetMainKeyword ?? "없음"}`,
        `- 순서: ${topic.sequenceOrder ?? "미지정"}`,
        topic.seriesRole === "prelude"
          ? "- 선행 글 규칙: 메인 키워드를 정면 제목으로 반복하지 말고, 본문 맥락에서 1~3회 자연스럽게 노출하세요."
          : "- 메인 글 규칙: 선행 포스팅에서 다룬 개념/기준/질문을 묶어 메인 키워드를 정면으로 공략하세요.",
      ].join("\n")
    : "";
  const seriesDetailBrief = topic.seriesDetailPlan
    ? [
        "시리즈 상세 설계:",
        `- 글 목표: ${topic.seriesDetailPlan.articleGoal}`,
        `- 검색 의도: ${topic.seriesDetailPlan.searchIntent}`,
        `- 독자 질문: ${topic.seriesDetailPlan.readerQuestion}`,
        `- 핵심 키워드: ${topic.seriesDetailPlan.primaryKeyword}`,
        `- 보조 키워드: ${topic.seriesDetailPlan.secondaryKeywords.join(", ") || "없음"}`,
        `- 추천 섹션: ${topic.seriesDetailPlan.recommendedSections.join(" / ")}`,
        `- 키워드 노출 규칙: ${topic.seriesDetailPlan.keywordPlacementRules.join(" / ")}`,
        `- 내부링크 계획: ${topic.seriesDetailPlan.internalLinkTitles.join(" / ") || "없음"}`,
        `- CTA: ${topic.seriesDetailPlan.callToAction}`,
        `- 초안 각도: ${topic.seriesDetailPlan.draftAngle}`,
      ].join("\n")
    : "";
  return [
    "다음 토픽으로 네이버 블로그 전략을 수립해 주세요.",
    "",
    `토픽 ID: ${topicId}`,
    `제목: ${topic.title}`,
    `설명: ${topic.description}`,
    `카테고리: ${topic.category}`,
    `태그: ${topic.tags.join(", ") || "없음"}`,
    directIntent?.mainKeyword ? `직접입력 메인 키워드: ${directIntent.mainKeyword}` : "",
    directIntent && directIntent.subKeywords.length > 0 ? `직접입력 서브 키워드: ${directIntent.subKeywords.join(", ")}` : "",
    directIntent?.mainKeyword
      ? "직접 입력 모드 규칙: 메인 키워드를 글의 중심 검색축으로 유지하고, 제목/도입부/핵심 문단의 판단 기준이 메인 키워드와 일치해야 합니다. 서브 키워드는 메인 키워드를 보조하는 맥락으로만 사용하세요."
      : "",
    seriesBrief,
    seriesDetailBrief,
    `사용자 ID: ${userId}`,
    `참조 URL: ${topic.relatedSources.join(", ") || "없음"}`,
    duplicateModeOverride === "force_duplicate"
      ? "중복 처리 모드: force_duplicate. 기존 글과 비슷하다는 이유만으로 방향을 틀지 말고, 현재 제목/검색의도 그대로 실행 가능한 전략을 세우세요. 대신 도입/결론/CTA와 예시는 반복을 줄이세요."
      : duplicateModeOverride === "different_angle"
        ? "중복 처리 모드: different_angle. 핵심 검색의도는 유지하되 도입, 설명 축, 결론 흐름은 기존 글과 다르게 설계하세요."
        : "",
    "",
    formatPublicationLearningBrief(publicationLearning),
    "",
    "반드시 도구를 순서대로 사용한 뒤, 최종 전략 JSON만 출력해 주세요.",
  ].filter(Boolean).join("\n");
}

function sanitizeOutlineHeadingLanguage(value: string): string {
  return value
    .replace(/(.+?(?:추천|비교|후기|리뷰))(?:을|를)\s*찾는\s*이유/gu, "$1이 필요한 이유")
    .replace(/(.+?(?:추천|비교|후기|리뷰))(?:을|를)\s*보는\s*이유/gu, "$1이 중요한 이유")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeStrategyLanguage(plan: StrategyPlanResult): StrategyPlanResult {
  return {
    ...plan,
    outline: plan.outline.map((section) => ({
      ...section,
      heading: sanitizeOutlineHeadingLanguage(section.heading),
      subPoints: section.subPoints.map((item) => sanitizeOutlineHeadingLanguage(item)),
      contentDirection: sanitizeOutlineHeadingLanguage(section.contentDirection),
    })),
    keyPoints: plan.keyPoints.map((item) => sanitizeOutlineHeadingLanguage(item)),
  };
}

const BODY_FORBIDDEN_TERMS = [
  "선행포스팅",
  "키워드빌드업",
  "SEO 점수",
  "검색의도",
  "메인 키워드",
  "서브 키워드",
  "본문 n회",
  "적정 범위",
  "내부링크 설계",
  "허브/리프",
  "상위노출 가능성",
];

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const GENERIC_KEYWORD_SET = new Set([
  "전자담배",
  "추천",
  "고르기",
  "고르는",
  "전에",
  "많이",
  "보는",
  "선택",
  "선택기준",
  "기준",
  "방법",
  "정리",
  "가이드",
  "선행포스팅",
  "키워드빌드업",
  "메인포스팅",
  "입문",
  "시작",
  "체크",
  "체크포인트",
  "체크리스트",
  "포인트",
  "팁",
  "방향",
  "초보자",
  "초보",
]);

function isGenericKeyword(value: string): boolean {
  const normalized = normalizeKeyword(value).toLowerCase();
  if (!normalized || normalized.length < 2) return true;
  if (["비교", "추천", "기기", "제품", "기준", "사용자", "액상", "관리"].includes(normalized)) return true;
  if (GENERIC_KEYWORD_SET.has(normalized)) return true;
  // 모든 토큰이 일반 용어인 조합(예: "선택 기준", "체크 포인트")도 일반으로 처리
  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length > 1 && tokens.every((t) => GENERIC_KEYWORD_SET.has(t))) return true;
  return false;
}

function compactKeywords(values: string[], limit = 6): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeKeyword(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key) || isGenericKeyword(normalized)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

// 실제 네이버 검색어인지 판별: 자연어 문장, 조사·어미·부사 포함 표현은 차단
const SENTENCE_ADVERBS = new Set(["자주", "항상", "정말", "너무", "매우", "꼭", "바로", "모두", "항시", "늘"]);

function sanitizeAiKeyword(kw: string): string | null {
  const normalized = normalizeKeyword(kw);
  if (!normalized || normalized.length > 20) return null;
  const tokens = normalized.split(/\s+/);
  // 토큰 5개 이상이면 문장으로 간주
  if (tokens.length >= 5) return null;
  // 조사로 끝나는 토큰이 있으면 자연어 문장 (예: "초보자가", "전에", "찾는데")
  if (tokens.some((t) => /[가이은는을를에서]$/.test(t))) return null;
  // 동사형 어미 포함 (예: "놓치는", "알아야", "해야", "되는", "있는")
  if (tokens.some((t) => /(하는|있는|없는|되는|놓치는|알아야|해야|하면|찾는법|하는법)$/.test(t))) return null;
  // 부사가 독립 토큰으로 존재
  if (tokens.some((t) => SENTENCE_ADVERBS.has(t))) return null;
  // 숫자+단위 서수 패턴 (TOP5, 5선 등 포함한 제목형) 차단
  if (/TOP\s?\d+|^\d+선$|^\d+가지$/.test(normalized)) return null;
  // 지역명+블로그명 조합 같은 긴 고유명사 차단
  if (/픽$|만수르|인천\s*만수/.test(normalized)) return null;
  return normalized;
}

function inferArticleType(topic: Topic, plan: StrategyPlanResult, topologyKind: "hub" | "leaf"): ArticleType {
  const text = `${topic.title} ${topic.description} ${plan.title}`.toLowerCase();
  if (topic.seriesRole === "prelude") return "warmup";
  if (topic.seriesRole === "main") return "main_recommendation";
  if (topologyKind === "hub") return "local_hub";
  if (/(비교|차이|vs|고르는|고르기|선택 기준|기준)/u.test(text)) return "comparison";
  if (/(해결|고장|누수|탄맛|문제|안됨|교체|원인|액튐|결로|교체주기|인식 안됨|체크팟|노아토마이저|No Atomizer|No Pod|팟 인식|빨리 닳|맛이 약|맛이 탁|새는)/iu.test(text)) return "problem_solution";
  if (/(후기|리뷰|사용감|실사용|솔직후기)/u.test(text)) return "review";
  if (/(추천|best|top|처음 고를 때|입문자 추천)/iu.test(text)) return "main_recommendation";
  if (/(사용법|방법|가이드|입문|처음)/u.test(text)) return "howto";
  return "leaf";
}

function inferArticleStage(articleType: ArticleType): ArticleStage {
  if (articleType === "warmup") return "pre_suasion";
  if (articleType === "comparison") return "comparison_judgment";
  if (articleType === "main_recommendation") return "purchase_review";
  if (articleType === "problem_solution") return "problem_solution";
  if (articleType === "local_hub") return "internal_link";
  return "info_summary";
}

function buildKeywordContract(params: {
  topic: Topic;
  plan: StrategyPlanResult;
  topologyKind: "hub" | "leaf";
  directIntent: DirectKeywordIntent | null;
  topicIntentResolution: ReturnType<typeof resolveTopicIntent>;
}): KeywordContract {
  const { topic, plan, topologyKind, directIntent, topicIntentResolution } = params;
  const articleType =
    topicIntentResolution.articleType === "general_info" && topologyKind === "hub"
      ? "local_hub"
      : topicIntentResolution.articleType || inferArticleType(topic, plan, topologyKind);
  const articleStage =
    articleType === "local_hub"
      ? "internal_link"
      : topicIntentResolution.articleStage || inferArticleStage(articleType);
  const isPrelude = articleType === "warmup";

  // AI가 제공한 keywordContract 우선 사용, 유효성 검사 후 적용
  const aiContract = plan.keywordContract;
  const aiMainKeyword = aiContract?.mainKeyword ? sanitizeMainKeywordCandidate(aiContract.mainKeyword) : null;
  const aiSubKeywords = (aiContract?.subKeywords ?? [])
    .map(sanitizeAiKeyword)
    .filter((kw): kw is string => kw !== null)
    .filter((kw) => !isGenericKeyword(kw));
  const aiBridgeKeywords = (aiContract?.bridgeKeywords ?? [])
    .map(sanitizeAiKeyword)
    .filter((kw): kw is string => kw !== null)
    .filter((kw) => !isGenericKeyword(kw));

  // seriesDetailPlan.primaryKeyword — 사용자가 직접 재설계한 핵심 키워드
  const _seriesDetailPrimaryRaw = topic.seriesDetailPlan?.primaryKeyword
    ? sanitizeMainKeywordCandidate(topic.seriesDetailPlan.primaryKeyword) ?? ""
    : "";
  const seriesDetailPrimaryKw = _seriesDetailPrimaryRaw && !isGenericKeyword(_seriesDetailPrimaryRaw)
    ? _seriesDetailPrimaryRaw
    : "";
  const seriesDetailSecondaryKws = (topic.seriesDetailPlan?.secondaryKeywords ?? [])
    .map((kw) => sanitizeAiKeyword(normalizeKeyword(kw)))
    .filter((kw): kw is string => kw !== null)
    .filter((kw) => !isGenericKeyword(kw));

  // mainKeyword 결정: directIntent > seriesDetailPlan.primaryKeyword > AI > plan.keywords[0] > targetMainKeyword
  // topic.title은 자연어 문장이므로 키워드로 절대 사용하지 않음
  // targetMainKeyword도 sanitize 적용 — 자연어 문장이 mainKeyword로 올라오는 경로 차단
  const directMainKeyword = directIntent?.mainKeyword
    ? sanitizeMainKeywordCandidate(directIntent.mainKeyword) ?? ""
    : "";
  const targetMainKeyword = sanitizeMainKeywordCandidate(topic.targetMainKeyword ?? plan.targetMainKeyword ?? "") ?? "";
  const sanitizedPlanKeyword0 = sanitizeMainKeywordCandidate(plan.keywords[0] ?? "") ?? "";
  const mainKeyword =
    directMainKeyword ||
    seriesDetailPrimaryKw ||
    aiMainKeyword ||
    sanitizedPlanKeyword0 ||
    targetMainKeyword ||
    "";

  // bridgeKeywords: 워밍업 글이면 타겟 메인 키워드를 bridge로 (단, mainKeyword와 다를 때만)
  const bridgeKeywords = aiBridgeKeywords.length > 0
    ? aiBridgeKeywords
    : compactKeywords(
        isPrelude && targetMainKeyword && targetMainKeyword !== mainKeyword ? [targetMainKeyword] : [],
        3
      );

  // internalLinkAnchors: 항상 빈 배열 — 글 제목은 키워드가 아님
  const internalLinkAnchors: string[] = [];

  // subKeywords: seriesDetailPlan > AI > directIntent > plan.keywords (sanitize 적용)
  const rawSubCandidates = [
    ...seriesDetailSecondaryKws,
    ...aiSubKeywords,
    ...(directIntent?.subKeywords ?? []).map(sanitizeAiKeyword).filter((kw): kw is string => kw !== null).filter((kw) => !isGenericKeyword(kw)),
    ...(plan.keywords ?? [])
      .map(sanitizeAiKeyword)
      .filter((kw): kw is string => kw !== null)
      .filter((kw) => !isGenericKeyword(kw)),
    ...(plan.targetSearchCombinations ?? [])
      .map((item) => sanitizeAiKeyword(item.phrase))
      .filter((kw): kw is string => kw !== null)
      .filter((kw) => !isGenericKeyword(kw)),
  ];

  const mainLower = mainKeyword.toLowerCase();
  const subKeywords: string[] = [];
  const seen = new Set<string>([mainLower]);
  for (const kw of rawSubCandidates) {
    const lower = kw.toLowerCase();
    if (seen.has(lower)) continue;
    if (isGenericKeyword(kw)) continue;
    if (bridgeKeywords.some((b) => lower.includes(b.toLowerCase()) || b.toLowerCase().includes(lower))) continue;
    seen.add(lower);
    subKeywords.push(kw);
    if (subKeywords.length >= 7) break;
  }

  const limitedKeywords = [
    { keyword: mainKeyword, min: isPrelude ? 2 : 4, max: isPrelude ? 4 : 7, role: "main" as const },
    ...subKeywords.slice(0, 7).map((keyword) => ({ keyword, min: 1, max: 3, role: "sub" as const })),
    ...bridgeKeywords.map((keyword) => ({ keyword, min: 1, max: 2, role: "bridge" as const })),
    ...internalLinkAnchors.map((keyword) => ({ keyword, min: 0, max: 2, role: "anchor" as const })),
  ];

  return {
    title: plan.title,
    articleType,
    articleStage,
    searchIntent:
      topic.seriesDetailPlan?.searchIntent ??
      topicIntentResolution.searchIntent ??
      plan.rationale ??
      topic.description,
    topology: topologyKind,
    bodyRole: isPrelude
      ? "본편 추천 글로 바로 경쟁하지 않고 선택 기준을 먼저 정리해 다음 글로 자연스럽게 넘기는 워밍업 본문"
      : "독자의 검색 의도에 직접 답하고 필요한 비교, 설명, 상담 맥락을 완결하는 본문",
    mainKeyword,
    subKeywords,
    bridgeKeywords,
    internalLinkAnchors,
    forbiddenTerms: BODY_FORBIDDEN_TERMS,
    limitedKeywords,
    subKeywordRoles: topicIntentResolution.keywordAssignments,
    productCandidates: topicIntentResolution.productCandidates,
    comparisonTargets: topicIntentResolution.comparisonTargets,
    excludedTopics: isPrelude
      ? ["제품명 나열", "TOP5 순위", "구체 추천 기기 비교", targetMainKeyword].filter(Boolean)
      : [],
    handoffTopics: isPrelude && targetMainKeyword ? [targetMainKeyword, "구체 제품 후보", "추천 TOP5"] : [],
    differentiationPoints: isPrelude
      ? [
          "이 글은 선택 기준을 정리하고 본편 추천 글은 구체 제품 후보를 다룬다.",
          "지역명은 실제 상담 맥락에서만 사용하고 억지 반복하지 않는다.",
        ]
      : ["기존 글과 같은 제목/목차를 반복하지 않고 현재 검색 의도에만 답한다."],
  };
}

export async function runStrategyPlanner(params: {
  topicId: string;
  userId: string;
  duplicateModeOverride?: DuplicateMode;
  modifications?: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<StrategyPlanResult> {
  const { topicId, onProgress, signal } = params;
  const userId = normalizeUserId(params.userId);
  const topic = await loadTopic(topicId);
  const rawDirectIntent = extractDirectKeywordIntent(topic);
  const directIntent = sanitizeDirectIntent(rawDirectIntent);
  const topicIntentResolution = resolveTopicIntent({
    title: topic.title,
    description: topic.description,
    mainKeyword: directIntent?.mainKeyword ?? topic.targetMainKeyword ?? topic.tags[0] ?? "",
    subKeywords: directIntent?.subKeywords ?? topic.subKeywords ?? topic.tags.slice(1),
    seriesRole: topic.seriesRole,
  });
  const publicationLearning = await getPublicationLearningSummary(userId);

  onProgress?.(`토픽 "${topicId}" 전략 수립 시작`);

  const researchKeyword = [
    directIntent?.mainKeyword ?? "",
    ...topic.tags
      .map((keyword) => sanitizeMainKeywordCandidate(keyword) ?? "")
      .filter(Boolean),
    sanitizeMainKeywordCandidate(topic.targetMainKeyword ?? "") ?? "",
    sanitizeMainKeywordCandidate(topic.title) ?? "",
    topic.category,
  ].find(Boolean) ?? topic.title;

  onProgress?.("네이버 카페 수요 신호 확인 중...");
  const [cafeResearch, kinResearch] = await Promise.all([
    naverCafeSearch({ keyword: researchKeyword, display: 15 }),
    naverKinSearch({ keyword: researchKeyword, display: 15 }),
  ]);
  const communityResearchBrief = buildCommunityResearchBrief({
    cafeSummary: cafeResearch.demandSummary,
    kinSummary: kinResearch.problemSummary,
  });

  const toolRegistry = {
    user_profile_loader: (input: unknown) =>
      userProfileLoader(input as Parameters<typeof userProfileLoader>[0]),
    user_corpus_retriever: (input: unknown) =>
      userCorpusRetriever(input as Parameters<typeof userCorpusRetriever>[0]),
    topic_feasibility_judge: (input: unknown) => {
      const cast = input as Parameters<typeof topicFeasibilityJudge>[0];
      return Promise.resolve(topicFeasibilityJudge(cast));
    },
    source_resolver: (input: unknown) =>
      sourceResolver(input as Parameters<typeof sourceResolver>[0]),
    review_record_audit: (input: unknown) =>
      reviewRecordAudit(input as Parameters<typeof reviewRecordAudit>[0]),
    naver_keyword_research: (input: unknown) =>
      naverKeywordResearch(input as Parameters<typeof naverKeywordResearch>[0]),
    naver_content_fetcher: (input: unknown) =>
      naverContentFetcher(input as Parameters<typeof naverContentFetcher>[0]),
    naver_cafe_search: (input: unknown) =>
      naverCafeSearch(input as Parameters<typeof naverCafeSearch>[0]),
    naver_kin_search: (input: unknown) =>
      naverKinSearch(input as Parameters<typeof naverKinSearch>[0]),
  };

  const localTimeoutSignal = AbortSignal.timeout(STRATEGY_LOOP_TIMEOUT_MS);
  const plannerSignal = signal
    ? AbortSignal.any([signal, localTimeoutSignal])
    : localTimeoutSignal;

  let plan: StrategyPlanResult;
  try {
    onProgress?.("strategy-planner 에이전트 실행 중...");
    const result = await runToolUseLoop({
      model: MODELS.sonnet,
      system: buildPolicySystemPrompt(),
      messages: [{
        role: "user",
        content:
          buildUserMessage(topic, topicId, userId, directIntent, publicationLearning, params.duplicateModeOverride) +
          `\n\n${communityResearchBrief}` +
          (params.modifications?.trim()
            ? `\n\n## 전략 수정 요청\n사용자가 이전 전략에 대해 다음 수정을 요청했습니다. 반드시 아래 내용을 전략에 반영하세요:\n${params.modifications.trim()}`
            : "") +
          `\n\nRequired research focus before final JSON:\n` +
          `- Use naver_cafe_search to identify current product demand, repeated comparison language, and real community interest.\n` +
          `- Use naver_kin_search to identify repeated questions, confusion, and pain points users ask about.\n` +
          `- Reflect those findings in the strategy so the draft answers real demand instead of only generic keyword intent.`,
      }],
      tools: TOOLS,
      toolRegistry,
      maxIterations: 8,
      onProgress,
      signal: plannerSignal,
    });

    onProgress?.("전략 계획 파싱 중...");
    plan = parseStrategyFromText(result);
    if (!plan.title || typeof plan.title !== "string") {
      throw new Error("전략 파싱 실패: title 필드가 비어 있습니다.");
    }
    plan = {
      ...plan,
      strategySource: "ai",
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("파이프라인 취소 - 전략 수립 중단");
    }

    const fallbackReason = stringifyStrategyError(error);
    if (isFatalStrategyProviderError(error)) {
      onProgress?.(ANTHROPIC_CREDIT_BLOCK_MESSAGE);
      throw new Error(`${ANTHROPIC_CREDIT_BLOCK_MESSAGE} 원문: ${fallbackReason}`);
    }

    console.warn("[strategy-planner] tool-use 루프/파싱 실패, 안전 폴백 전략으로 전환:", String(error));
    onProgress?.("AI 전략 수립에 실패해 안전 폴백을 만들었지만, 발행용 writer 실행은 차단합니다.");
    plan = {
      ...buildLocalFallbackStrategy(topic),
      strategySource: "local_fallback",
      strategyFallbackReason: fallbackReason,
    };
  }

  plan = sanitizeStrategyLanguage(applyDirectKeywordPriority(plan, directIntent));

  const contentTopology = await buildContentTopologyPlan({ topic, strategy: plan, userId });
  const targetSearchCombinations = buildTargetSearchCombinations({ topic, plan, directIntent });
  const naverLogic = naverLogicAgent.planBeforeWriting({ ...plan, contentTopology });
  plan = {
    ...plan,
    topicIntentResolution,
    targetSearchCombinations,
    contentTopology,
    publicationLearning,
    naverSignals: {
      keyword: researchKeyword,
      cafeDemandSummary: cafeResearch.demandSummary,
      kinProblemSummary: kinResearch.problemSummary,
      cafeTopItems: cafeResearch.items.map((item) => ({
        title: item.title,
        link: item.link,
        description: item.description,
      })),
      kinTopItems: kinResearch.items.map((item) => ({
        title: item.title,
        link: item.link,
        description: item.description,
      })),
    },
    naverLogic,
  };
  plan = {
    ...plan,
    keywordContract: buildKeywordContract({
      topic,
      plan,
      topologyKind: contentTopology.kind,
      topicIntentResolution,
      directIntent,
    }),
  };
  plan = {
    ...plan,
    articleContract: buildArticleContract({ topic, plan }),
  };
  plan = {
    ...plan,
    articlePlan: buildArticlePlan({
      topic,
      plan,
      topicIntentResolution,
      duplicateMode: params.duplicateModeOverride,
    }),
  };
  const existingArticles = await loadExistingArticleSummariesForUser(userId);
  const currentContract = plan.articleContract;
  const currentKeywordContract = plan.keywordContract;
  if (!currentContract || !currentKeywordContract) {
    throw new Error("articleContract 또는 keywordContract가 생성되지 않아 overlapReport를 만들 수 없습니다.");
  }
  plan = {
    ...plan,
    overlapReport: buildOverlapReport({
      currentTitle: plan.title,
      articleRole: currentContract.articleRole,
      nodeType: currentContract.nodeType,
      introPattern: currentContract.introPattern,
      conclusionPattern: currentContract.conclusionPattern,
      ctaMode: currentContract.ctaMode,
      targetKeyword: currentKeywordContract.mainKeyword,
      searchIntent: currentContract.mainIntent,
      handoffKeyword: currentContract.handoffKeyword,
      internalLinkTargets: plan.contentTopology?.internalLinkTargets.map((item) => item.title) ?? [],
      existingArticles,
    }),
  };
  plan = {
    ...plan,
    strategyQualityGate: evaluatePublishableStrategyGate(plan),
  };

  if (topic.seriesRole === "prelude" || topic.seriesRole === "main") {
    plan = {
      ...plan,
      seriesRole: topic.seriesRole,
      targetMainKeyword: topic.targetMainKeyword,
      keywordContract: buildKeywordContract({
        topic,
        plan: { ...plan, seriesRole: topic.seriesRole, targetMainKeyword: topic.targetMainKeyword },
        topologyKind: contentTopology.kind,
        topicIntentResolution,
        directIntent,
      }),
    };
    plan = {
      ...plan,
      articleContract: buildArticleContract({ topic, plan }),
    };
    plan = {
      ...plan,
      articlePlan: buildArticlePlan({
        topic,
        plan,
        topicIntentResolution,
        duplicateMode: params.duplicateModeOverride,
      }),
    };
    const seriesContract = plan.articleContract;
    const seriesKeywordContract = plan.keywordContract;
    if (!seriesContract || !seriesKeywordContract) {
      throw new Error("series articleContract 또는 keywordContract가 생성되지 않아 overlapReport를 만들 수 없습니다.");
    }
    plan = {
      ...plan,
      overlapReport: buildOverlapReport({
        currentTitle: plan.title,
        articleRole: seriesContract.articleRole,
        nodeType: seriesContract.nodeType,
        introPattern: seriesContract.introPattern,
        conclusionPattern: seriesContract.conclusionPattern,
        ctaMode: seriesContract.ctaMode,
        targetKeyword: seriesKeywordContract.mainKeyword,
        searchIntent: seriesContract.mainIntent,
        handoffKeyword: seriesContract.handoffKeyword,
        internalLinkTargets: plan.contentTopology?.internalLinkTargets.map((item) => item.title) ?? [],
        existingArticles,
      }),
    };
    plan = {
      ...plan,
      strategyQualityGate: evaluatePublishableStrategyGate(plan),
    };
  }
  if (plan.strategyQualityGate && !plan.strategyQualityGate.ok) {
    onProgress?.(`전략 수립 실패: ${plan.strategyQualityGate.blockingReasons.join(" / ")}`);
    return plan;
  }
  if (plan.strategyQualityGate?.warnings.length) {
    onProgress?.(`계약 경고: ${plan.strategyQualityGate.warnings.join(" / ")}`);
  }
  onProgress?.(`전략 수립 완료: "${plan.title}" (${contentTopology.kind === "hub" ? "허브글" : "리프글"})`);
  onProgress?.(
    `네이버 작성 로직 검토 완료: ${naverLogicAgent.formatLabel(naverLogic.primary)} / 목표 완성도 ${naverLogic.completenessTarget}%`
  );
  return plan;
}

export async function runStrategyPlannerSimple(params: {
  topicTitle: string;
  topicDescription: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<StrategyPlanResult> {
  const client = getAnthropicClient();
  const callSignal = params.signal
    ? AbortSignal.any([AbortSignal.timeout(SIMPLE_STRATEGY_TIMEOUT_MS), params.signal])
    : AbortSignal.timeout(SIMPLE_STRATEGY_TIMEOUT_MS);

  const response = await client.messages.create(
    {
      model: MODELS.sonnet,
      system: buildPolicySystemPrompt(),
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            `토픽 제목: ${params.topicTitle}`,
            `설명: ${params.topicDescription}`,
            `사용자 ID: ${params.userId}`,
            "",
            "전략 JSON만 출력해 주세요.",
          ].join("\n"),
        },
      ],
    },
    { signal: callSignal }
  );

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("전략 응답이 비어 있습니다.");
  }
  return parseStrategyFromText(text.text);
}
