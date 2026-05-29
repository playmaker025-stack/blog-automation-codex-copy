import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicClient, MODELS } from "@/lib/anthropic/client";
import { userCorpusRetriever } from "@/lib/skills/user-corpus-retriever";
import { expansionPlanner } from "@/lib/skills/expansion-planner";
import { sourceResolver } from "@/lib/skills/source-resolver";
import { writeFile, readFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { hasOpenAIKey, requestOpenAIText } from "@/lib/openai/responses";
import { randomUUID } from "crypto";
import type { ContentTopologyPlan, StrategyPlanResult, WriterResult } from "./types";
import type { CorpusSummaryArtifact } from "./corpus-selector";
import { buildPolicyPromptSection, SEO_PASS_THRESHOLD } from "./blog-workflow-policy";
import { naverLogicAgent } from "./naver-logic-agent";
import { classifySearchCombination } from "./search-combination-utils";
import {
  buildRoleSpecificWriterGuidance,
  evaluateStrategyQualityGate,
  formatArticleContract,
} from "./article-contract-utils";
import { formatOverlapReport } from "./overlap-report-utils";
import { runFinalDraftCheck, runLimitedFinalDraftRewrite } from "./final-draft-check";

// ============================================================
// 발행용 본문은 이 에이전트만 작성한다 — 핵심 원칙
// ============================================================

// 네이버 블로그 줄바꿈 규칙: 모바일에서 읽기 쉽게 어절 단위로 래핑
function wrapTextByWords(content: string, max: number, prefix = ""): string[] {
  const words = content.split(/(\s+)/).filter(Boolean);
  const result: string[] = [];
  let current = prefix;

  for (const word of words) {
    const candidate = `${current}${word}`;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }

    if (current.trim()) {
      result.push(current.trimEnd());
      current = prefix;
    }

    const bareWord = word.trim();
    if (bareWord && `${prefix}${bareWord}`.length > max) {
      let remaining = bareWord;
      const available = Math.max(1, max - prefix.length);
      while (remaining.length > available) {
        result.push(`${prefix}${remaining.slice(0, available)}`);
        remaining = remaining.slice(available);
      }
      current = remaining ? `${prefix}${remaining}` : prefix;
      continue;
    }

    current = `${prefix}${word.trimStart()}`;
  }

  if (current.trim()) {
    result.push(current.trimEnd());
  }

  return result;
}

export function wrapForNaverMobile(text: string): string {
  const MAX = 26;
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();

    // 빈 줄 또는 구분선 → 그대로
    if (trimmed === "" || /^-{3,}$/.test(trimmed)) {
      result.push(line);
      continue;
    }

    // 마크다운 헤더(#), URL 단독 라인, 마크다운 링크 단독 라인 → 그대로
    if (
      trimmed.startsWith("#") ||
      /^https?:\/\/\S+$/i.test(trimmed) ||
      /^\[[^\]]+\]\([^)]+\)$/.test(trimmed)
    ) {
      result.push(line);
      continue;
    }

    const listMatch = line.match(/^(\s*(?:[-*]|\d+\.)\s+)(.+)$/);
    if (listMatch) {
      const [, marker, content] = listMatch;
      if (`${marker}${content}`.length <= MAX) {
        result.push(line);
        continue;
      }
      result.push(...wrapTextByWords(content, MAX, marker));
      continue;
    }

    if (line.length <= MAX) {
      result.push(line);
      continue;
    }

    result.push(...wrapTextByWords(line, MAX));
  }

  return result.join("\n");
}

function stripExcerptMeta(excerpt: string): string {
  return excerpt
    .replace(/^[\d\s./·:]+작성\s*/u, "")
    .replace(/^레퍼런스\s*\d+\s*/u, "")
    .replace(/^제목\s*=\s*/u, "")
    .trim();
}

function buildCorpusSummarySection(corpus: CorpusSummaryArtifact): string {
  const { styleProfile, exemplarExcerpts, representativeExcerpts = [] } = corpus;

  const representativeSection = representativeExcerpts.length > 0
    ? `\n\n## 실제 발행 글 발췌 (문체 직접 참고)\n이 블로그에서 실제 발행된 글의 일부입니다. 이 말투와 문장 흐름을 그대로 재현하세요.\n${representativeExcerpts
        .slice(0, 5)
        .map((excerpt, i) => `### 발행 글 ${i + 1}\n${excerpt}`)
        .join("\n\n")}`
    : "";

  return `
## 사용자 스타일 프로필 (corpus summary)
- 주요 어투: ${styleProfile.dominantTone}
- 평균 글자수: ${styleProfile.avgWordCount}자
- 서두 패턴: ${styleProfile.openingPattern}
- 구조 패턴: ${styleProfile.structurePattern}
- 시그니처 표현: ${styleProfile.signatureExpressions.join(", ") || "없음"}

## 예시 글 발췌 (${exemplarExcerpts.length}개)
${exemplarExcerpts
  .map(
    (e, i) =>
      `### 예시 ${i + 1}: ${e.title}\n스타일 메모: ${e.styleNotes}\n발췌: ${stripExcerptMeta(e.excerpt)}`
  )
  .join("\n\n")}${representativeSection}`;
}

function buildContentTopologySection(topology: ContentTopologyPlan | undefined): string {
  if (!topology) {
    return `
콘텐츠 구조 판단: 미지정
- 본문 작성 전에 주제가 넓은 허브글인지, 좁은 리프글인지 판단한 뒤 구조에 반영하세요.
- 허브글이면 전체 기준과 하위 주제 안내를 넣고, 리프글이면 상위 주제와의 관계와 구체 사례를 넣으세요.`;
  }

  const kindLabel = topology.kind === "hub" ? "허브글" : "리프글";
  const requiredSections = topology.requiredSections
    .map((section) => `- ${section}`)
    .join("\n");
  const linkTargets = topology.internalLinkTargets.length
    ? topology.internalLinkTargets
        .map((target) => {
          const url = target.url ? ` (${target.url})` : "";
          return `- [${target.role.toUpperCase()}] ${target.title}${url}: ${target.reason}`;
        })
        .join("\n")
    : "- 아직 확정된 내부 링크 후보가 없으므로, 실제 URL을 지어내지 말고 관련 주제 안내 문장만 자연스럽게 넣으세요.";

  return `
콘텐츠 구조 판단: ${kindLabel}
- 판단 근거: ${topology.reason}
- 검색 의도: ${topology.searchIntent}
- 본문 반영 위치: ${topology.bodyPlacement}

본문에 반드시 반영할 구조 요소:
${requiredSections}

내부 연결 후보:
${linkTargets}

