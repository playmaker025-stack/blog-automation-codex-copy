import { classifySearchCombination } from "./search-combination-utils.ts";
import { buildRoleSpecificWriterGuidance, formatArticleContract } from "./article-contract-utils.ts";
import { formatOverlapReport } from "./overlap-report-utils.ts";
import { formatArticlePlan } from "./article-plan.ts";

const SEO_PASS_THRESHOLD = 90;

type SearchCombinationTarget = {
  phrase: string;
  displayIntent?: string;
  role: "main" | "support" | "local" | "brand" | "mixed";
  priority: "core" | "support";
  rationale: string;
  suggestedPlacement: string;
  exactInsertionAllowed?: boolean;
  exactBlockReason?: string;
};

type KeywordLimit = {
  keyword: string;
  min: number;
  max: number;
  role: "main" | "sub" | "bridge" | "anchor";
};

type KeywordContract = {
  title: string;
  articleType: string;
  articleStage: string;
  searchIntent: string;
  topology: "hub" | "leaf";
  bodyRole: string;
  mainKeyword: string;
  subKeywords: string[];
  bridgeKeywords: string[];
  internalLinkAnchors: string[];
  forbiddenTerms: string[];
  limitedKeywords: KeywordLimit[];
  excludedTopics: string[];
  handoffTopics: string[];
  differentiationPoints: string[];
};

type CorpusSummaryArtifact = {
  styleProfile: {
    dominantTone: string;
    avgWordCount: number;
    openingPattern: string;
    structurePattern: string;
    signatureExpressions: string[];
  };
  exemplarExcerpts: Array<{
    title: string;
    styleNotes: string;
    excerpt: string;
  }>;
  representativeExcerpts?: string[];
};

type InternalLinkTarget = {
  title: string;
  url?: string | null;
  reason: string;
  role: "hub" | "leaf";
};

type ContentTopologyPlan = {
  kind: "hub" | "leaf";
  reason: string;
  searchIntent: string;
  bodyPlacement: string;
  requiredSections: string[];
  internalLinkTargets: InternalLinkTarget[];
};

type NaverLogicPlan = {
  primary: "dia" | "c-rank" | "hybrid";
  label: string;
  reason: string;
  writingFocus: string[];
  checklist: string[];
  completenessTarget: number;
};

type TopicIntentResolution = {
  searchIntent: string;
};

type StrategyPlanResult = {
  title: string;
  outline: Array<{
    heading: string;
    subPoints: string[];
    contentDirection: string;
    estimatedParagraphs: number;
  }>;
  keyPoints: string[];
  estimatedLength: number;
  tone: string;
  keywords: string[];
  suggestedSources: string[];
  rationale: string;
  targetSearchCombinations?: SearchCombinationTarget[];
  contentTopology?: ContentTopologyPlan;
  naverLogic?: NaverLogicPlan;
  naverSignals?: {
    keyword: string;
    cafeDemandSummary?: string;
    kinProblemSummary?: string;
    cafeTopItems?: Array<{ title: string }>;
    kinTopItems?: Array<{ title: string }>;
  };
  publicationLearning?: {
    source: string;
    totalEntries: number;
    avgEvalScore: number | null;
    avgWordCount: number | null;
    recentTitles: string[];
    topKeywords: string[];
    dominantContentKinds: string[];
    bestPerformingTitle: string | null;
    guidance: string[];
  } | null;
  seriesRole?: "prelude" | "main";
  keywordContract?: KeywordContract;
  articleContract?: import("./types.ts").ArticleContract;
  articlePlan?: import("./types.ts").ArticlePlan;
  overlapReport?: import("./types.ts").OverlapReport;
  topicIntentResolution?: TopicIntentResolution;
};

function buildPolicyPromptSection(): string {
  return [
    "## Mandatory blog workflow policy",
    "- Publishable drafts must answer the reader's search intent directly in this article.",
    "- Keep local/store context practical and avoid fake URLs or invented references.",
    "- Do not turn a general article into a teaser for the next article unless it is explicitly a prelude article.",
    "- Avoid keyword stuffing, generic checklist blog structure, and empty promotional claims.",
    "",
    "## Naver SEO release rule",
    `- A draft is usable only when it is likely to score ${SEO_PASS_THRESHOLD}+ for Naver SEO/search intent.`,
    "- Use long-tail keywords naturally, keep headings purposeful, and include concrete decision criteria.",
  ].join("\n");
}

function formatNaverWriterBrief(plan: NaverLogicPlan | undefined): string {
  if (!plan) return "Focus on practical local decision flow, not a generic SEO article.";
  return [
    `Primary logic: ${plan.label}`,
    `Reason: ${plan.reason}`,
    `Completeness target: ${plan.completenessTarget}`,
    ...plan.writingFocus.map((item) => `- ${item}`),
    ...plan.checklist.map((item) => `- ${item}`),
  ].join("\n");
}

function stripExcerptMeta(excerpt: string): string {
  return excerpt
    .replace(/^[\d\s./:]+?작성\s*/u, "")
    .replace(/^레퍼런스\s*\d+\s*/u, "")
    .replace(/^제목\s*=\s*/u, "")
    .trim();
}

function getKeywordPlacementTargets(): {
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
  const targets = getKeywordPlacementTargets();
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
  if (!contract) {
    return "Keyword contract is unavailable. Use only the provided strategy keywords and avoid extracting random words from the draft.";
  }

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
    `반복 제한: ${contract.limitedKeywords.map((item) => `${item.keyword} ${item.min}-${item.max}회 ${item.role}`).join(" / ")}`,
    "",
    `이 글에서 다루지 않을 내용: ${contract.excludedTopics.join(", ") || "없음"}`,
    `다음 글로 넘길 내용: ${contract.handoffTopics.join(", ") || "없음"}`,
    `기존 글과 겹치지 않게 분리할 포인트: ${contract.differentiationPoints.join(" / ") || "없음"}`,
    "",
    "중요: 이 계약서는 작성자가 지키는 내부 기준입니다. 발행 본문에는 '키워드 계약서', '검색의도', '메인 키워드', '서브 키워드', '선행포스팅', '키워드빌드업', 'SEO 점수' 같은 작업용 표현을 절대 쓰지 마세요.",
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
        ...(corpus.representativeExcerpts ?? []).slice(0, 5).map((excerpt, index) =>
          `[Published ${index + 1}]\n${excerpt}`
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
  return strategy.outline.map((section, index) => [
    `${index + 1}. ${section.heading}`,
    `Direction: ${section.contentDirection}`,
    `Sub-points: ${section.subPoints.join(" / ") || "none"}`,
    `Paragraph target: ${section.estimatedParagraphs}`,
    `Keywords: ${strategy.keywords.join(", ") || "none"}`,
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
    "Article plan:",
    formatArticlePlan(strategy.articlePlan),
    "",
    "Naver logic pre-check:",
    formatNaverWriterBrief(strategy.naverLogic),
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
    "- Never use these exact phrases in the published body: '실패 없는 선택', '꼼꼼한 안내', '핵심 포인트', '만족스러운 결과', '유의하시기 바랍니다'.",
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
    model: params.model ?? process.env.OPENAI_WRITER_MODEL ?? "gpt-5.4",
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
