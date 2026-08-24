import type { PipelineStage } from "@/lib/types/agent";

export interface PipelineRunRequest {
  topicId: string;
  userId: string;
  forcePreflightOverride?: boolean;
  duplicateModeOverride?: DuplicateMode;
}

export type SSEEventType =
  | "stage_change"
  | "progress"
  | "token"
  | "approval_required"
  | "gate_blocked"
  | "rejected"
  | "result"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  stage: PipelineStage;
  data: unknown;
  timestamp: string;
}

export interface StrategyPlanResult {
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
  serpAnalysis?: SerpAnalysis;
  writerStructure?: WriterStructurePlan;
  naverLogic?: NaverLogicPlan;
  naverSignals?: NaverSignals;
  publicationLearning?: PublicationLearningSummary | null;
  seriesRole?: "prelude" | "main";
  targetMainKeyword?: string;
  keywordContract?: KeywordContract;
  articleContract?: ArticleContract;
  articlePlan?: ArticlePlan;
  strategyQualityGate?: StrategyQualityGateResult;
  overlapReport?: OverlapReport;
  topicIntentResolution?: TopicIntentResolution;
  strategySource?: "ai" | "local_fallback";
  strategyProvider?: "anthropic" | "openai" | "local";
  strategyFallbackReason?: string;
}

export type DuplicateMode = "different_angle" | "force_duplicate";

export interface ArticlePlan {
  title: string;
  mainKeyword: string;
  subKeywords: string[];
  searchIntent: string;
  requiredEntities: string[];
  lockedRequirements: string[];
  requiredSections: string[];
  duplicateMode?: DuplicateMode;
  planVersion: number;
  updatedAt: string;
}

export type ArticleRole =
  | "general"
  | "prelude"
  | "problem_solution"
  | "review"
  | "comparison"
  | "main_recommendation"
  | "product_list_recommendation";

export type CompletionMode = "end_here" | "handoff";

export type IntroPattern =
  | "customer_question"
  | "recent_inquiry"
  | "problem_symptom"
  | "purchase_before_visit"
  | "policy_confusion"
  | "product_experience";

export type ConclusionPattern =
  | "visit_consultation"
  | "criteria_summary"
  | "handoff_next_article"
  | "problem_checklist"
  | "product_fit_summary";

export type ContentNodeType = "hub" | "leaf" | "bridge";

export interface KeywordUsagePolicy {
  avoidSubKeywordStuffingInQuestions: boolean;
  preferContextualSubKeywordUse: boolean;
}

export interface ArticleContract {
  articleRole: ArticleRole;
  completionMode: CompletionMode;
  nodeType: ContentNodeType;
  introPattern: IntroPattern;
  conclusionPattern: ConclusionPattern;
  mainIntent: string;
  readerState: string;
  readerQuestions: string[];
  mustResolve: string[];
  mustNotDefer: string[];
  handoffKeyword?: string | null;
  forbiddenExactPhrases: string[];
  forbiddenHeadingPatterns: string[];
  forbiddenTonePatterns: string[];
  ctaMode: string;
  keywordUsagePolicy: KeywordUsagePolicy;
}

export interface StrategyQualityGateResult {
  ok: boolean;
  blockingReasons: string[];
  warnings: string[];
}

export interface ExistingArticleSummary {
  title: string;
  normalizedTitle: string;
  userId: string;
  articleRole: ArticleRole;
  nodeType: ContentNodeType;
  targetKeyword: string;
  normalizedTargetKeyword: string;
  searchIntent: string;
  normalizedSearchIntent: string;
  internalLinkTargets: string[];
  introPattern?: IntroPattern | null;
  conclusionPattern?: ConclusionPattern | null;
  ctaMode?: string | null;
  topicId?: string | null;
  postId?: string | null;
}

export interface OverlapReport {
  riskLevel: "low" | "medium" | "high";
  similarTitles: string[];
  similarIntents: string[];
  repeatedIntroPatterns: string[];
  repeatedConclusionPatterns: string[];
  repeatedInternalLinkTargets: string[];
  repeatedCtaModes: string[];
  roleConflicts: string[];
  recommendedRewriteDirection: string;
}