작성 규칙:
- 본문 안에서 허브/리프 역할이 독자가 느낄 수 있게 구성하세요.
- 단, "이 글은 허브글입니다", "이 글은 리프글입니다" 같은 메타 문장은 쓰지 마세요.
- 허브글은 넓은 기준 정리, 하위 주제 안내, 다음에 볼 글 흐름을 넣으세요.
- 리프글은 상위 주제와의 관계를 짧게 짚고, 구체 상황/선택 기준/사례 중심으로 깊게 쓰세요.
- 내부 링크 URL이 있으면 마무리 근처에 자연스럽게 넣고, URL이 없으면 제목만 지어내지 말고 관련 주제 안내로 처리하세요.`;
}

const buildSystemPrompt = (
  userId: string,
  corpus: CorpusSummaryArtifact | null,
  harnessBriefing?: string
) => {
  const corpusSection =
    corpus
      ? buildCorpusSummarySection(corpus)
      : `사용자 "${userId}"의 예시 글을 user_corpus_retriever로 로드하여 스타일을 분석하세요.`;

  const step1 = corpus
    ? "1. 아래 코퍼스 summary를 바탕으로 스타일 분석 (별도 로드 불필요)"
    : `1. user_corpus_retriever로 사용자 "${userId}"의 예시 글 로드 후 스타일 분석`;

  return `당신은 네이버 블로그 본문 작성 전문가입니다.
이 에이전트만이 발행 가능한 본문을 작성할 수 있습니다.

## 작업 순서
${step1}
2. expansion_planner로 아웃라인 상세 확장
3. (필요 시) source_resolver로 참조 URL 내용 확인
4. 코퍼스 스타일을 완전히 재현한 한국어 본문 작성

## 글쓰기 원칙
- 코퍼스 스타일 완전 모방: 예시 글의 문체, 어투, 개인 표현 그대로 사용
- 한국어 전용: 영어 단어는 해당 한국어가 없을 때만 사용
- 금지 표현 절대 사용 금지
- 자연스러운 키워드 삽입 (억지 삽입 금지)
- 독자 관점에서 실제 유용한 내용 중심
- 전략에 포함된 콘텐츠 구조 판단이 허브글인지 리프글인지 확인하고 본문 구조에 반드시 반영
- 일반 글은 핵심 답변을 다음 글로 미루지 않고 이 글 안에서 완결
- 첫 2문단은 실제 손님 질문이나 상황에서 시작
- '한 번에 정리', '실패 없는 선택', '체크포인트', '핵심 포인트' 같은 AI형 표현과 소제목 금지

## 출력 형식
전략에 따른 마크다운 본문 전체를 출력한다. 설명·메타 정보 없이 본문만 출력한다.

${corpusSection}

${harnessBriefing ?? ""}`;
};

const CORPUS_TOOL: Tool = {
  name: "user_corpus_retriever",
  description: "사용자 예시 글 코퍼스를 로드합니다.",
  input_schema: {
    type: "object" as const,
    properties: {
      userId: { type: "string" },
      limit: { type: "number" },
      category: { type: "string" },
    },
    required: ["userId"],
  },
};

const BASE_TOOLS: Tool[] = [
  {
    name: "expansion_planner",
    description: "아웃라인을 받아 섹션별 상세 작성 방향을 계획합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        outline: { type: "array", description: "OutlineSection 배열" },
        targetLength: { type: "number", description: "목표 글자수" },
        tone: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
      },
      required: ["outline", "targetLength", "tone", "keywords"],
    },
  },
  {
    name: "source_resolver",
    description: "참조 URL 내용을 확인합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        urls: { type: "array", items: { type: "string" } },
      },
      required: ["urls"],
    },
  },
];

function getKeywordPlacementTargets(_estimatedLength: number): {
  mainMin: number;
  mainMax: number;
  secondaryMin: number;
  secondaryMax: number;
} {
  return { mainMin: 4, mainMax: 7, secondaryMin: 1, secondaryMax: 3 };
}

function buildKeywordPlacementGuidance(strategy: StrategyPlanResult): string[] {
  const contract = strategy.keywordContract;
  const primaryKeyword = contract?.mainKeyword || strategy.keywords[0] || "none";
  const secondaryKeyword = contract?.subKeywords[0] || strategy.keywords[1] || "none";
  const targets = getKeywordPlacementTargets(strategy.estimatedLength);
  const mainLimit = contract?.limitedKeywords.find((item) => item.role === "main");
  const bridgeLimits = contract?.limitedKeywords.filter((item) => item.role === "bridge") ?? [];
  const primaryTokens = primaryKeyword
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  return [
    `- Primary keyword: '${primaryKeyword}'`,
    `- Keep the primary keyword as the article's fixed center. Recommended body usage: ${mainLimit ? `${mainLimit.min}-${mainLimit.max}` : `${targets.mainMin}-${targets.mainMax}`} times.`,
    "- Include the primary keyword in the title, preferably close to the front.",
    "- Include the primary keyword in the first sentence or at least the first paragraph.",
    "- Include the primary keyword again within the first 2 paragraphs.",
    "- Include the primary keyword in at least one main subheading.",
    "- Include the primary keyword once more in the final summary/conclusion paragraph.",
    "- Do not place the primary keyword repeatedly in back-to-back sentences.",
    primaryTokens.length >= 2
      ? `- The primary keyword is a compound phrase (${primaryTokens.join(", ")}). Do not repeat every component token in every paragraph. Keep the exact phrase mostly to the title, intro, one key subheading, one body paragraph, and the conclusion.`
      : "- Avoid repeating the same noun stem in consecutive paragraphs just to force keyword counts.",
    primaryTokens.length >= 2
      ? "- If a component token starts feeling repetitive, replace some repeats with concrete device criteria, use cases, examples, or pronouns instead of echoing the same noun again."
      : "- If the keyword starts feeling repetitive, reduce duplicate echoes and replace them with concrete criteria, examples, or decision language.",
    `- Secondary keyword: '${secondaryKeyword}'. Use it only as supporting context, around ${targets.secondaryMin}-${targets.secondaryMax} times when it fits naturally.`,
    "- A secondary keyword must not replace the article's main angle or dominate headings over the primary keyword.",
    ...bridgeLimits.map((item) => `- Bridge keyword '${item.keyword}' is only for handoff to the next article. Keep it within ${item.min}-${item.max} body mentions and do not turn this article into that main topic.`),
    ...(contract?.forbiddenTerms ?? []).map((term) => `- Forbidden in published body: '${term}'.`),
    "- If the draft reads stuffed, reduce duplicate phrases and replace some repeats with practical criteria, examples, or decision language.",
  ];
}

