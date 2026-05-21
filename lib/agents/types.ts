import type { PipelineStage } from "@/lib/types/agent";

export interface PipelineRunRequest {
  topicId: string;
  userId: string;
  forcePreflightOverride?: boolean;
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
  naverLogic?: NaverLogicPlan;
  naverSignals?: NaverSignals;
  publicationLearning?: PublicationLearningSummary | null;
  seriesRole?: "prelude" | "main";
  targetMainKeyword?: string;
}

export interface SearchCombinationTarget {
  phrase: string;
  role: "main" | "support" | "local" | "brand" | "mixed";
  priority: "core" | "support";
  rationale: string;
  suggestedPlacement: string;
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
}

export interface KeywordParagraphWarning {
  keyword: string;
  paragraphIndex: number;
  count: number;
  message: string;
}

export interface KeywordUsageReport {
  items: KeywordUsageItem[];
  mainKeyword: KeywordUsageItem | null;
  subKeywords: KeywordUsageItem[];
  overallRisk: "low" | "medium" | "high";
  overallRiskSummary: string;
  paragraphWarnings: KeywordParagraphWarning[];
  tokenItems: Array<{
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
}

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
