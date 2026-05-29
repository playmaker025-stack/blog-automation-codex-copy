import type { Topic } from "../types/github-data.ts";
import type {
  ArticleContract,
  ArticleRole,
  CompletionMode,
  ConclusionPattern,
  ContentNodeType,
  IntroPattern,
  KeywordUsagePolicy,
  OverlapReport,
  StrategyPlanResult,
  StrategyQualityGateResult,
} from "./types.ts";

const PROBLEM_SOLUTION_PATTERN =
  /(원인|필수|탄맛|고장|안됨|느림|결로|교체주기|인식 안됨|체크|No Atomizer|No Pod|누수|빨리 탐|맛이 안 나는)/iu;
const REVIEW_PATTERN = /(후기|리뷰|실사용|솔직후기|사용감|직접 써본)/iu;
const COMPARISON_PATTERN = /(차이|비교|vs|VS|어떤 게 나을까|뭐가 더 나을까)/iu;
const MAIN_RECOMMENDATION_PATTERN = /(추천|best|BEST|top|TOP|처음 고를 때|입문자 추천)/iu;
const LOCAL_PURCHASE_PATTERN = /(부평|만수|매장|방문|결제|상담|사용처|지원금)/iu;
const POLICY_PATTERN = /(지원금|사용처|결제|가능|가맹점)/iu;
const CTA_VERB_PATTERN = /(상담|비교|확인|정리|방문)/iu;