function formatKeywordContract(strategy: StrategyPlanResult): string {
  const contract = strategy.keywordContract;
  if (!contract) return "Keyword contract is unavailable. Use only the provided strategy keywords and avoid extracting random words from the draft.";

  return [
    "[키워드 계약서]",
    `글 제목: ${contract.title}`,
    `글 타입: ${contract.articleType}`,
    `글 단계: ${contract.articleStage}`,
    `검색의도: ${contract.searchIntent}`,
    `허브/리프: ${contract.topology}`,
    `본문 역할: ${contract.bodyRole}`,
    "",
    `이 글이 먹을 메인 키워드: ${contract.mainKeyword}`,
    `서브 키워드: ${contract.subKeywords.join(", ") || "없음"}`,
    `다음 글로 넘길 브릿지 키워드: ${contract.bridgeKeywords.join(", ") || "없음"}`,
    `내부링크 앵커: ${contract.internalLinkAnchors.join(", ") || "없음"}`,
    `본문 금지어: ${contract.forbiddenTerms.join(", ")}`,
    `반복 제한: ${contract.limitedKeywords.map((item) => `${item.keyword} ${item.min}-${item.max}회/${item.role}`).join(" / ")}`,
    "",
    `이 글에서 다루지 않을 내용: ${contract.excludedTopics.join(", ") || "없음"}`,
    `다음 글로 넘길 내용: ${contract.handoffTopics.join(", ") || "없음"}`,
    `기존 글과 겹치지 않게 분리할 포인트: ${contract.differentiationPoints.join(" / ") || "없음"}`,
    "",
    "중요: 위 계약서는 작성자가 지키는 내부 기준입니다. 발행 본문에는 '키워드 계약서', '검색의도', '메인 키워드', '서브 키워드', '선행포스팅', '키워드빌드업', 'SEO 점수' 같은 작업용 표현을 쓰지 마세요.",
  ].join("\n");
}

function formatOpenAICorpus(corpus: CorpusSummaryArtifact | undefined): string {
  if (!corpus) {
    return [
      "Corpus summary is unavailable.",
      "Do not state that the profile could not be loaded in the draft.",
      "Use a warm, practical Korean Naver Blog tone and keep the content specific.",
    ].join("\n");
  }

  const representativeSection = (corpus.representativeExcerpts ?? []).length > 0
    ? [
        "",
        "Published post excerpts (directly replicate this tone and sentence flow):",
        ...(corpus.representativeExcerpts ?? []).slice(0, 5).map((excerpt, i) =>
          `[Published ${i + 1}]\n${excerpt}`
        ),
      ]
    : [];

  return [
    `Dominant tone: ${corpus.styleProfile.dominantTone}`,
    `Average length reference: ${corpus.styleProfile.avgWordCount}`,
    `Opening pattern: ${corpus.styleProfile.openingPattern}`,
    `Structure pattern: ${corpus.styleProfile.structurePattern}`,
    `Signature expressions: ${corpus.styleProfile.signatureExpressions.join(", ") || "none"}`,
    "",
    "Reference excerpts:",
    ...corpus.exemplarExcerpts.slice(0, 4).map((item, index) =>
      `${index + 1}. ${item.title}\nStyle notes: ${item.styleNotes}\nExcerpt: ${stripExcerptMeta(item.excerpt)}`
    ),
    ...representativeSection,
  ].join("\n");
}

function formatOpenAITopology(topology: ContentTopologyPlan | undefined): string {
  if (!topology) {
    return [
      "Content topology: unknown.",
      "Decide whether this should behave as a broad hub post or a concrete leaf post.",
      "If it is hub-like, organize criteria and lead readers toward related subtopics.",
      "If it is leaf-like, make the situation, choice criteria, and examples concrete.",
    ].join("\n");
  }

  const links = topology.internalLinkTargets.length
    ? topology.internalLinkTargets
        .map((target) => `- [${target.role}] ${target.title}${target.url ? ` (${target.url})` : ""}: ${target.reason}`)
        .join("\n")
    : "- No confirmed internal links. Mention related topic directions naturally, without fake URLs.";

  return [
    `Content topology: ${topology.kind}`,
    `Reason: ${topology.reason}`,
    `Search intent: ${topology.searchIntent}`,
    `Body placement: ${topology.bodyPlacement}`,
    "Required sections:",
    ...topology.requiredSections.map((section) => `- ${section}`),
    "Internal link candidates:",
    links,
    "Exact anchor rule:",
    "- If a reference has both a title and URL, use that exact title with that exact URL.",
    "- Never paraphrase a saved linked title into a different title while keeping the old URL.",
    "- Never attach a hub title to a leaf URL or a leaf title to a hub URL.",
  ].join("\n");
}

function formatOpenAIPublicationLearning(strategy: StrategyPlanResult): string {
  const summary = strategy.publicationLearning;
  if (!summary) {
    return [
      "Publication learning signals: unavailable.",
      "Use the strategy, corpus summary, and current search intent as the main guide.",
    ].join("\n");
  }

  return [
    `Publication learning source: ${summary.source}`,
    `Total published samples: ${summary.totalEntries}`,
    `Average eval score: ${summary.avgEvalScore ?? "none"}`,
    `Average word count: ${summary.avgWordCount ?? "none"}`,
    `Frequent title keywords: ${summary.topKeywords.join(", ") || "none"}`,
    `Dominant content kinds: ${summary.dominantContentKinds.join(", ") || "none"}`,
    `Recent published titles: ${summary.recentTitles.join(" / ") || "none"}`,
    `Best performing title: ${summary.bestPerformingTitle ?? "none"}`,
    ...summary.guidance.map((item) => `- ${item}`),
  ].join("\n");
}

function formatOpenAINaverSignals(strategy: StrategyPlanResult): string {
  const signals = strategy.naverSignals;
  if (!signals) {
    return [
      "Naver research signals: unavailable.",
      "Do not invent market demand or repeated questions without support.",
    ].join("\n");
  }

  const cafeTitles = signals.cafeTopItems?.slice(0, 3).map((item) => item.title).filter(Boolean) ?? [];
  const kinTitles = signals.kinTopItems?.slice(0, 3).map((item) => item.title).filter(Boolean) ?? [];

  return [
    `Research keyword: ${signals.keyword}`,
    `Cafe demand summary: ${signals.cafeDemandSummary || "none"}`,
    `KnowledgeIn problem summary: ${signals.kinProblemSummary || "none"}`,
    `Cafe examples: ${cafeTitles.join(" / ") || "none"}`,
    `KnowledgeIn examples: ${kinTitles.join(" / ") || "none"}`,
  ].join("\n");
}

function formatOpenAIExpandedOutline(strategy: StrategyPlanResult): string {
  const expanded = expansionPlanner({
    outline: strategy.outline,
    targetLength: strategy.estimatedLength,
    tone: strategy.tone,
    keywords: strategy.keywords,
  });

  return expanded.expandedOutline.map((section, index) => [
    `${index + 1}. ${section.heading}`,
    `Direction: ${section.contentDirection}`,
    `Sub-points: ${section.subPoints.join(" / ") || "none"}`,
    `Paragraph target: ${section.estimatedParagraphs}`,
    `Keywords: ${section.keywordsToInclude.join(", ") || "none"}`,
    `Notes: ${section.expandedNotes.join(" / ")}`,
  ].join("\n")).join("\n\n");
}

