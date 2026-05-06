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
import type { Topic, TopicIndex } from "@/lib/types/github-data";
import type { SearchCombinationTarget, StrategyPlanResult } from "./types";
import { normalizeUserId } from "@/lib/utils/normalize";
import { buildContentTopologyPlan } from "./content-topology";
import { buildPolicyPromptSection } from "./blog-workflow-policy";
import { naverLogicAgent } from "./naver-logic-agent";

const STRATEGY_LOOP_TIMEOUT_MS = 120_000;
const SIMPLE_STRATEGY_TIMEOUT_MS = 45_000;

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
      "contentDirection": "작성 방향",
      "estimatedParagraphs": 2
    }
  ],
  "keyPoints": ["핵심 포인트"],
  "estimatedLength": 1700,
  "tone": "friendly",
  "keywords": ["메인키워드", "서브키워드"],
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
  const mainKeyword = params.directIntent?.mainKeyword ?? params.plan.keywords[0] ?? params.topic.title;
  const fallbackSupports = uniq(params.plan.keywords.slice(1, 5));
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
    const normalized = phrase.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    if (combinations.some((item) => item.phrase.toLowerCase() === normalized.toLowerCase())) return;
    combinations.push({ phrase: normalized, role, priority, rationale, suggestedPlacement });
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
  if (!directIntent) return plan;

  const orderedKeywords = uniq([
    directIntent.mainKeyword,
    ...directIntent.subKeywords,
    ...plan.keywords,
  ]).filter(Boolean);

  const keyPoints = uniq([
    `${directIntent.mainKeyword}를 글의 중심 검색축으로 유지한다.`,
    directIntent.subKeywords.length > 0
      ? `${directIntent.subKeywords.join(", ")}는 보조 맥락으로 활용하되 메인 키워드를 대체하지 않는다.`
      : "",
    ...plan.keyPoints,
  ]).filter(Boolean);

  const rationalePrefix = directIntent.subKeywords.length > 0
    ? `직접 입력 토픽이므로 메인 키워드 '${directIntent.mainKeyword}'를 중심축으로 두고, 서브 키워드 '${directIntent.subKeywords.join(", ")}'는 보조 맥락으로 반영했습니다.`
    : `직접 입력 토픽이므로 메인 키워드 '${directIntent.mainKeyword}'를 중심축으로 반영했습니다.`;

  return {
    ...plan,
    keywords: orderedKeywords,
    keyPoints,
    rationale: `${rationalePrefix} ${plan.rationale}`.trim(),
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

function buildUserMessage(
  topic: Topic,
  topicId: string,
  userId: string,
  directIntent: DirectKeywordIntent | null
): string {
  return [
    "다음 토픽으로 네이버 블로그 전략을 수립해 주세요.",
    "",
    `토픽 ID: ${topicId}`,
    `제목: ${topic.title}`,
    `설명: ${topic.description}`,
    `카테고리: ${topic.category}`,
    `태그: ${topic.tags.join(", ") || "없음"}`,
    directIntent ? `직접입력 메인 키워드: ${directIntent.mainKeyword}` : "",
    directIntent && directIntent.subKeywords.length > 0 ? `직접입력 서브 키워드: ${directIntent.subKeywords.join(", ")}` : "",
    directIntent
      ? "직접 입력 모드 규칙: 메인 키워드를 글의 중심 검색축으로 유지하고, 제목/도입부/핵심 문단의 판단 기준이 메인 키워드와 일치해야 합니다. 서브 키워드는 메인 키워드를 보조하는 맥락으로만 사용하세요."
      : "",
    `사용자 ID: ${userId}`,
    `참조 URL: ${topic.relatedSources.join(", ") || "없음"}`,
    "",
    "반드시 도구를 순서대로 사용한 뒤, 최종 전략 JSON만 출력해 주세요.",
  ].filter(Boolean).join("\n");
}

export async function runStrategyPlanner(params: {
  topicId: string;
  userId: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<StrategyPlanResult> {
  const { topicId, onProgress, signal } = params;
  const userId = normalizeUserId(params.userId);
  const topic = await loadTopic(topicId);
  const directIntent = extractDirectKeywordIntent(topic);

  onProgress?.(`토픽 "${topicId}" 전략 수립 시작`);

  const researchKeyword = directIntent?.mainKeyword ?? topic.title;

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
          buildUserMessage(topic, topicId, userId, directIntent) +
          `\n\n${communityResearchBrief}` +
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
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("파이프라인 취소 - 전략 수립 중단");
    }

    console.warn("[strategy-planner] tool-use 루프/파싱 실패, 안전 폴백 전략으로 전환:", String(error));
    onProgress?.("AI 전략 응답이 지연되어 안전 폴백 전략으로 이어갑니다.");
    plan = buildLocalFallbackStrategy(topic);
  }

  plan = applyDirectKeywordPriority(plan, directIntent);

  const contentTopology = await buildContentTopologyPlan({ topic, strategy: plan, userId });
  const targetSearchCombinations = buildTargetSearchCombinations({ topic, plan, directIntent });
  const naverLogic = naverLogicAgent.planBeforeWriting({ ...plan, contentTopology });
  plan = {
    ...plan,
    targetSearchCombinations,
    contentTopology,
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
