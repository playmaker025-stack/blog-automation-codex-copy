import type { PipelineStage } from "@/lib/types/agent";

// ============================================================
// 파이프라인 실행 요청
// ============================================================

export interface PipelineRunRequest {
  topicId: string;
  userId: string;
  forcePreflightOverride?: boolean;
}

// ============================================================
// SSE 이벤트
// ============================================================

export type SSEEventType =
  | "stage_change"
  | "progress"
  | "token"
  | "approval_required"
  | "gate_blocked"      // release gate fail — 배포 차단됨
  | "rejected"          // 사용자 전략 거절 — 재시도 가능
  | "result"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  stage: PipelineStage;
  data: unknown;
  timestamp: string;
}

// ============================================================
// 에이전트 결과
// ============================================================

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
  contentTopology?: ContentTopologyPlan;
  naverLogic?: NaverLogicPlan;
  naverSignals?: NaverSignals;
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

export interface KeywordUsageItem {
  keyword: string;
  count: number;
  status: "부족" | "적정" | "과다";
  targetMin: number;
  targetMax: number;
  recommendation: string;
}

export interface KeywordUsageReport {
  items: KeywordUsageItem[];
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

export interface SeoEvaluation {
  score: number;
  evidence: string[];
  improvements: string[];
  keywordReport: KeywordUsageReport;
  keywordMetrics: KeywordFocusMetric[];
}

export interface ContentTopologyPlan {
  kind: ContentTopologyKind;
  reason: string;
  searchIntent: string;
  bodyPlacement: string;
  requiredSections: string[];
  internalLinkTargets: Array<{
    title: string;
    url?: string | null;
    reason: string;
  }>;
}

export interface WriterResult {
  postId: string;
  title: string;
  content: string; // 마크다운 본문
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
  pass: boolean; // aggregateScore >= 70
}

// ============================================================
// 승인 흐름
// ============================================================

export interface ApprovalPayload {
  pipelineId: string;
  previousTitle: string;
  proposedTitle: string;
  rationale: string;
}

export interface ApprovalRequest {
  pipelineId: string;
  approved: boolean;
  modifications?: string; // 승인 또는 거절 시 사용자 수정 요청 사항
}

// ============================================================
// 파이프라인 실행 상태 (in-memory + GitHub 저장)
// ============================================================

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