export function buildOpenAIWriterSystemPrompt(): string {
  return [
    "You are a senior Korean Naver Blog writer focused on search-intent completion and natural local consultation flow.",
    "Write only the publishable Korean markdown body. Do not include meta notes, score explanations, or placeholders.",
    `Target an internal harness score of at least ${SEO_PASS_THRESHOLD} before returning the final draft.`,
    "Before finalizing, silently revise the draft if any dimension would score below 75.",
    "Never say that the user profile, corpus, or examples could not be loaded.",
    "Avoid keyword stuffing, exaggerated guarantees, unsupported best/only claims, and generic filler.",
    "Never expose internal SEO mechanics to readers. Do not write phrases such as keyword buildup, prelude posting, main posting, SEO score, evaluator, harness, corpus, profile, or strategy.",
    "Write like the user's actual blog post, not like an SEO consultant explaining how to rank.",
    "Prioritize these in order: complete the reader's search intent, start from real customer questions or situations, keep a natural Naver mobile reading rhythm, maintain a consultation-style flow, then place keywords naturally.",
    "Do not write sentences just to insert keywords. Solve the reader's situation first, and let the keywords appear naturally inside useful sentences.",
    buildPolicyPromptSection(),
    "When Naver community demand or KnowledgeIn problem signals are provided, make them visible through the article's angle, subheadings, examples, and decision criteria.",
  ].join("\n");
}

export function formatTargetSearchCombinations(strategy: StrategyPlanResult): string {
  const combinations = strategy.targetSearchCombinations ?? [];
  if (combinations.length === 0) {
    return [
      "Target search combinations: unavailable.",
      "Cover the main keyword and the strongest supporting contexts naturally across the article.",
    ].join("\n");
  }

  return [
    "Target search combinations:",
    ...combinations.map((item, index) => {
      const exactAllowed = item.exactInsertionAllowed !== false;
      const visibleTarget = exactAllowed
        ? item.phrase
        : item.displayIntent || classifySearchCombination(item.phrase).displayIntent;
      const insertionRule = exactAllowed
        ? "exact phrase usable when natural"
        : `intent signal only${item.exactBlockReason ? ` (${item.exactBlockReason})` : ""}`;
      return `${index + 1}. ${visibleTarget} [${item.priority}/${item.role}] - ${item.suggestedPlacement} - ${item.rationale} - ${insertionRule}`;
    }),
  ].join("\n");
}

export function buildOpenAIWriterUserPrompt(params: {
  strategy: StrategyPlanResult;
  userId: string;
  corpusSummary?: CorpusSummaryArtifact;
  harnessBriefing?: string;
  revisionInstructions?: string;
}): string {
  const { strategy, userId, corpusSummary, harnessBriefing, revisionInstructions } = params;
  const keywordPlacementGuidance = buildKeywordPlacementGuidance(strategy);
  const contract = strategy.articleContract;
  const roleSpecificGuidance = buildRoleSpecificWriterGuidance(contract);
  return [
    `User id: ${userId.trim().toLowerCase()}`,
    `Title: ${strategy.title}`,
    `Target length: ${strategy.estimatedLength} Korean characters`,
    `Tone: ${strategy.tone}`,
    `Keywords: ${strategy.keywords.join(", ") || "none"}`,
    `Primary keyword: ${strategy.keywords[0] || "none"}`,
    `Secondary keyword: ${strategy.keywords[1] || "none"}`,
    `Key points: ${strategy.keyPoints.join(" / ") || "none"}`,
    `Suggested sources: ${strategy.suggestedSources.join(", ") || "none"}`,
    "",
    "Content topology:",
    formatOpenAITopology(strategy.contentTopology),
    "",
    formatArticleContract(strategy.articleContract),
    "",
    formatOverlapReport(strategy.overlapReport),
    "",
    "Keyword contract:",
    formatKeywordContract(strategy),
    "",
    "Naver logic pre-check:",
    naverLogicAgent.buildWriterBrief(strategy.naverLogic),
    "",
    formatTargetSearchCombinations(strategy),
    "Naver research signals:",
    formatOpenAINaverSignals(strategy),
    "",
    "Publication learning signals:",
    formatOpenAIPublicationLearning(strategy),
    "",
    "Expanded outline:",
    formatOpenAIExpandedOutline(strategy),
    "",
    "Corpus/style reference:",
    formatOpenAICorpus(corpusSummary),
    "",
    "Pre-write harness briefing:",
    harnessBriefing || "No extra harness briefing.",
    "",
    revisionInstructions
      ? `Revision instructions from the failed evaluator:\n${revisionInstructions}`
      : "First draft instructions: write a strong first draft that should pass the evaluator without needing repair.",
    "",
    "Required writing behavior:",
    "- Start with the reader's likely situation or question in the first two paragraphs, not a generic definition.",
    contract?.readerQuestions?.length
      ? `- Reflect 1-2 reader questions naturally in the first two paragraphs: ${contract.readerQuestions.join(" / ")}.`
      : "- Reflect one or two realistic reader questions in the first two paragraphs.",
    "- Treat the keyword contract as the non-negotiable boundary for this article. Do not auto-extract extra keywords from the draft.",
    "- Separate the keyword this article should own from the keyword that should be handed off to the next article.",
    "- Treat the primary keyword as the non-negotiable center of the article. Do not let a secondary or bridge keyword replace the article's main angle.",
    "- Use the secondary keyword only to sharpen context, comparison intent, or the practical scenario around the primary keyword.",
    contract?.mustResolve?.length
      ? `- Resolve every required responsibility in the body: ${contract.mustResolve.join(" / ")}.`
      : "- Resolve the current article's required responsibilities directly in the body.",
    contract?.mustNotDefer?.length
      ? `- Do not defer these items to another post: ${contract.mustNotDefer.join(" / ")}.`
      : "- Do not defer the current article's core answer to another post.",
    strategy.overlapReport
      ? `- Overlap risk is ${strategy.overlapReport.riskLevel}. Avoid repeating the same title direction, intro pattern, conclusion pattern, or CTA from similar existing posts. Follow this rewrite direction: ${strategy.overlapReport.recommendedRewriteDirection}`
      : "- Avoid repeating the same title direction, intro pattern, conclusion pattern, or CTA from earlier posts.",
    ...keywordPlacementGuidance,
    ...roleSpecificGuidance,
    "- Target search combinations are intent coverage signals, not mandatory exact phrases.",
    "- If exact phrase insertion is blocked for a combination, do not write that raw long-tail phrase in the body. Break it into natural sentence parts instead.",
    "- Do not awkwardly list combinations back-to-back. Each paragraph should solve the reader's search intent, not expose the internal combination phrase.",
    "- If content topology provides internal link references with URLs, keep each title-URL pair exact. Do not rewrite, shorten, merge, or swap linked titles.",
    "- If Naver signals are present, answer the repeated community questions and demand patterns directly in the body.",
    "- Never mention internal planning terms in the published body: keyword buildup, prelude posting, main posting, series design, SEO score, evaluator, harness, corpus, profile, or strategy.",
    "- Do not instruct readers to search with the target keyword. Instead, answer the search intent directly with practical local/store/user-context information.",
    "- Make the hub/leaf role visible through structure, not by announcing the words hub or leaf.",
    "- Include practical criteria, examples, and decision points instead of broad advice.",
    contract?.keywordUsagePolicy.avoidSubKeywordStuffingInQuestions
      ? "- Never place mainKeyword or subKeywords as exact phrases inside quoted customer questions."
      : "- Keep reader questions natural even when using secondary keywords.",
    contract?.keywordUsagePolicy.preferContextualSubKeywordUse
      ? "- Customer questions must sound like real spoken customer questions, not SEO keyword containers."
      : "- Place secondary keywords where they sound most natural.",
    contract?.keywordUsagePolicy.preferContextualSubKeywordUse
      ? "- If a keyword is needed, use it in explanation paragraphs, comparison sections, and consultation context, not inside quotes."
      : "- Place secondary keywords where they sound most natural.",
    "- Use concrete criteria and examples before closing, not vague reassurance.",
    "- Keep paragraph rhythm suitable for Naver Blog mobile reading.",
    "- Use headings only when the reader's question changes. Avoid generic headings such as '핵심 기준', '체크포인트', '한 번에 정리', '정리와 다음 확인 포인트'.",
    "- Never use these exact phrases in the published body: '실패 없는 선택', '꼼꼼히 안내', '핵심 포인트', '만족스러운 결과', '도움이 되었길 바랍니다'.",
    "- End with a useful summary or next-step guide that matches the search intent.",
    "- Output only the final body markdown.",
  ].join("\n");
}