export type ArticleType =
  | "warmup"
  | "main_recommendation"
  | "product_list_recommendation"
  | "criteria_recommendation"
  | "comparison"
  | "problem_solution"
  | "review"
  | "howto"
  | "general_info"
  | "local_hub"
  | "leaf";

export type ArticleStage =
  | "pre_suasion"
  | "info_summary"
  | "comparison_judgment"
  | "purchase_review"
  | "problem_solution"
  | "internal_link";

export type KeywordContractRole = "main" | "sub" | "bridge" | "anchor" | "forbidden";

export interface KeywordLimit {
  keyword: string;
  min: number;
  max: number;
  role: Exclude<KeywordContractRole, "forbidden">;
}

export interface KeywordContract {
  title: string;
  articleType: ArticleType;
  articleStage: ArticleStage;
  searchIntent: string;
  topology: ContentTopologyKind;
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
  subKeywordRoles?: KeywordRoleAssignment[];
  productCandidates?: string[];
  comparisonTargets?: string[];
}

export type TopicIntentKind =
  | "product_list_recommendation"
  | "criteria_recommendation"
  | "comparison"
  | "review"
  | "problem_solution"
  | "prelude"
  | "general_info";

export type KeywordSemanticRole =
  | "product_candidate"
  | "brand_candidate"
  | "comparison_target"
  | "general_support";

export interface KeywordRoleAssignment {
  keyword: string;
  role: KeywordSemanticRole;
}

export interface TopicIntentResolution {
  intentType: TopicIntentKind;
  articleType: ArticleType;
  articleStage: ArticleStage;
  searchIntent: string;
  reason: string;
  isProductListRecommendation: boolean;
  productCandidates: string[];
  comparisonTargets: string[];
  keywordAssignments: KeywordRoleAssignment[];
}

export interface SearchCombinationTarget {
  phrase: string;
  displayIntent?: string;
  role: "main" | "support" | "local" | "brand" | "mixed";
  priority: "core" | "support";
  rationale: string;
  suggestedPlacement: string;
  exactInsertionAllowed?: boolean;
  exactBlockReason?: string;
}

export interface PublicationLearningSummary {
  source: "content-learning" | "published-posts-fallback" | "writing-profile";
  totalEntries: number;
  avgEvalScore: number | null;
  avgWordCount: number | null;
  recentTitles: string[];
  topKeywords: string[];
  dominantContentKinds: string[];
  bestPerformingTitle: string | null;
  lastPublishedAt: string | null;
  guidance: string[];
}

export interface NaverSignalItem {
  title: string;
  link: string;
  description: string;
}

export interface NaverSignals {
  keyword: string;
  cafeDemandSummary?: string;
  kinProblemSummary?: string;
  cafeTopItems?: NaverSignalItem[];
  kinTopItems?: NaverSignalItem[];
}

// ============================================================
// SERP 모듈 분류 (references/agent-seo-analyst.md)
// ============================================================

export type SerpModule = "ai_briefing" | "ai_tab" | "clip" | "place" | "shopping" | "blog_view";

export type SerpModuleConfidence = "high" | "medium" | "low";

export type AiBriefingCitationType = "geo_priority" | "seo_required";

export type PlaceSubtype =
  | "place_city"
  | "place_dong"
  | "place_station"
  | "place_visit_check"
  | "place_review";

/** 블로그 역할 배정 코드 — CLAUDE.md "글목록 생성 시 블로그 역할 적합성 검사" */
export type BlogRoleCode = "A" | "B" | "C" | "D" | "E";

export interface SerpAnalysis {
  /** 전략에 사용할 최종 모듈. 관측값이 있으면 관측값을 우선한다. */
  serpModule: SerpModule;
  /** 실제 모바일 통합검색 첫 화면에서 확인한 모듈. 미확인이면 null. */
  observedSerpModule: SerpModule | null;
  /** 키워드 언어 패턴으로 예측한 모듈. */
  predictedSerpModule: SerpModule;
  serpModuleConfidence: SerpModuleConfidence;
  serpModuleReason: string;
  serpModuleOptions: SerpModule[];
  primarySearchIntent: string;
  recommendedBlogRole: BlogRoleCode;
  aiBriefingCitationType: AiBriefingCitationType | null;
  aiBriefingCitationNote: string | null;
  placeSubtype: PlaceSubtype | null;
  /** 블로그탭 유무는 항상 보조 신호다. */
  blogTabIsPrimarySignal: false;
  checkedAt: string;
  checkDevice: "mobile" | "unknown";
}