const DEFAULT_FORBIDDEN_EXACT_PHRASES = [
  "한 번에 정리",
  "실패 없는 선택",
  "꼼꼼한 안내",
  "체크포인트",
  "핵심 포인트",
  "유의하시기 바랍니다",
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

const DEFAULT_FORBIDDEN_HEADING_PATTERNS = [
  "선택 전에 보는 핵심 기준",
  "실제로 비교할 때 체크할 포인트",
  "정리와 다음 확인 포인트",
  "꼭 확인해야 할 체크리스트",
  "마무리 정리",
];

const DEFAULT_FORBIDDEN_TONE_PATTERNS = [
  "실패 없는 선택",
  "꼼꼼한 안내",
  "만족스러운 결과",
  "유의하시기 바랍니다",
];

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

function normalizeQuestion(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsExactPhrase(value: string, phrases: string[]): boolean {
  const normalized = normalizeQuestion(value);
  return phrases.some((phrase) => phrase && new RegExp(escapeRegExp(phrase), "iu").test(normalized));
}

function pickMainKeyword(plan: StrategyPlanResult): string {
  return (plan.keywordContract?.mainKeyword || plan.keywords[0] || plan.targetMainKeyword || "").trim();
}

function collectSourceText(topic: Topic, plan: StrategyPlanResult): string {
  return [
    topic.title,
    topic.description,
    plan.title,
    plan.rationale,
    plan.keywordContract?.mainKeyword ?? "",
    ...(topic.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

function inferNodeType(topic: Topic, plan: StrategyPlanResult, articleRole: ArticleRole): ContentNodeType {
  if (articleRole === "prelude") return "bridge";
  if (topic.contentKind === "hub" || topic.contentKind === "leaf") return topic.contentKind;
  if (plan.contentTopology?.kind === "hub" || plan.contentTopology?.kind === "leaf") return plan.contentTopology.kind;
  if (articleRole === "main_recommendation" || articleRole === "product_list_recommendation") return "hub";
  return "leaf";
}

function inferIntroPattern(topic: Topic, plan: StrategyPlanResult, articleRole: ArticleRole): IntroPattern {
  const source = collectSourceText(topic, plan);
  if (articleRole === "problem_solution") return "problem_symptom";
  if (articleRole === "review") return "product_experience";
  if (POLICY_PATTERN.test(source) && articleRole === "prelude") return "policy_confusion";
  if (/문의|요즘|최근/u.test(source)) return "recent_inquiry";
  if (LOCAL_PURCHASE_PATTERN.test(source) && /추천|입문|방문|매장/u.test(source)) return "purchase_before_visit";
  return "customer_question";
}

function inferConclusionPattern(topic: Topic, plan: StrategyPlanResult, articleRole: ArticleRole): ConclusionPattern {
  if (articleRole === "prelude") return "handoff_next_article";
  if (articleRole === "problem_solution") return "problem_checklist";
  if (articleRole === "review") return "product_fit_summary";
  if (articleRole === "comparison") return "criteria_summary";
  if (articleRole === "main_recommendation" || articleRole === "product_list_recommendation") return "visit_consultation";
  const source = collectSourceText(topic, plan);
  return CTA_VERB_PATTERN.test(source) ? "visit_consultation" : "criteria_summary";
}

function buildMainIntent(topic: Topic, plan: StrategyPlanResult, articleRole: ArticleRole): string {
  if (topic.seriesDetailPlan?.searchIntent) return topic.seriesDetailPlan.searchIntent;
  if (plan.keywordContract?.searchIntent) return plan.keywordContract.searchIntent;

  const mainKeyword = pickMainKeyword(plan) || topic.title;
  switch (articleRole) {
    case "prelude":
      return `${topic.title}를 찾는 독자가 현재 글에서 확인 기준을 정리하고 다음 메인 주제로 자연스럽게 넘어가도록 돕는다.`;
    case "problem_solution":
      return `${mainKeyword} 문제의 원인과 점검 기준을 이 글 안에서 해결한다.`;
    case "review":
      return `${mainKeyword}를 실제로 써본 체감과 장단점을 바탕으로 구매 전 판단 기준을 제공한다.`;
    case "comparison":
      return `${mainKeyword}처럼 비교가 필요한 상황에서 단순 승패가 아니라 사용자별 선택 기준을 정리한다.`;
    case "main_recommendation":
      return `${mainKeyword}를 찾는 독자에게 추천 기준과 사용자 유형별 선택 방향을 제시한다.`;
    default:
      return `${topic.title}를 찾는 독자가 지금 필요한 핵심 기준을 이 글 안에서 바로 이해하도록 돕는다.`;
  }
}

function buildReaderState(topic: Topic, plan: StrategyPlanResult, articleRole: ArticleRole): string {
  const mainKeyword = pickMainKeyword(plan) || topic.title;
  switch (articleRole) {
    case "prelude":
      return `${mainKeyword} 관련 확인을 마치고 다음 선택으로 넘어가려는데 방문 전에 무엇을 정리해야 하는지 헷갈리는 상태`;
    case "problem_solution":
      return `${mainKeyword} 문제를 겪고 있지만 기기 문제인지 사용 습관 문제인지 구분하지 못하는 상태`;
    case "review":
      return `${mainKeyword}가 실제로 어떤지, 장점만 있는지 단점도 있는지 구매 전에 확인하고 싶은 상태`;
    case "comparison":
      return `${mainKeyword}처럼 두 선택지의 차이를 파악하고 어떤 상황에서 무엇이 맞는지 판단하고 싶은 상태`;
    case "main_recommendation":
      return `${mainKeyword}를 찾지만 제품명보다 추천 기준과 사용자 유형별 방향부터 알고 싶은 상태`;
    default:
      return `${mainKeyword} 관련 정보를 바로 찾고 싶지만 무엇부터 확인해야 하는지 잘 모르는 상태`;
  }
}

function buildFallbackReaderQuestions(articleRole: ArticleRole, mainKeyword: string, subKeywords: string[]): string[] {
  switch (articleRole) {
    case "prelude":
      return [
        "방문 전에 어떤 걸 확인하면 되나요?",
        "결제 전에 먼저 물어봐야 할 게 있나요?",
        "헛걸음하지 않으려면 무엇부터 봐야 하나요?",
      ];
    case "problem_solution":
      if (/코일/u.test(mainKeyword)) {
        return [
          "코일이 왜 이렇게 빨리 타죠?",
          "기기 문제인지 사용 습관 문제인지 어떻게 구분하나요?",
          "지금 바로 바꿔야 할 사용 습관이 있나요?",
        ];
      }
      if (/(누수|새는|결로|느림)/u.test(mainKeyword)) {
        return [
          "왜 이렇게 자꾸 새는 것 같죠?",
          "기기 문제인지 사용 습관 문제인지 어떻게 구분하나요?",
          "지금 바로 확인할 게 있나요?",
        ];
      }
      return [
        "왜 이렇게 빨리 문제가 생기죠?",
        "기기 문제인지 사용 습관 문제인지 어떻게 구분하나요?",
        "지금 바로 확인할 게 있나요?",
      ];
    case "review":
      return [
        "실제로 써보면 어떤가요?",
        "좋은 점만 있는 건 아니죠?",
        "사기 전에 꼭 확인할 부분이 있을까요?",
      ];
    case "comparison":
      return [
        "둘 중 어떤 쪽이 저한테 더 맞을까요?",
        "차이가 큰 것 같은데 실제로는 어떻게 나뉘나요?",
        "처음이면 어떤 기준으로 고르면 될까요?",
      ];
    case "main_recommendation":
      return [
        "처음이면 어떤 기준부터 보면 될까요?",
        "유지비나 관리가 너무 부담스럽지 않은 쪽도 있을까요?",
        "매장에 가기 전에 어떤 걸 먼저 생각해두면 좋을까요?",
      ];
    default:
      if (/액상/u.test(mainKeyword) || subKeywords.some((keyword) => /액상/u.test(keyword))) {
        return [
          "요즘 뭐가 제일 잘 나가요?",
          "멘솔 약한 액상도 있나요?",
          "단맛이 너무 강하지 않은 것도 볼 수 있을까요?",
          "처음이면 어떤 맛부터 보는 게 좋을까요?",
        ];
      }
      return [
        "요즘 뭐가 제일 잘 나가요?",
        "처음이면 어떤 기준부터 보면 될까요?",
        "너무 강하거나 부담스럽지 않은 쪽도 있나요?",
      ];
  }
}

function buildReaderQuestions(topic: Topic, plan: StrategyPlanResult, articleRole: ArticleRole): string[] {
  const mainKeyword = pickMainKeyword(plan) || topic.title;
  const subKeywords = plan.keywordContract?.subKeywords ?? [];
  return buildFallbackReaderQuestions(articleRole, mainKeyword, subKeywords);
}

export function sanitizeReaderQuestions(params: {
  questions: string[];
  mainKeyword: string;
  subKeywords: string[];
  keywordUsagePolicy: KeywordUsagePolicy;
  articleRole: ArticleRole;
}): string[] {
  const { questions, mainKeyword, subKeywords, keywordUsagePolicy, articleRole } = params;
  const blockedPhrases = uniq([mainKeyword, ...subKeywords].filter(Boolean));
  const fallbackQuestions = buildFallbackReaderQuestions(articleRole, mainKeyword, subKeywords);

  const sanitized = uniq(
    questions
      .map((question) => normalizeQuestion(question))
      .filter(Boolean)
      .filter((question) => {
        if (!keywordUsagePolicy.avoidSubKeywordStuffingInQuestions) return true;
        return !containsExactPhrase(question, blockedPhrases);
      })
  );

  if (sanitized.length >= 2) return sanitized.slice(0, 3);
  const fallback = fallbackQuestions.filter((question) => !containsExactPhrase(question, blockedPhrases));
  return uniq([...sanitized, ...fallback]).slice(0, 3);
}

function buildMustResolve(topic: Topic, plan: StrategyPlanResult, articleRole: ArticleRole): string[] {
  const mainKeyword = pickMainKeyword(plan) || topic.title;
  switch (articleRole) {
    case "prelude":
      return [
        `${mainKeyword} 관련 현재 확인 기준`,
        "매장 방문 전 결제/사용 가능 여부를 확인하는 방법",
        "다음 메인 글로 넘어가기 전에 정리해야 할 기준",
      ];
    case "problem_solution":
      return [
        `${mainKeyword}의 원인 그룹`,
        "정상 범위와 비정상 신호를 구분하는 기준",
        "즉시 점검 순서와 예방 기준",
      ];
    case "review":
      return ["실제 체감 포인트", "장점과 아쉬운 점", "어떤 사용자에게 맞는지", "구매 전 확인할 점"];
    case "comparison":
      return ["비교 대상별 차이", "선택 기준", "어떤 상황에서 A/B가 맞는지", "단순 승패가 아니라 사용자별 판단 기준"];
    case "main_recommendation":
      return ["추천 기준", "사용자 유형별 분기", "입문자/기존 사용자 기준", "유지비/관리/사용감 기준", "방문 전 상담 기준"];
    default:
      return [
        `${mainKeyword} 관련 선택 기준`,
        "실패를 줄이는 비교/상담 기준",
        "방문 전 미리 확인해야 할 사항",
      ];
  }
}

function buildMustNotDefer(topic: Topic, plan: StrategyPlanResult, articleRole: ArticleRole): string[] {
  const mainKeyword = pickMainKeyword(plan) || topic.title;
  switch (articleRole) {
    case "prelude":
      return [`${mainKeyword}의 현재 확인 기준`, "방문 전 체크해야 할 핵심 판단 기준"];
    case "problem_solution":
      return [`${mainKeyword}의 주요 원인`, "지금 바로 확인할 점검 항목"];
    case "review":
      return ["실제 체감 포인트", "장점과 아쉬운 점"];
    case "comparison":
      return ["핵심 차이와 선택 기준", "상황별 A/B 판단 기준"];
    case "main_recommendation":
      return [`${mainKeyword}의 추천 기준`, "입문자/기존 사용자 분기와 방문 전 상담 기준"];
    default:
      return [`${mainKeyword}의 핵심 답변`, "현재 글에서 끝내야 하는 선택 기준"];
  }
}

function buildCtaMode(articleRole: ArticleRole): string {
  switch (articleRole) {
    case "prelude":
      return "현재 글의 확인 기준을 정리한 뒤 다음 메인 글로 자연스럽게 handoff";
    case "problem_solution":
      return "점검 및 교체 상담이 필요한지 판단하도록 마무리";
    case "review":
      return "체감과 장단점을 정리해 본인 취향에 맞는지 판단하도록 마무리";
    case "comparison":
      return "상황별 선택 기준을 정리해 본인 사용 방식에 맞는 쪽을 고르도록 마무리";
    case "main_recommendation":
      return "추천 기준과 사용자 유형을 정리한 뒤 방문 전 상담으로 연결";
    default:
      return "현재 글의 기준을 정리한 뒤 방문 전 상담이나 선택 판단으로 연결";
  }
}

export function inferArticleRole(topic: Topic, plan: StrategyPlanResult): ArticleRole {
  if (topic.seriesRole === "prelude") return "prelude";

  const articleType = plan.keywordContract?.articleType;
  if (articleType === "review") return "review";
  if (articleType === "comparison") return "comparison";
  if (articleType === "main_recommendation") return "main_recommendation";
  if (articleType === "product_list_recommendation") return "product_list_recommendation";
  if (articleType === "problem_solution") return "problem_solution";

  const sourceText = collectSourceText(topic, plan);
  if (PROBLEM_SOLUTION_PATTERN.test(sourceText)) return "problem_solution";
  if (REVIEW_PATTERN.test(sourceText)) return "review";
  if (COMPARISON_PATTERN.test(sourceText)) return "comparison";
  if (MAIN_RECOMMENDATION_PATTERN.test(sourceText)) return "main_recommendation";
  return "general";
}

export function inferCompletionMode(articleRole: ArticleRole): CompletionMode {
  return articleRole === "prelude" ? "handoff" : "end_here";
}

export function buildArticleContract(params: { topic: Topic; plan: StrategyPlanResult }): ArticleContract {
  const { topic, plan } = params;
  const articleRole = inferArticleRole(topic, plan);
  const completionMode = inferCompletionMode(articleRole);
  const handoffKeyword =
    articleRole === "prelude" ? (topic.targetMainKeyword ?? plan.targetMainKeyword ?? "").trim() || null : null;
  const keywordUsagePolicy: KeywordUsagePolicy = {
    avoidSubKeywordStuffingInQuestions: true,
    preferContextualSubKeywordUse: true,
  };
  const mainKeyword = pickMainKeyword(plan) || topic.title;
  const subKeywords = plan.keywordContract?.subKeywords ?? [];
  const productCandidates = plan.keywordContract?.productCandidates ?? [];

  const baseContract: ArticleContract = {
    articleRole,
    completionMode,
    nodeType: inferNodeType(topic, plan, articleRole),
    introPattern: inferIntroPattern(topic, plan, articleRole),
    conclusionPattern: inferConclusionPattern(topic, plan, articleRole),
    mainIntent: buildMainIntent(topic, plan, articleRole),
    readerState: buildReaderState(topic, plan, articleRole),
    readerQuestions: sanitizeReaderQuestions({
      questions: buildReaderQuestions(topic, plan, articleRole),
      mainKeyword,
      subKeywords,
      keywordUsagePolicy,
      articleRole,
    }),
    mustResolve: buildMustResolve(topic, plan, articleRole),
    mustNotDefer: buildMustNotDefer(topic, plan, articleRole),
    handoffKeyword,
    forbiddenExactPhrases: DEFAULT_FORBIDDEN_EXACT_PHRASES,
    forbiddenHeadingPatterns: DEFAULT_FORBIDDEN_HEADING_PATTERNS,
    forbiddenTonePatterns: DEFAULT_FORBIDDEN_TONE_PATTERNS,
    ctaMode: buildCtaMode(articleRole),
    keywordUsagePolicy,
  };

  if (articleRole !== "product_list_recommendation") {
    return baseContract;
  }

  return {
    ...baseContract,
    mainIntent: `${mainKeyword} 후보를 제품별로 비교해 추천 이유, 맞는 사용자, 구매 전 확인점을 한 글 안에서 정리합니다.`,
    readerState: `${mainKeyword} 후보가 여러 개라서 어떤 제품이 자신에게 맞는지 빠르게 비교하고 싶은 상태`,
    readerQuestions: sanitizeReaderQuestions({
      questions: [
        "후보 제품마다 어떤 점이 다른가요?",
        "저한테 맞는 제품은 어떤 기준으로 골라야 하나요?",
        "구매 전에 꼭 확인해야 할 점은 무엇인가요?",
      ],
      mainKeyword,
      subKeywords,
      keywordUsagePolicy,
      articleRole,
    }),
    mustResolve: [
      `${mainKeyword} 후보별 추천 이유`,
      "각 후보가 맞는 사용자",
      "구매 전에 확인해야 할 조건",
      ...(productCandidates.length > 0 ? [`후보 제품: ${productCandidates.join(", ")}`] : []),
    ],
    mustNotDefer: [
      `${mainKeyword} 후보별 차이`,
      "각 후보가 맞는 사용자",
      "구매 전에 확인해야 할 조건",
    ],
    ctaMode: "후보별 차이와 추천 이유를 정리한 뒤 사용자가 바로 고를 수 있게 마무리",
  };
}

export function evaluateStrategyQualityGate(strategy: {
  articleContract?: ArticleContract;
  overlapReport?: OverlapReport;
}): StrategyQualityGateResult {
  const contract = strategy.articleContract;
  const overlapReport = strategy.overlapReport;
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  if (!contract) {
    blockingReasons.push("articleContract가 없습니다.");
    return { ok: false, blockingReasons, warnings };
  }

  if (!contract.articleRole) blockingReasons.push("articleRole이 없습니다.");
  if (!contract.completionMode) blockingReasons.push("completionMode가 없습니다.");
  if (!contract.nodeType) blockingReasons.push("nodeType이 없습니다.");
  if (!contract.introPattern) blockingReasons.push("introPattern이 없습니다.");
  if (!contract.conclusionPattern) blockingReasons.push("conclusionPattern이 없습니다.");
  if (!contract.mainIntent?.trim()) blockingReasons.push("mainIntent가 비어 있습니다.");
  if (!contract.readerState?.trim()) blockingReasons.push("readerState가 비어 있습니다.");
  if (!contract.readerQuestions?.length) blockingReasons.push("readerQuestions가 비어 있습니다.");
  if (!contract.mustResolve?.length) blockingReasons.push("mustResolve가 비어 있습니다.");
  if (!contract.mustNotDefer?.length) blockingReasons.push("mustNotDefer가 비어 있습니다.");
  if (!contract.ctaMode?.trim()) blockingReasons.push("ctaMode가 비어 있습니다.");
  if (!contract.keywordUsagePolicy) blockingReasons.push("keywordUsagePolicy가 없습니다.");
  if (contract.articleRole === "prelude" && !contract.handoffKeyword?.trim()) {
    blockingReasons.push("prelude 글에는 handoffKeyword가 필요합니다.");
  }

  if (overlapReport?.riskLevel === "high") {
    blockingReasons.push("기존 글과의 중복 위험이 높습니다.");
  } else if (overlapReport?.riskLevel === "medium") {
    warnings.push("기존 글과 일부 방향이 겹칩니다. recommendedRewriteDirection을 따라야 합니다.");
  }

  if (overlapReport?.repeatedIntroPatterns.length) {
    warnings.push(`도입 패턴 반복 주의: ${overlapReport.repeatedIntroPatterns.join(", ")}`);
  }
  if (overlapReport?.repeatedConclusionPatterns.length) {
    warnings.push(`결론 패턴 반복 주의: ${overlapReport.repeatedConclusionPatterns.join(", ")}`);
  }
  if (overlapReport?.repeatedInternalLinkTargets.length) {
    warnings.push(`내부링크 대상 반복 주의: ${overlapReport.repeatedInternalLinkTargets.join(", ")}`);
  }
  if (overlapReport?.repeatedCtaModes.length) {
    warnings.push(`CTA 반복 주의: ${overlapReport.repeatedCtaModes.join(", ")}`);
  }

  return { ok: blockingReasons.length === 0, blockingReasons, warnings };
}

export function findQuestionKeywordStuffingViolations(params: {
  content: string;
  mainKeyword: string;
  subKeywords: string[];
}): string[] {
  const blockedPhrases = uniq([params.mainKeyword, ...params.subKeywords].filter(Boolean));
  if (!blockedPhrases.length) return [];

  const violations: string[] = [];
  const quotedMatches = Array.from(params.content.matchAll(/["“”'‘’「」『』]([^"“”'‘’「」『』\n]{2,})["“”'‘’「」『』]/gu));
  for (const match of quotedMatches) {
    const question = normalizeQuestion(match[1] ?? "");
    if (containsExactPhrase(question, blockedPhrases)) {
      violations.push(`질문문 exact phrase 반복: "${question}"`);
    }
  }

  const questionSections = params.content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => /(질문|문의|궁금)/u.test(paragraph));
  for (const section of questionSections) {
    if (containsExactPhrase(section, blockedPhrases)) {
      violations.push(`질문 섹션 exact phrase 반복: "${section.slice(0, 80)}"`);
    }
  }

  return uniq(violations);
}

export function buildRoleSpecificWriterGuidance(contract: ArticleContract | undefined): string[] {
  if (!contract) return [];

  const common = [
    `- Article role is '${contract.articleRole}' and completion mode is '${contract.completionMode}'.`,
    `- Node type is '${contract.nodeType}', intro pattern is '${contract.introPattern}', conclusion pattern is '${contract.conclusionPattern}'.`,
    `- Never defer these items to another post: ${contract.mustNotDefer.join(" / ")}.`,
    "- Never place mainKeyword or subKeywords as exact phrases inside quoted customer questions.",
    "- Customer questions must sound like real spoken customer questions, not SEO keyword containers.",
    "- If a keyword is needed, use it in explanation paragraphs, comparison paragraphs, or consultation context, not inside quotes.",
  ];

  switch (contract.articleRole) {
    case "prelude":
      return [
        ...common,
        "- Prelude articles may hand off to the next article only after solving the current check-orientation questions.",
        "- Do not let this article consume the next article's main topic. Keep the current article focused on confirmation criteria and bridge logic.",
      ];
    case "problem_solution":
      return [
        ...common,
        "- Problem-solution articles must explain the cause groups, normal-vs-abnormal signals, immediate checks, and prevention criteria before closing.",
      ];
    case "review":
      return [
        ...common,
        "- Review articles must cover real usage feel, strengths, and drawbacks together.",
        "- Do not write praise-only promotional copy.",
      ];
    case "comparison":
      return [
        ...common,
        "- Comparison articles must organize differences and situation-based choice criteria, not a simple winner-loser ranking.",
      ];
    case "main_recommendation":
      return [
        ...common,
        "- Main recommendation articles must explain recommendation criteria and user-type branches before listing product names.",
        "- Separate beginner vs existing-user needs, and explain maintenance cost, management load, and feel of use.",
      ];
    case "product_list_recommendation":
      return [
        ...common,
        "- Product list recommendation articles must dedicate one section per product or candidate, not a single generic checklist.",
        "- In each section, explain the recommendation reason, the user it fits, and what to verify before purchase.",
        "- Do not collapse the article into general criteria only. The body must clearly compare named candidates.",
      ];
    default:
      return [
        ...common,
        "- General articles must complete the core answer in this article and close with practical consultation or decision guidance.",
      ];
  }
}

export function formatArticleContract(contract: ArticleContract | undefined): string {
  if (!contract) {
    return ["Article contract: unavailable.", "Do not mention that the contract is unavailable in the draft."].join("\n");
  }

  return [
    "Article contract:",
    `- Article role: ${contract.articleRole}`,
    `- Completion mode: ${contract.completionMode}`,
    `- Node type: ${contract.nodeType}`,
    `- Intro pattern: ${contract.introPattern}`,
    `- Conclusion pattern: ${contract.conclusionPattern}`,
    `- Main intent: ${contract.mainIntent}`,
    `- Reader state: ${contract.readerState}`,
    `- Reader questions: ${contract.readerQuestions.join(" / ")}`,
    `- Must resolve: ${contract.mustResolve.join(" / ")}`,
    `- Must not defer: ${contract.mustNotDefer.join(" / ")}`,
    `- Handoff keyword: ${contract.handoffKeyword ?? "none"}`,
    `- CTA mode: ${contract.ctaMode}`,
    `- Keyword usage policy: avoidSubKeywordStuffingInQuestions=${String(contract.keywordUsagePolicy.avoidSubKeywordStuffingInQuestions)}, preferContextualSubKeywordUse=${String(contract.keywordUsagePolicy.preferContextualSubKeywordUse)}`,
    `- Forbidden exact phrases: ${contract.forbiddenExactPhrases.join(" / ") || "none"}`,
    `- Forbidden heading patterns: ${contract.forbiddenHeadingPatterns.join(" / ") || "none"}`,
    `- Forbidden tone patterns: ${contract.forbiddenTonePatterns.join(" / ") || "none"}`,
  ].join("\n");
}