const WRITER_PROMPT_TOKEN_BUDGET = {
  input: 9_000,
  output: 4_200,
} as const;

function estimatePromptTokens(text: string): number {
  return Math.ceil(Array.from(text).length / 2.4);
}

function compactList(values: string[], limit = 4): string[] {
  return values.filter(Boolean).slice(0, limit);
}

function buildCompactArticleContractSummary(contract: StrategyPlanResult["articleContract"]): string {
  if (!contract) {
    return [
      "Article contract core: unavailable.",
      "Keep the draft aligned to the direct search intent and finish the answer in this article.",
    ].join("\n");
  }

  return [
    `Article role: ${contract.articleRole}`,
    `Completion mode: ${contract.completionMode}`,
    `Node type: ${contract.nodeType}`,
    `Main intent: ${contract.mainIntent}`,
    `Reader state: ${contract.readerState}`,
    `Must resolve: ${compactList(contract.mustResolve, 5).join(" / ") || "none"}`,
    `Must not defer: ${compactList(contract.mustNotDefer, 4).join(" / ") || "none"}`,
  ].join("\n");
}

function buildCompactKeywordContractSummary(strategy: StrategyPlanResult): string {
  const keywordContract = strategy.keywordContract;
  if (!keywordContract) {
    return [
      "Keyword contract core: unavailable.",
      `Primary keyword fallback: ${strategy.keywords[0] || "none"}`,
      `Supporting keywords fallback: ${compactList(strategy.keywords.slice(1), 4).join(", ") || "none"}`,
    ].join("\n");
  }

  return [
    `Main keyword: ${keywordContract.mainKeyword}`,
    `Sub keywords: ${compactList(keywordContract.subKeywords, 5).join(", ") || "none"}`,
    `Bridge keywords: ${compactList(keywordContract.bridgeKeywords, 3).join(", ") || "none"}`,
    `Forbidden terms: ${compactList(keywordContract.forbiddenTerms, 5).join(", ") || "none"}`,
    `Limited keywords: ${keywordContract.limitedKeywords.slice(0, 5).map((item) => `${item.keyword} ${item.min}-${item.max}`).join(" / ") || "none"}`,
  ].join("\n");
}

function buildOpenAIWriterCompactUserPrompt(params: {
  strategy: StrategyPlanResult;
  userId: string;
  harnessBriefing?: string;
  revisionInstructions?: string;
}): string {
  const { strategy, userId, harnessBriefing, revisionInstructions } = params;
  const contract = strategy.articleContract;
  const roleSpecificGuidance = buildRoleSpecificWriterGuidance(contract).slice(0, 4);
  const keywordPlacementGuidance = buildKeywordPlacementGuidance(strategy).slice(0, 5);
  const overlapLine = strategy.overlapReport
    ? `Overlap guard: ${strategy.overlapReport.riskLevel} / ${strategy.overlapReport.recommendedRewriteDirection}`
    : "Overlap guard: keep the intro, title direction, and CTA distinct from earlier posts.";
  const naverSignalLine = strategy.naverSignals
    ? `Naver signals: cafe ${strategy.naverSignals.cafeDemandSummary || "none"} / kin ${strategy.naverSignals.kinProblemSummary || "none"}`
    : "Naver signals: unavailable.";

  return [
    `User id: ${userId.trim().toLowerCase()}`,
    `Title: ${strategy.title}`,
    `Target length: ${strategy.estimatedLength} Korean characters`,
    `Tone: ${strategy.tone}`,
    `Key points: ${compactList(strategy.keyPoints, 5).join(" / ") || "none"}`,
    "",
    "Compact mode is active because the writer prompt exceeded the token budget.",
    "Keep only the essential structure and keyword responsibilities.",
    "",
    "Article contract core:",
    buildCompactArticleContractSummary(contract),
    "",
    "Keyword contract core:",
    buildCompactKeywordContractSummary(strategy),
    "",
    overlapLine,
    naverSignalLine,
    strategy.topicIntentResolution?.searchIntent
      ? `Resolved search intent: ${strategy.topicIntentResolution.searchIntent}`
      : "Resolved search intent: unavailable.",
    "",
    revisionInstructions
      ? `Revision instructions from the failed evaluator:\n${revisionInstructions}`
      : "First draft instructions: write a strong first draft that should pass the evaluator without needing repair.",
    "",
    "Pre-write harness briefing:",
    harnessBriefing ? harnessBriefing.slice(0, 1200) : "No extra harness briefing.",
    "",
    "Required writing behavior:",
    "- Finish the current search intent inside this article.",
    "- Keep the main keyword stable and use sub keywords only where they clarify context.",
    "- Do not expose internal SEO, workflow, or planning terms.",
    "- Use concrete criteria, realistic user situations, and practical decision points.",
    ...keywordPlacementGuidance,
    ...roleSpecificGuidance,
    "- Output only the final Korean markdown body.",
  ].join("\n");
}