/**
 * serpModule별 글 구조 계획 (references/agent-writer-engine.md).
 * writer는 스스로 SERP 모듈을 추론하지 않고 이 계획을 받아 구조를 선택한다.
 */
export interface WriterStructurePlan {
  serpModule: SerpModule;
  label: string;
  goal: string;
  requiredSections: string[];
  requiredElements: string[];
  forbiddenMoves: string[];
  qaChecklist: string[];
  briefingNote: string;
  /**
   * AI 인용 레이어 — 모듈과 무관하게 모든 글에 요구된다.
   * 목표가 네이버 AI탭/AI 브리핑 노출이므로 인용 가능성은 선택이 아니라 기본값이다.
   */
  citationLayer: string[];
  /**
   * AI가 본문을 요약해도 클릭할 이유가 남도록 본문에만 두는 정보.
   * 인용 유도와 클릭 방어를 양립시키는 장치다.
   */
  clickRetention: string[];
}

export type ContentTopologyKind = "hub" | "leaf";

export type NaverLogicType = "dia" | "c-rank" | "hybrid";

export interface NaverLogicPlan {
  primary: NaverLogicType;
  label: string;
  reason: string;
  writingFocus: string[];
  checklist: string[];
  completenessTarget: number;
}

export interface NaverLogicEvaluation {
  primary: NaverLogicType;
  label: string;
  completenessScore: number;
  reason: string;
  evidence: string[];
  improvements: string[];
}

export type KeywordUsageStatus = "under" | "ok" | "caution" | "danger";

export interface KeywordUsageItem {
  keyword: string;
  count: number;
  status: KeywordUsageStatus;
  targetMin: number;
  targetMax: number;
  recommendation: string;
  role?: KeywordContractRole;
}

export interface KeywordParagraphWarning {
  keyword: string;
  paragraphIndex: number;
  count: number;
  message: string;
}

export interface SeoKeywordItem {
  keyword: string;
  role: "main" | "sub";
  exactCount: number;
  includedCount: number;
  effectiveCount: number;
  risk: KeywordUsageStatus;
  note: string;
  exactPhraseExclusionApplied: boolean;
}

export interface BodyRepetitionItem {
  token: string;
  count: number;
  category: "noun" | "category_word" | "verb_stem" | "sentence_ending";
  severity: "notice" | "caution";
  message: string;
  suggestion: string;
  isSeoRisk: false;
}

export type ConfirmedSeoKeywordSource = "keywordContract" | "directInput" | "postingList" | "none";

export interface ConfirmedSeoKeywordRejection {
  value: string;
  reason: string;
}

export interface ConfirmedSeoKeywords {
  mainKeyword: string | null;
  subKeywords: string[];
  source: ConfirmedSeoKeywordSource;
  rejectedCandidates: ConfirmedSeoKeywordRejection[];
}

export interface KeywordUsageReport {
  items: KeywordUsageItem[];
  mainKeyword: KeywordUsageItem | null;
  subKeywords: KeywordUsageItem[];
  bridgeKeywords?: KeywordUsageItem[];
  internalLinkAnchors?: KeywordUsageItem[];
  forbiddenItems?: KeywordUsageItem[];
  contractApplied?: boolean;
  overallRisk: "low" | "medium" | "high";
  overallRiskSummary: string;
  paragraphWarnings: KeywordParagraphWarning[];
  seoKeywordItems: SeoKeywordItem[];
  requiredEntityChecks?: Array<{
    entity: string;
    included: boolean;
    note: string;
  }>;
  bodyRepetitionItems: BodyRepetitionItem[];
  legacyTokenItems?: Array<{
    token: string;
    count: number;
    sourceKeywords: string[];
    note: string;
  }>;
  tokenItems?: Array<{
    token: string;
    count: number;
    sourceKeywords: string[];
    note: string;
  }>;
  totalMentions: number;
  introCoverage: boolean;
  titleFrontLoaded: boolean;
  bodyLength: number;
  summary: string[];
  recommendations: string[];
  confirmedSeoKeywords?: ConfirmedSeoKeywords;
}