function resolveOpenAIWriterPromptPlan(params: {
  strategy: StrategyPlanResult;
  userId: string;
  corpusSummary?: CorpusSummaryArtifact;
  harnessBriefing?: string;
  revisionInstructions?: string;
}) {
  const systemPrompt = buildOpenAIWriterSystemPrompt();
  const fullUserPrompt = buildOpenAIWriterUserPrompt(params);
  const fullInputTokens = estimatePromptTokens(systemPrompt) + estimatePromptTokens(fullUserPrompt);
  const compactMode = fullInputTokens + WRITER_PROMPT_TOKEN_BUDGET.output > WRITER_PROMPT_TOKEN_BUDGET.input;
  const userPrompt = compactMode
    ? buildOpenAIWriterCompactUserPrompt(params)
    : fullUserPrompt;
  const estimatedInputTokens = estimatePromptTokens(systemPrompt) + estimatePromptTokens(userPrompt);

  return {
    systemPrompt,
    userPrompt,
    compactMode,
    estimatedInputTokens,
    maxOutputTokens: WRITER_PROMPT_TOKEN_BUDGET.output,
  };
}

export function buildOpenAIWriterRevisionPrompt(params: {
  strategy: StrategyPlanResult;
  userId: string;
  firstDraft: string;
  harnessBriefing?: string;
  revisionInstructions?: string;
}): string {
  const { strategy, userId, firstDraft, harnessBriefing, revisionInstructions } = params;
  const contract = strategy.articleContract;
  const mainKeyword = strategy.keywordContract?.mainKeyword || strategy.keywords[0] || "none";
  const subKeywords = strategy.keywordContract?.subKeywords?.slice(0, 5) ?? strategy.keywords.slice(1, 6);
  const mustResolve = contract?.mustResolve?.slice(0, 6) ?? [];
  const mustNotDefer = contract?.mustNotDefer?.slice(0, 4) ?? [];
  const keyPoints = strategy.keyPoints.slice(0, 6);

  return [
    "Revise the Korean blog draft below into the final publishable version.",
    "Keep the article's facts and main angle, but repair weak SEO fit, Naver logic, repetition, and awkward sections.",
    "Output only the final Korean markdown body.",
    "",
    `User id: ${userId.trim().toLowerCase()}`,
    `Title: ${strategy.title}`,
    `Target length: ${strategy.estimatedLength} Korean characters`,
    `Main keyword: ${mainKeyword}`,
    `Sub keywords: ${subKeywords.join(", ") || "none"}`,
    `Article type: ${strategy.keywordContract?.articleType ?? "general_info"}`,
    `Article stage: ${strategy.keywordContract?.articleStage ?? "information"}`,
    `Search intent: ${strategy.keywordContract?.searchIntent ?? strategy.topicIntentResolution?.searchIntent ?? "none"}`,
    `Key points: ${keyPoints.join(" / ") || "none"}`,
    mustResolve.length ? `Must resolve: ${mustResolve.join(" / ")}` : "Must resolve: none",
    mustNotDefer.length ? `Must not defer: ${mustNotDefer.join(" / ")}` : "Must not defer: none",
    "",
    "Revision priorities:",
    "- Preserve the article's actual topic and reader intent.",
    "- Reduce repeated or stuffed keyword phrasing.",
    "- Keep the introduction concrete and situation-based.",
    "- Make each section solve a reader question directly.",
    "- Remove meta/internal SEO wording completely.",
    revisionInstructions
      ? `- Failed evaluator instructions: ${revisionInstructions}`
      : "- No failed evaluator instructions were provided.",
    harnessBriefing
      ? `- Pre-write harness briefing to respect: ${harnessBriefing}`
      : "- No extra harness briefing was provided.",
    "",
    "Draft to revise:",
    firstDraft,
  ].join("\n");
}

export function buildOpenAIWriterPayloadPreview(params: {
  strategy: StrategyPlanResult;
  userId: string;
  corpusSummary?: CorpusSummaryArtifact;
  harnessBriefing?: string;
  revisionInstructions?: string;
  model?: string;
}): {
  model: string;
  input: Array<{ role: "system" | "user"; content: string }>;
  maxOutputTokens: number;
  temperature: number;
  compactMode: boolean;
  estimatedInputTokens: number;
} {
  const { strategy, userId, corpusSummary, harnessBriefing, revisionInstructions } = params;
  const promptPlan = resolveOpenAIWriterPromptPlan({
    strategy,
    userId,
    corpusSummary,
    harnessBriefing,
    revisionInstructions,
  });
  return {
    model: params.model ?? process.env.OPENAI_WRITER_MODEL ?? "gpt-4.1",
    input: [
      { role: "system", content: promptPlan.systemPrompt },
      {
        role: "user",
        content: promptPlan.userPrompt,
      },
    ],
    maxOutputTokens: promptPlan.maxOutputTokens,
    temperature: 0.55,
    compactMode: promptPlan.compactMode,
    estimatedInputTokens: promptPlan.estimatedInputTokens,
  };
}

async function runOpenAIMasterWriter(params: {
  strategy: StrategyPlanResult;
  userId: string;
  topicId: string;
  postId?: string;
  corpusSummary?: CorpusSummaryArtifact;
  harnessBriefing?: string;
  revisionInstructions?: string;
  onToken?: (token: string) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<WriterResult> {
  const {
    strategy,
    userId,
    topicId,
    postId,
    corpusSummary,
    harnessBriefing,
    revisionInstructions,
    onToken,
    onProgress,
    signal,
  } = params;

  const model = process.env.OPENAI_WRITER_MODEL ?? "gpt-4.1";
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(420_000)])
    : AbortSignal.timeout(420_000);
  const promptPlan = resolveOpenAIWriterPromptPlan({
    strategy,
    userId,
    corpusSummary,
    harnessBriefing,
    revisionInstructions,
  });

  onProgress?.("Master Writer가 OpenAI로 초안을 작성합니다.");
  if (promptPlan.compactMode) {
    onProgress?.(`Writer 입력이 커서 compact mode로 전환합니다. 예상 입력 토큰 약 ${promptPlan.estimatedInputTokens}개입니다.`);
  }
  const firstDraft = await requestOpenAIText({
    model,
    input: [
      { role: "system", content: promptPlan.systemPrompt },
      { role: "user", content: promptPlan.userPrompt },
    ],
    maxOutputTokens: promptPlan.maxOutputTokens,
    temperature: 0.55,
    signal: callSignal,
    onRetry: (info) => {
      onProgress?.(`AI 요청량 제한으로 약 ${Math.ceil(info.delayMs / 1000)}초 후 자동 재시도합니다. (${info.attempt}차 재시도)`);
    },
  });

  onProgress?.("초안 내부 검수와 SEO 보정을 진행합니다.");
  const finalDraft = await requestOpenAIText({
    model,
    input: [
      { role: "system", content: buildOpenAIWriterSystemPrompt() },
      {
        role: "user",
        content: buildOpenAIWriterRevisionPrompt({
          strategy,
          userId,
          firstDraft,
          harnessBriefing,
          revisionInstructions,
        }),
      },
    ],
    maxOutputTokens: 4200,
    temperature: 0.35,
    signal: callSignal,
    onRetry: (info) => {
      onProgress?.(`보강 초안 작성 중 AI 요청량 제한이 발생해 약 ${Math.ceil(info.delayMs / 1000)}초 후 자동 재시도합니다. (${info.attempt}차 재시도)`);
    },
  });

  const bodyText = wrapForNaverMobile(finalDraft);
  onToken?.(bodyText);
  onProgress?.("본문 생성 완료 - GitHub에 저장 중입니다.");

  return saveWriterResult({
    strategy,
    topicId,
    postId,
    title: strategy.title,
    content: bodyText,
    overwrite: Boolean(revisionInstructions),
  });
}

export async function runMasterWriter(params: {
  strategy: StrategyPlanResult;
  userId: string;
  topicId: string;
  postId?: string;
  corpusSummary?: CorpusSummaryArtifact;
  harnessBriefing?: string;
  revisionInstructions?: string;
  onToken?: (token: string) => void;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<WriterResult> {
  const {
    strategy,
    userId,
    topicId,
    postId,
    corpusSummary,
    harnessBriefing,
    revisionInstructions,
    onToken,
    onProgress,
    signal,
  } = params;

  const qualityGate = strategy.strategyQualityGate ?? evaluateStrategyQualityGate(strategy);
  if (!qualityGate.ok) {
    throw new Error(`전략 계약서가 불완전해 writer 실행을 차단합니다: ${qualityGate.blockingReasons.join(" / ")}`);
  }

  onProgress?.(corpusSummary ? "Master Writer 시작 - 코퍼스 요약을 적용합니다." : "Master Writer 시작 - 코퍼스를 로드합니다.");

  if (hasOpenAIKey()) {
    return runOpenAIMasterWriter(params);
  }

  const client = getAnthropicClient();
  const TOOLS = corpusSummary ? BASE_TOOLS : [CORPUS_TOOL, ...BASE_TOOLS];
  const toolRegistry = {
    user_corpus_retriever: (input: unknown) =>
      userCorpusRetriever(input as Parameters<typeof userCorpusRetriever>[0]),
    expansion_planner: (input: unknown) => {
      const i = input as Parameters<typeof expansionPlanner>[0];
      return Promise.resolve(expansionPlanner(i));
    },
    source_resolver: (input: unknown) =>
      sourceResolver(input as Parameters<typeof sourceResolver>[0]),
  };

  const revisionSection = revisionInstructions
    ? `\n\n${revisionInstructions}\n\n위 자동 보강 지시를 최우선으로 반영해 전체 본문을 다시 작성해주세요.`
    : "";
  const anthropicKeywordPlacementRules = buildKeywordPlacementGuidance(strategy)
    .map((line) => line.replace(/^- /, "- "))
    .join("\n");
  const anthropicRoleSpecificGuidance = buildRoleSpecificWriterGuidance(strategy.articleContract)
    .map((line) => line.replace(/^- /, "- "))
    .join("\n");

  const userMessage = `다음 전략에 따라 네이버 블로그 본문을 작성해주세요.

제목: ${strategy.title}
목표 글자수: ${strategy.estimatedLength}자
톤: ${strategy.tone}
키워드: ${strategy.keywords.join(", ")}
핵심 포인트: ${strategy.keyPoints.join(" / ")}

${buildContentTopologySection(strategy.contentTopology)}

작성 의무 계약서:
${formatArticleContract(strategy.articleContract)}

role-specific writing directives:
${anthropicRoleSpecificGuidance}

overlap report:
${formatOverlapReport(strategy.overlapReport)}

키워드 계약서:
${formatKeywordContract(strategy)}

Naver logic pre-check:
${naverLogicAgent.buildWriterBrief(strategy.naverLogic)}

${formatTargetSearchCombinations(strategy)}

키워드 배치 규칙:
${anthropicKeywordPlacementRules}

발행 본문 금지 표현:
- 키워드빌드업, 선행포스팅, 메인포스팅, 시리즈 설계, SEO 점수, evaluator, harness, corpus, profile, strategy 같은 내부 작업 용어를 독자에게 노출하지 마세요.
- 독자에게 특정 키워드를 검색해보라고 지시하지 말고, 그 검색 의도에 대한 답을 본문에서 바로 제공하세요.
- 사용자 블로그의 실제 말투와 상담/매장 안내 맥락을 우선하고, SEO 강의처럼 쓰지 마세요.
- 긴 검색 조합은 exact phrase가 아니라 검색의도 신호입니다. 그대로 나열하지 말고 자연 문장으로 분해하세요.
- readerQuestions 중 1~2개는 첫 2문단 안에 자연스럽게 반영하세요.
- mustResolve 항목은 본문에서 모두 해결하고, mustNotDefer 항목은 다른 글로 미루지 마세요.
- 일반 글은 핵심 답을 다음 글로 미루지 말고, 제품명보다 선택 기준/실패 이유/상담 기준을 먼저 설명하세요.
- 서브 키워드를 손님 질문문 안에 exact phrase로 억지 삽입하지 마세요. 손님 질문은 실제 말처럼 쓰고, 서브 키워드는 설명 문단/비교 문단/상담 맥락에서 자연스럽게 분산하세요.
- '한 번에 정리', '실패 없는 선택', '꼼꼼히 안내', '체크포인트', '핵심 포인트', '도움이 되었길 바랍니다' 같은 표현은 절대 쓰지 마세요.
- '선택 전에 보는 핵심 기준', '실제로 비교할 때 체크할 포인트', '정리와 다음 확인 포인트', '꼭 확인해야 할 체크리스트', '마무리 정리' 같은 소제목은 피하세요.

아웃라인:
${strategy.outline
  .map(
    (s, i) =>
      `${i + 1}. ${s.heading}\n   - ${s.subPoints.join("\n   - ")}\n   방향: ${s.contentDirection}`
  )
  .join("\n\n")}

${
    corpusSummary
      ? "시스템 프롬프트의 코퍼스 summary를 바탕으로 스타일을 분석한 후,"
      : `먼저 user_corpus_retriever로 사용자 "${userId}"의 예시 글을 로드하여 스타일을 분석한 후,`
  }
expansion_planner로 아웃라인을 확장하고, 본문을 마크다운으로 작성해주세요.${revisionSection}`;

  // 1단계: tool-use loop (corpus retrieval + expansion planning)
  const messages: import("@anthropic-ai/sdk/resources/messages").MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let iterCount = 0;
  const maxIter = 4;

  while (iterCount < maxIter) {
    iterCount++;
    if (signal?.aborted) throw new Error("본문 작성이 사용자 요청으로 중단되었습니다.");

    console.log(`[master-writer] iteration ${iterCount} start — messages=${messages.length}, topicId=${topicId}`);
    if (iterCount > 1) {
      onProgress?.(`본문 생성 중입니다. (단계 ${iterCount})`);
    }

    // 스트리밍 모드로 API 호출 — 토큰 단위 수신으로 타임아웃 감지 신뢰성 향상
    // INITIAL: 첫 이벤트까지 150초 (블로그 본문 생성 시작이 느릴 수 있음)
    // STALL: 이후 연속 무응답 90초
    const INITIAL_TIMEOUT_MS = 150_000;
    const STALL_TIMEOUT_MS = 90_000;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stallReject: ((err: Error) => void) | null = null;
    let firstEventReceived = false;

    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (!stallReject) return;
      const ms = firstEventReceived ? STALL_TIMEOUT_MS : INITIAL_TIMEOUT_MS;
      stallTimer = setTimeout(
        () => stallReject!(new Error(firstEventReceived
          ? `Master Writer 스트림 타임아웃 — ${ms / 1000}초 이상 응답 없음 (iter=${iterCount})`
          : `Master Writer 초기 응답 타임아웃 — ${ms / 1000}초 이내 응답 없음 (iter=${iterCount})`)),
        ms
      );
    };

    const stallPromise = new Promise<never>((_, reject) => {
      stallReject = reject;
      resetStallTimer();
    });

    // AbortSignal: 외부 signal + 하드 데드라인(160초) 조합
    // stall timer(120/90초)의 백업 — HTTP 연결 수준에서도 강제 취소
    const hardDeadline = AbortSignal.timeout(160_000);
    const callSignal = signal
      ? AbortSignal.any([signal, hardDeadline])
      : hardDeadline;

    let rawText = "";
    let finalStopReason: string | null = null;
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    try {
      await Promise.race([
        (async () => {
          const stream = client.messages.stream({
            model: MODELS.sonnet,
            system: buildSystemPrompt(userId, corpusSummary ?? null, harnessBriefing),
            messages,
            tools: TOOLS,
            max_tokens: 4096,
          }, { signal: callSignal });

          for await (const event of stream) {
            if (!firstEventReceived) { firstEventReceived = true; }
            resetStallTimer();
            if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                rawText += event.delta.text;
                onToken?.(event.delta.text);
              }
            } else if (event.type === "message_stop") {
              finalStopReason = "end_turn"; // stream 완료
            }
          }

          // 최종 메시지에서 tool_use 블록 추출
          const finalMsg = await stream.finalMessage();
          finalStopReason = finalMsg.stop_reason ?? "end_turn";
          for (const block of finalMsg.content) {
            if (block.type === "tool_use") {
              toolUseBlocks.push({
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
            if (block.type === "text" && !rawText) {
              rawText = block.text;
            }
          }
          messages.push({ role: "assistant", content: finalMsg.content });
        })(),
        stallPromise,
      ]);
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }

    console.log(`[master-writer] iteration ${iterCount} done — stopReason=${finalStopReason}, tools=${toolUseBlocks.map((b) => b.name).join(",") || "none"}, textLen=${rawText.length}`);

    if (finalStopReason === "end_turn" && toolUseBlocks.length === 0) {
      // 본문 생성 완료
      const bodyText = wrapForNaverMobile(rawText);
      onProgress?.("본문 생성 완료 – GitHub에 저장 중...");
      return await saveWriterResult({
        strategy,
        topicId,
        postId,
        title: strategy.title,
        content: bodyText,
        overwrite: Boolean(revisionInstructions),
      });
    }

    if (toolUseBlocks.length > 0) {
      const toolLabels: Record<string, string> = {
        user_corpus_retriever: "코퍼스를 불러오는 중입니다.",
        expansion_planner: "확장 아웃라인을 보강하는 중입니다.",
        source_resolver: "참조 URL을 확인하는 중입니다.",
      };
      const toolResults: import("@anthropic-ai/sdk/resources/messages").ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        onProgress?.(toolLabels[block.name] ?? `${block.name} \uC2E4\uD589 \uC911\uC785\uB2C8\uB2E4.`);
        const fn = toolRegistry[block.name as keyof typeof toolRegistry];
        if (!fn) {
          toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `알 수 없는 도구: ${block.name}` });
          continue;
        }
        try {
          const result = await fn(block.input);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: String(err) });
        }
      }
      onProgress?.(`본문 생성 중... (단계 ${iterCount + 1})`);
      messages.push({ role: "user", content: toolResults });
      continue;
    }
    break;
  }

  throw new Error(`Master Writer가 ${maxIter}회 안에 본문 작성을 완료하지 못했습니다.`);
}