export interface FinalDraftCheck {
  ok: boolean;
  blockingReasons: string[];
  warnings: string[];
  matchedForbiddenPhrases: string[];
  keywordStuffingFindings: string[];
  deferFindings: string[];
  contractCoverageFindings: string[];
  overlapFindings: string[];
  /** 제품 사양 원장과 대조한 결과. 모순은 차단, 미확인은 경고. */
  specFindings: string[];
}

/**
 * 발행 본문은 코드가 자동 수정하지 않는다. 검수에서 걸린 항목은 본문을 고치는 대신
 * 재작성 지시문으로만 남기고, 실제 수정은 master-writer 재작성 라운드가 담당한다.
 */
export type FinalDraftRevisionInstructions = string[];

export interface KeywordFocusMetric {
  keyword: string;
  role: "main" | "sub";
  label: string;
  completenessScore: number;
  exposurePotentialScore: number;
  count: number;
  targetMin: number;
  targetMax: number;
  titleIncluded: boolean;
  titleFrontLoaded: boolean;
  introIncluded: boolean;
  earlyCoverage: boolean;
  summary: string;
  action: string;
}

export interface SearchCombinationMetric {
  phrase: string;
  role: SearchCombinationTarget["role"];
  priority: SearchCombinationTarget["priority"];
  exactMatches: number;
  tokenCoverage: number;
  titleIncluded: boolean;
  headingIncluded: boolean;
  introIncluded: boolean;
  earlyCoverage: boolean;
  coverageScore: number;
  exposurePotentialScore: number;
  summary: string;
  action: string;
}

export interface SeoEvaluation {
  score: number;
  evidence: string[];
  improvements: string[];
  keywordReport: KeywordUsageReport;
  keywordMetrics: KeywordFocusMetric[];
  combinationCoverageScore: number;
  combinationMetrics: SearchCombinationMetric[];
}

export interface InternalLinkTarget {
  title: string;
  url?: string | null;
  reason: string;
  role: "hub" | "leaf";
  anchorTextMustMatchTitle?: boolean;
}

export interface ContentTopologyPlan {
  kind: ContentTopologyKind;
  reason: string;
  searchIntent: string;
  bodyPlacement: string;
  requiredSections: string[];
  hubReference?: InternalLinkTarget | null;
  leafReference?: InternalLinkTarget | null;
  internalLinkTargets: InternalLinkTarget[];
}

export interface WriterResult {
  postId: string;
  title: string;
  content: string;
  wordCount: number;
  generatedAt: string;
  finalDraftCheck?: FinalDraftCheck;
  finalDraftRevisionInstructions?: FinalDraftRevisionInstructions;
  /**
   * AI 인용 가능성 검수 (LAYER 6).
   * 계약 검사(finalDraftCheck)와 분리한다 — 계약 위반은 발행 금지지만
   * 인용 가능성은 재작성으로 끌어올리는 품질 축이다.
   */
  citationReadiness?: import("./citation-readiness").CitationReadiness;
}

export interface EvalResult {
  runId: string;
  scores: {
    originality: number;
    style_match: number;
    structure: number;
    engagement: number;
    forbidden_check: number;
  };
  aggregateScore: number;
  reasoning: Record<string, string>;
  recommendations: string[];
  pass: boolean;
  seoEvaluation?: SeoEvaluation;
  naverLogicEvaluation?: NaverLogicEvaluation;
}

export interface ApprovalPayload {
  pipelineId: string;
  previousTitle: string;
  proposedTitle: string;
  rationale: string;
}

export interface ApprovalRequest {
  pipelineId: string;
  approved: boolean;
  modifications?: string;
}

export interface PipelineState {
  pipelineId: string;
  topicId: string;
  userId: string;
  stage: PipelineStage;
  strategy: StrategyPlanResult | null;
  writerResult: WriterResult | null;
  evalResult: EvalResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