async function saveWriterResult(params: {
  strategy: StrategyPlanResult;
  topicId: string;
  postId?: string;
  title: string;
  content: string;
  overwrite?: boolean;
}): Promise<WriterResult> {
  const postId = params.postId ?? `post-${randomUUID().slice(0, 8)}`;
  const contentPath = Paths.postContent(postId);
  const generatedAt = new Date().toISOString();
  let finalContent = params.content;
  let finalDraftCheck = runFinalDraftCheck({
    title: params.title,
    content: finalContent,
    strategy: params.strategy,
  });
  const finalDraftRewrite = runLimitedFinalDraftRewrite({
    title: params.title,
    content: finalContent,
    strategy: params.strategy,
    beforeCheck: finalDraftCheck,
  });
  if (finalDraftRewrite.attempted && finalDraftRewrite.applied) {
    finalContent = finalDraftRewrite.content;
    finalDraftCheck = finalDraftRewrite.afterCheck;
  }
  const wordCount = finalContent.replace(/\s+/g, "").length;

  // GitHub에 본문 저장 (파일이 없을 때만 — sha null)
  const exists = await fileExists(contentPath);
  if (!exists || params.overwrite) {
    const sha = exists ? (await readFile(contentPath)).sha : null;
    await writeFile(
      contentPath,
      finalContent,
      `feat: master-writer generated post ${postId}`,
      sha
    );
  }

  return {
    postId,
    title: params.title,
    content: finalContent,
    wordCount,
    generatedAt,
    finalDraftCheck,
    finalDraftRewrite: finalDraftRewrite.attempted ? finalDraftRewrite : undefined,
  };
}
