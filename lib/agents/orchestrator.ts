import { randomUUID } from "crypto";
import { runStrategyPlanner } from "./strategy-planner";
import { runMasterWriter } from "./master-writer";
import { runHarnessEvaluator } from "./harness-evaluator";
import { ApprovalGate } from "./completion-checker";
import { upsertLedgerEntry, saveArtifactContract } from "./pipeline-ledger";
import { detectMaterialChange } from "./material-change-detector";
import { getCorpusSummary } from "./corpus-selector";
import { saveArtifact } from "./artifact-registry";
import { runPreWriteGate, runPostAuditGate } from "./release-gate";
import { registerBaselineCandidate, compareWithCurrentBaseline } from "./baseline-manager";
import {
  initApprovalState,
  transitionApprovalState,
  getApprovalState,
} from "./approval-state-machine";
import { appendLog } from "./operation-logger";
import { buildCompletionSupportFromRules as buildCompletionSupport } from "./completion-support";
import {
  appendWritingFailure,
  buildPreWriteHarnessBriefing,
  buildRevisionInstruction,
  getRecentHarnessFailureGuidance,
} from "./harness-guidance";
import { assertPreflightPassed } from "./preflight-checker";
import { naverLogicAgent } from "./naver-logic-agent";
import { localityKeywordAgent } from "./locality-keyword-agent";
import { evaluateSeoCompleteness } from "./seo-metrics";
import { readJsonFile, writeJsonFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { normalizeUserId } from "@/lib/utils/normalize";
import {
  createApprovalRecord,
  resolveApprovalRecord,
  readApprovalRecord,
  markApprovalConsumed,
} from "@/lib/github/approval-store";
import type { PostingIndex, Topic, TopicIndex } from "@/lib/types/github-data";
import type {
  PipelineRunRequest,
  PipelineState,
  ApprovalRequest,
  SSEEvent,
  StrategyPlanResult,
  WriterResult,
  EvalResult,
} from "./types";
import type {
  SourceReportData,
  ApprovalRequestData,
  RecordUpdateData,
  AuditReportData,
  DraftOutputData,
  StrategyPlanData,
  GateFailureReportData,
  RunStateSnapshotData,
  BlockingReasonData,
} from "./artifact-registry";

// ============================================================
// 승인 대기 in-memory 저장소
// ============================================================

interface PendingApproval {
  resolve: (approval: ApprovalRequest) => void;
  strategy: StrategyPlanResult;
}

// Keep maps stable across Next.js HMR reloads.
declare global {
   
  var _pendingApprovals: Map<string, PendingApproval> | undefined;
   
  var _activePipelines: Map<string, PipelineState> | undefined;
}
const pendingApprovals: Map<string, PendingApproval> =
  globalThis._pendingApprovals ?? (globalThis._pendingApprovals = new Map());
const activePipelines: Map<string, PipelineState> =
  globalThis._activePipelines ?? (globalThis._activePipelines = new Map());

// ============================================================
// SSE 이벤트 발행 헬퍼
// ============================================================

function emit(
  controller: ReadableStreamDefaultController,
  event: SSEEvent
): void {
  try {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  } catch {
    // stream이 닫힌 경우는 무시
  }
}

function makeEvent(
  type: SSEEvent["type"],
  stage: PipelineState["stage"],
  data: unknown
): SSEEvent {
  return { type, stage, data, timestamp: new Date().toISOString() };
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function extractApprovedTitle(modifications?: string): string | null {
  if (!modifications) return null;

  const explicitTitleLine = modifications.match(/(?:^|\n)\s*(?:제목|타이틀|수정 제목)\s*[:：]\s*(.+)\s*(?:$|\n)/i);
  const requestedTitle = explicitTitleLine?.[1]?.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  return requestedTitle ? requestedTitle : null;
}

function applyApprovalModificationsToStrategy(
  strategy: StrategyPlanResult,
  modifications?: string
): StrategyPlanResult {
  const normalized = modifications?.trim();
  if (!normalized) return strategy;

  const requestedTitle = extractApprovedTitle(normalized);
  return {
    ...strategy,
    title: requestedTitle ?? strategy.title,
    rationale: `${strategy.rationale}\n\n[사용자 승인 후 추가 수정 요청]\n${normalized}`,
    keyPoints: uniqueNonEmpty([
      ...strategy.keyPoints,
      `사용자 승인 후 수정 요청 반영: ${normalized}`,
    ]),
  };
}

function buildApprovalModificationBrief(modifications?: string): string {
  const normalized = modifications?.trim();
  if (!normalized) return "";

  return `## 사용자 승인 후 추가 수정 요청
${normalized}

위 수정 요청을 현재 전략보다 우선 반영한다.
- 방향 수정 요청이 있으면 도입과 핵심 설명 흐름부터 바로 반영한다.
- 제목 수정 요청이 있으면 명시된 제목을 최종 초안 제목으로 사용한다.
- 문체/강조점 수정 요청이 있으면 코퍼스 스타일을 유지하되 해당 요청을 우선 적용한다.`;
}

async function prepareHarnessBriefing(params: {
  userId: string;
  strategy: StrategyPlanResult;
  corpusSummary: import("./corpus-selector").CorpusSummaryArtifact;
}): Promise<string> {
  const recentFailures = await getRecentHarnessFailureGuidance({
    userId: params.userId,
    limit: 5,
  });
  return buildPreWriteHarnessBriefing({
    strategy: params.strategy,
    corpusSummary: params.corpusSummary,
    recentFailures,
  });
}

function getKeywordDangerCount(evalResult: EvalResult): number {
  return evalResult.seoEvaluation?.keywordReport.items.filter((item) => item.status === "danger").length ?? 0;
}

function getSeoScore(evalResult: EvalResult): number {
  return evalResult.seoEvaluation?.score ?? 0;
}

function getNaverScore(evalResult: EvalResult): number {
  return evalResult.naverLogicEvaluation?.completenessScore ?? 0;
}

function compareKeywordRiskLevel(value: "low" | "medium" | "high"): number {
  if (value === "low") return 0;
  if (value === "medium") return 1;
  return 2;
}

function shouldAttemptSmartRevision(evalResult: EvalResult): boolean {
  if (evalResult.pass) return false;

  const keywordReport = evalResult.seoEvaluation?.keywordReport;
  const overallRisk = keywordReport?.overallRisk ?? "low";
  const dangerCount = getKeywordDangerCount(evalResult);
  const paragraphWarningCount = keywordReport?.paragraphWarnings.length ?? 0;

  return (
    evalResult.aggregateScore < 70 ||
    getSeoScore(evalResult) < 72 ||
    getNaverScore(evalResult) < 72 ||
    dangerCount >= 2 ||
    (overallRisk === "high" && paragraphWarningCount >= 2)
  );
}

function isMaterialRevisionImprovement(previous: EvalResult, next: EvalResult): boolean {
  if (!previous.pass && next.pass) return true;
  if (getKeywordDangerCount(next) < getKeywordDangerCount(previous)) return true;

  const previousRisk = compareKeywordRiskLevel(previous.seoEvaluation?.keywordReport.overallRisk ?? "low");
  const nextRisk = compareKeywordRiskLevel(next.seoEvaluation?.keywordReport.overallRisk ?? "low");
  if (nextRisk < previousRisk) return true;

  if (getSeoScore(next) >= getSeoScore(previous) + 4) return true;
  if (getNaverScore(next) >= getNaverScore(previous) + 4) return true;
  if (next.aggregateScore >= previous.aggregateScore + 5) return true;

  return false;
}

async function evaluateAndMaybeReviseDraftSmart(params: {
  pipelineId: string;
  topicId: string;
  userId: string;
  postId: string;
  strategy: StrategyPlanResult;
  corpusSummary: import("./corpus-selector").CorpusSummaryArtifact;
  harnessBriefing: string;
  writerResult: WriterResult;
  controller: ReadableStreamDefaultController;
  signal?: AbortSignal;
}): Promise<{ writerResult: WriterResult; evalResult: EvalResult }> {
  const MAX_AUTO_REVISION_ROUNDS = 2;
  const {
    pipelineId,
    topicId,
    userId,
    postId,
    strategy,
    corpusSummary,
    harnessBriefing,
    controller,
    signal,
  } = params;

  let writerResult = params.writerResult;
  let evalResult = await runHarnessEvaluator({
    writerResult,
    strategy,
    userId,
    onProgress: (msg) => emit(controller, makeEvent("progress", "evaluating", { message: msg })),
    signal,
  });

  if (evalResult.pass) {
    return { writerResult, evalResult };
  }

  await appendWritingFailure({
    pipelineId,
    topicId,
    userId,
    title: writerResult.title,
    evalResult,
    phase: "preliminary",
  });

  if (!shouldAttemptSmartRevision(evalResult)) {
    emit(controller, makeEvent("progress", "evaluating", {
      message: `\uCD08\uC548 \uC810\uC218 ${evalResult.aggregateScore}\uC810\uC785\uB2C8\uB2E4. \uC790\uB3D9 \uBCF4\uAC15\uC73C\uB85C \uC5BB\uC744 \uAC1C\uC120 \uD3ED\uC774 \uD06C\uC9C0 \uC54A\uC544 \uD604\uC7AC \uCD08\uC548\uC744 \uC720\uC9C0\uD569\uB2C8\uB2E4.`,
    }));
    return { writerResult, evalResult };
  }

  for (let round = 1; round <= MAX_AUTO_REVISION_ROUNDS; round += 1) {
    const previousWriterResult = writerResult;
    const previousEvalResult = evalResult;

    emit(controller, makeEvent("progress", "evaluating", {
      message: `\uCD08\uC548 \uC810\uC218 ${evalResult.aggregateScore}\uC810 \uAE30\uC900\uC73C\uB85C \uBD80\uC871\uD55C \uD56D\uBAA9\uB9CC \uBCF4\uAC15\uD558\uB294 ${round + 1}\uCC28 \uCD08\uC548\uC744 \uC791\uC131\uD569\uB2C8\uB2E4.`,
    }));
    emit(controller, makeEvent("token", "writing", {
      token: `\n\n---\n\n[${round + 1}\uCC28 \uCD08\uC548]\n`,
    }));

    writerResult = await runMasterWriter({
      strategy,
      userId,
      topicId,
      postId,
      corpusSummary,
      harnessBriefing,
      revisionInstructions: buildRevisionInstruction({ evalResult, briefing: harnessBriefing }),
      onToken: (token) => emit(controller, makeEvent("token", "writing", { token })),
      onProgress: (msg) => emit(controller, makeEvent("progress", "writing", { message: msg })),
      signal,
    });

    await saveArtifact<DraftOutputData>(pipelineId, "draft_output", {
      postId: writerResult.postId,
      title: writerResult.title,
      wordCount: writerResult.wordCount,
      generatedAt: writerResult.generatedAt,
      contentPath: Paths.postContent(postId),
      corpusSummaryUsed: true,
    }).catch(() => {});

    await updatePostRecord(postId, {
      status: "ready",
      wordCount: writerResult.wordCount,
      compositionSessionId: pipelineId,
    });

    emit(controller, makeEvent("progress", "evaluating", {
      message: `${round + 1}\uCC28 \uCD08\uC548 \uD558\uB124\uC2A4 \uD3C9\uAC00 \uC911...`,
    }));

    evalResult = await runHarnessEvaluator({
      writerResult,
      strategy,
      userId,
      onProgress: (msg) => emit(controller, makeEvent("progress", "evaluating", { message: msg })),
      signal,
    });

    if (evalResult.pass) {
      return { writerResult, evalResult };
    }

    if (!isMaterialRevisionImprovement(previousEvalResult, evalResult)) {
      emit(controller, makeEvent("progress", "evaluating", {
        message: "\uC0C8 \uCD08\uC548\uC774 \uC774\uC804 \uCD08\uC548\uBCF4\uB2E4 \uB69C\uB837\uD558\uAC8C \uB098\uC544\uC9C0\uC9C0 \uC54A\uC544, \uCD94\uAC00 \uBCF4\uAC15\uC744 \uBA48\uCD94\uACE0 \uC9C1\uC804 \uCD08\uC548\uC744 \uC720\uC9C0\uD569\uB2C8\uB2E4.",
      }));
      writerResult = previousWriterResult;
      evalResult = previousEvalResult;
      break;
    }

    if (!shouldAttemptSmartRevision(evalResult)) {
      emit(controller, makeEvent("progress", "evaluating", {
        message: "\uBCF4\uAC15 \uD6C4 \uD575\uC2EC \uC704\uD5D8\uB3C4\uAC00 \uCDA9\uBD84\uD788 \uB0AE\uC544\uC838 \uC790\uB3D9 \uBCF4\uAC15\uC744 \uB9C8\uCE69\uB2C8\uB2E4.",
      }));
      return { writerResult, evalResult };
    }
  }

  if (!evalResult.pass) {
    await appendWritingFailure({
      pipelineId,
      topicId,
      userId,
      title: writerResult.title,
      evalResult,
      phase: "final",
    });
  }

  return { writerResult, evalResult };
}

// ============================================================
// 상태 업데이트 헬퍼
// ============================================================

function updateState(
  state: PipelineState,
  patch: Partial<PipelineState>
): PipelineState {
  return { ...state, ...patch, updatedAt: new Date().toISOString() };
}

// ============================================================
// 파이프라인 실행
// ============================================================

export async function runPipeline(params: {
  request: PipelineRunRequest;
  controller: ReadableStreamDefaultController;
  signal?: AbortSignal;
}): Promise<void> {
  const { controller, signal } = params;
  const request = { ...params.request, userId: normalizeUserId(params.request.userId) };
  const pipelineId = `pipe-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  let state: PipelineState = {
    pipelineId,
    topicId: request.topicId,
    userId: request.userId,
    stage: "idle",
    strategy: null,
    writerResult: null,
    evalResult: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  activePipelines.set(pipelineId, state);

  // Approval gate prevents record writes before approval.
  const gate = new ApprovalGate(pipelineId);

  // 이 파이프라인이 직접 topic을 in-progress로 설정한 경우에만 catch에서 복구
  let thisSetTopicInProgress = false;

  // Initialize the persistent run ledger.
  await upsertLedgerEntry({
    pipelineId,
    topicId: request.topicId,
    userId: request.userId,
    stage: "idle",
    error: null,
    approvalGranted: false,
    postingListUpdated: false,
    indexUpdated: false,
    createdAt: now,
  });

  // Initialize the persistent approval state.
  await initApprovalState({
    pipelineId,
    topicId: request.topicId,
    userId: request.userId,
  });

  try {
    // 0. 토픽 선택 유효성 검증
    const topicValidation = await validateTopicSelectionFromGitHub(request.topicId);
    if (!topicValidation.valid) {
      throw new Error(`토픽 선택 실패: ${topicValidation.reason}`);
    }
    await assertSeriesPrerequisitesPublished(request.topicId);

    // 1. 전략 수립
    state = updateState(state, { stage: "strategy-planning" });
    activePipelines.set(pipelineId, state);
    await upsertLedgerEntry({ pipelineId, topicId: request.topicId, userId: request.userId, stage: "strategy-planning", error: null, approvalGranted: false, postingListUpdated: false, indexUpdated: false, createdAt: now });
    emit(controller, makeEvent("stage_change", "strategy-planning", {
      pipelineId,
      message: "전략 수립을 시작합니다.",
    }));

    const strategy = await runStrategyPlanner({
      topicId: request.topicId,
      userId: request.userId,
      onProgress: (msg) =>
        emit(controller, makeEvent("progress", "strategy-planning", { message: msg })),
      signal,
    });
    await assertPreflightPassed(
      { topicId: request.topicId, proposedTitle: strategy.title },
      { allowOverride: request.forcePreflightOverride }
    );

    state = updateState(state, { strategy });
    activePipelines.set(pipelineId, state);

    // strategy_plan artifact 저장 (best-effort, GitHub 저장 실패여도 파이프라인은 계속)
    await saveArtifact<StrategyPlanData>(pipelineId, "strategy_plan", {
      title: strategy.title,
      outline: strategy.outline,
      keyPoints: strategy.keyPoints,
      estimatedLength: strategy.estimatedLength,
      tone: strategy.tone,
      keywords: strategy.keywords,
      rationale: strategy.rationale,
      corpusSummary: null,
      publicationLearning: strategy.publicationLearning ?? null,
    }).catch((e: unknown) => {
      console.warn("[orchestrator] saveArtifact(strategy_plan) 실패 (무시):", e instanceof Error ? e.message : e);
    });

    // 2. material_change 감지 + 승인 대기
    const originalTitle = (await loadTopicTitle(request.topicId)) ?? "";
    const mcResult = detectMaterialChange({
      original: { title: originalTitle },
      proposed: { title: strategy.title, keywords: strategy.keywords, rationale: strategy.rationale },
    });
    const materialChange = mcResult.isMaterial;

    // material_change 로그
    await appendLog(pipelineId, {
      type: "material_change",
      originalTitle,
      proposedTitle: strategy.title,
      isMaterial: mcResult.isMaterial,
      triggeredSignals: mcResult.triggeredSignals,
      stringSimilarity: mcResult.stringSimilarity ?? 0,
      overrideByHighSim: !mcResult.isMaterial && (mcResult.stringSimilarity ?? 0) >= 0.85,
    });

    state = updateState(state, { stage: "awaiting-approval" });
    activePipelines.set(pipelineId, state);

    // 승인 상태 전이: draft_ready -> waiting_for_user_approval (best-effort, in-memory 경로가 우선)
    await transitionApprovalState({
      pipelineId,
      to: "waiting_for_user_approval",
      reason: "승인 요청 발송",
    }).catch((e: unknown) => {
      console.warn("[orchestrator] transitionApprovalState(waiting) 실패 (무시):", e instanceof Error ? e.message : e);
    });

    const approvalRequestedAt = new Date().toISOString();
    emit(controller, makeEvent("approval_required", "awaiting-approval", {
      pipelineId,
      previousTitle: originalTitle,
      proposedTitle: strategy.title,
      materialChange,
      rationale: strategy.rationale,
      outline: strategy.outline.map((s) => s.heading),
    }));

    // 승인 대기 (최대 30분)
    let timedOut = false;
    const approval = await Promise.race([
      waitForApproval(pipelineId, strategy),
      new Promise<never>((_, reject) =>
        setTimeout(() => { timedOut = true; reject(new Error("승인 대기 시간이 초과되었습니다. (30분)")); }, 30 * 60 * 1000)
      ),
    ]);

    // approval_ux 로그
    const respondedAt = new Date().toISOString();
    await appendLog(pipelineId, {
      type: "approval_ux",
      materialChange,
      requestedAt: approvalRequestedAt,
      respondedAt,
      approved: approval.approved,
      elapsedMs: new Date(respondedAt).getTime() - new Date(approvalRequestedAt).getTime(),
      timedOut,
    });

    if (!approval.approved) {
      await transitionApprovalState({
        pipelineId,
        to: "draft_ready",
        reason: `사용자 거절${approval.modifications ? `: ${approval.modifications}` : ""}`,
        actor: request.userId,
      });
      state = updateState(state, { stage: "idle" });
      activePipelines.set(pipelineId, state);
      // 거절 후 topic 상태가 이미 in-progress면 draft로 복구
      try {
        const statusAtReject = await loadTopicStatus(request.topicId);
        if (statusAtReject === "in-progress") {
          await updateTopicStatus(request.topicId, "draft");
        }
      } catch { /* 복구 실패는 무시 */ }
      emit(controller, makeEvent("rejected", "idle", {
        pipelineId,
        message: "전략이 거절되었습니다. 수정 후 다시 시도해 주세요.",
        modifications: approval.modifications ?? null,
      }));
      return;
    }

    // Store the approval request artifact.
    await saveArtifact<ApprovalRequestData>(pipelineId, "approval_request", {
      pipelineId,
      previousTitle: originalTitle,
      proposedTitle: strategy.title,
      materialChange,
      materialChangeSignals: mcResult.triggeredSignals,
      rationale: strategy.rationale,
      requestedAt: approvalRequestedAt,
      response: {
        approved: approval.approved,
        respondedAt: new Date().toISOString(),
        modifications: approval.modifications ?? null,
      },
    });

    // 승인 상태 전이: waiting_for_user_approval -> approved_pending_record_update
    await transitionApprovalState({
      pipelineId,
      to: "approved_pending_record_update",
      reason: "사용자 승인 완료",
      actor: request.userId,
    });

    // Lock the topic before creating a post record so concurrent users cannot create orphan posts.
    gate.assertApproved();
    const topicStatusBefore = await loadTopicStatus(request.topicId);
    const setResult = await atomicSetTopicInProgress(request.topicId);
    if (!setResult.success) {
      throw new Error(`Topic lock failed: ${setResult.reason}`);
    }
    thisSetTopicInProgress = true;
    await upsertLedgerEntry({ pipelineId, topicId: request.topicId, userId: request.userId, stage: "writing", error: null, approvalGranted: true, postingListUpdated: false, indexUpdated: true, createdAt: now });

    const postRecord = await createPostingRecord({
      topicId: request.topicId,
      userId: request.userId,
      title: strategy.title,
      pipelineId,
    });
    await upsertLedgerEntry({ pipelineId, topicId: request.topicId, userId: request.userId, stage: "writing", error: null, approvalGranted: true, postingListUpdated: true, indexUpdated: true, createdAt: now });


    // Store the record update artifact.
    await saveArtifact<RecordUpdateData>(pipelineId, "record_update", {
      postingListUpdated: true,
      postingListUpdatedAt: new Date().toISOString(),
      indexUpdated: true,
      indexUpdatedAt: new Date().toISOString(),
      postId: postRecord.postId,
      topicStatusBefore: topicStatusBefore ?? "pending",
      topicStatusAfter: "in-progress",
    });

    // 승인 상태 전이: approved_pending_record_update -> records_updated
    await transitionApprovalState({
      pipelineId,
      to: "records_updated",
      reason: "posting-list와 topic index 반영 완료",
    });

    // 4.5. corpus summary 준비 + pre-write gate
    emit(controller, makeEvent("progress", "writing", { message: "코퍼스 분석 중..." }));
    const topicCategory = await loadTopicCategory(request.topicId);
    const corpusSummary = await getCorpusSummary({
      userId: request.userId,
      category: topicCategory,
      userTone: strategy.tone,
      topicTitle: strategy.title,
    });
    await saveArtifact<StrategyPlanData>(pipelineId, "strategy_plan", {
      title: strategy.title,
      outline: strategy.outline,
      keyPoints: strategy.keyPoints,
      estimatedLength: strategy.estimatedLength,
      tone: strategy.tone,
      keywords: strategy.keywords,
      rationale: strategy.rationale,
      corpusSummary,
      publicationLearning: strategy.publicationLearning ?? null,
    }).catch(() => {});

    // corpus_retrieval 로그
    await appendLog(pipelineId, {
      type: "corpus_retrieval",
      userId: request.userId,
      selectedCount: corpusSummary.selectedCount,
      strategy: corpusSummary.retrievalStrategy,
      staleCount: corpusSummary.staleWarnings.length,
      staleWarnings: corpusSummary.staleWarnings,
      topScores: corpusSummary.scoringBreakdown.slice(0, 3).map((s) => ({
        sampleId: s.sampleId,
        finalScore: s.finalScore,
      })),
      targetCategory: topicCategory,
    });

    if (corpusSummary.staleWarnings.length > 0) {
      emit(controller, makeEvent("progress", "writing", {
        message: `오래된 예시 글 경고: ${corpusSummary.staleWarnings.join("; ")}`,
      }));
    }

    // pre-write gate 검증 (조건 1-3)
    const { getArtifact: _getArtifact } = await import("./artifact-registry");
    const approvalArtifact = await _getArtifact<ApprovalRequestData>(pipelineId, "approval_request");
    const recordArtifact = await _getArtifact<RecordUpdateData>(pipelineId, "record_update");

    const preGateResult = runPreWriteGate({
      sourceReport: null as SourceReportData | null,
      approvalRequest: approvalArtifact?.data ?? null,
      recordUpdate: recordArtifact?.data ?? null,
    });
    // pre-write gate 로그
    await appendLog(pipelineId, {
      type: "gate_result",
      gate: "pre-write",
      passed: preGateResult.passed,
      blockedBy: preGateResult.blockedBy,
      reason: preGateResult.reason,
    });

    if (!preGateResult.passed) {
      const blockedAt = new Date().toISOString();
      const approvalStateNow = await getApprovalState(pipelineId).catch(() => null);
      await Promise.allSettled([
        saveArtifact<GateFailureReportData>(pipelineId, "gate_failure_report", {
          gate: "pre-write",
          blockedBy: preGateResult.blockedBy ?? "unknown",
          reason: preGateResult.reason,
          blockedAt,
        }),
        saveArtifact<RunStateSnapshotData>(pipelineId, "run_state_snapshot", {
          pipelineId,
          topicId: request.topicId,
          userId: request.userId,
          stage: state.stage,
          approvalState: approvalStateNow?.state ?? "unknown",
          postId: postRecord.postId,
          strategyTitle: strategy.title,
          wordCount: null,
          evalScore: null,
          postingListUpdated: true,
          indexUpdated: true,
          snapshotAt: blockedAt,
        }),
        saveArtifact<BlockingReasonData>(pipelineId, "blocking_reason", {
          gate: "pre-write",
          code: preGateResult.blockedBy ?? "unknown",
          summary: preGateResult.reason,
          actionRequired: "전략 승인 상태와 기록 갱신 여부를 확인한 뒤 다시 실행해 주세요.",
          canRetry: true,
        }),
      ]);
      throw new Error(`pre-write gate 차단: ${preGateResult.reason}`);
    }
    emit(controller, makeEvent("progress", "writing", { message: "pre-write gate 통과" }));
    const baseHarnessBriefing = await prepareHarnessBriefing({
      userId: request.userId,
      strategy,
      corpusSummary,
    });
    const localityKeywordPlan = await localityKeywordAgent.buildPreWritePlan({
      userId: request.userId,
      strategy,
      topicId: request.topicId,
    });
    const harnessBriefing = [baseHarnessBriefing, localityKeywordPlan.writerBrief].join("\n\n");
    emit(controller, makeEvent("progress", "writing", { message: "하네스 기준을 반영한 작성 브리핑 준비 완료" }));

    // 5. 본문 작성
    state = updateState(state, { stage: "writing" });
    activePipelines.set(pipelineId, state);
    emit(controller, makeEvent("stage_change", "writing", {
      pipelineId,
      message: "Master Writer가 본문을 작성합니다.",
    }));

    let writerResult = await runMasterWriter({
      strategy,
      userId: request.userId,
      topicId: request.topicId,
      postId: postRecord.postId,
      corpusSummary,
      harnessBriefing,
      onToken: (token) =>
        emit(controller, makeEvent("token", "writing", { token })),
      onProgress: (msg) =>
        emit(controller, makeEvent("progress", "writing", { message: msg })),
      signal,
    });

    state = updateState(state, { writerResult });
    activePipelines.set(pipelineId, state);

    // Store the draft output artifact.
    await saveArtifact<DraftOutputData>(pipelineId, "draft_output", {
      postId: writerResult.postId,
      title: writerResult.title,
      wordCount: writerResult.wordCount,
      generatedAt: writerResult.generatedAt,
      contentPath: Paths.postContent(postRecord.postId),
      corpusSummaryUsed: true,
    });

    // posting-list wordCount 업데이트
    await updatePostRecord(postRecord.postId, {
      status: "ready",
      wordCount: writerResult.wordCount,
      compositionSessionId: pipelineId,
    });

    // 6. 1차 평가
    state = updateState(state, { stage: "evaluating" });
    activePipelines.set(pipelineId, state);
    emit(controller, makeEvent("stage_change", "evaluating", {
      pipelineId,
      message: "Harness Evaluator가 초안을 평가합니다.",
    }));

    const revised = await evaluateAndMaybeReviseDraftSmart({
      pipelineId,
      topicId: request.topicId,
      userId: request.userId,
      postId: postRecord.postId,
      strategy,
      corpusSummary,
      harnessBriefing,
      writerResult,
      controller,
      signal,
    });
    writerResult = revised.writerResult;
    const evalResult = revised.evalResult;
    await localityKeywordAgent.recordUsedKeywords({
      userId: request.userId,
      topicId: request.topicId,
      writerResult,
      plan: localityKeywordPlan,
    }).catch((error) => {
      console.warn("[orchestrator] locality keyword ledger update failed:", error instanceof Error ? error.message : error);
    });

    state = updateState(state, { writerResult, evalResult });
    activePipelines.set(pipelineId, state);

    // post-audit gate 검증 (조건 4)
    const postGateResult = runPostAuditGate({
      auditReport: { pass: evalResult.pass, aggregateScore: evalResult.aggregateScore },
    });

    // baseline 비교 (gate 결과와 무관하게 항상 수행)
    const scenarioId = request.topicId;
    const baselineDiff = await compareWithCurrentBaseline({
      scenarioId,
      current: { runId: evalResult.runId, scores: evalResult.scores, aggregateScore: evalResult.aggregateScore },
    });
    const baselineDelta = baselineDiff?.aggregateDelta ?? null;

    if (baselineDiff?.overallRegression) {
      emit(controller, makeEvent("progress", "evaluating", {
        message: `baseline 경고: ${baselineDiff.summary}`,
      }));
    }

    // audit_report artifact 저장: gate 결과와 baseline delta 포함
    await saveArtifact<AuditReportData>(pipelineId, "audit_report", {
      runId: evalResult.runId,
      scores: evalResult.scores,
      aggregateScore: evalResult.aggregateScore,
      reasoning: evalResult.reasoning,
      recommendations: evalResult.recommendations,
      pass: evalResult.pass,
      baselineDelta,
    });

    // post-audit gate 로그
    await appendLog(pipelineId, {
      type: "gate_result",
      gate: "post-audit",
      passed: postGateResult.passed,
      blockedBy: postGateResult.blockedBy,
      reason: postGateResult.reason,
      evalScore: evalResult.aggregateScore,
    });

    const { hashtags, imageFileNames } = buildCompletionSupport(
      strategy,
      writerResult.title,
      topicCategory
    );
    const naverLogicEvaluation = naverLogicAgent.auditAfterWriting({ strategy, writerResult, evalResult });

    if (!postGateResult.passed) {
      await updatePostRecord(postRecord.postId, {
        evalScore: evalResult.aggregateScore,
        status: "ready",
      });
      await transitionApprovalState({
        pipelineId,
        to: "released",
        reason: `Draft saved with eval warning: ${postGateResult.reason}`,
      }).catch(() => {});
      try { await updateTopicStatus(request.topicId, "draft"); } catch { /* ignore */ }

      state = updateState(state, { stage: "complete" });
      activePipelines.set(pipelineId, state);
      await upsertLedgerEntry({
        pipelineId, topicId: request.topicId, userId: request.userId,
        stage: "complete", error: null,
        approvalGranted: true, postingListUpdated: true, indexUpdated: true, createdAt: now,
      });

      emit(controller, makeEvent("progress", "evaluating", {
        message: `평가 점수는 ${evalResult.aggregateScore}점으로 기준보다 낮지만, 본문 초안은 저장했습니다.`,
      }));
      emit(controller, makeEvent("result", "complete", {
        pipelineId,
        postId: postRecord.postId,
        title: writerResult.title,
        wordCount: writerResult.wordCount,
        evalScore: evalResult.aggregateScore,
        baselineDelta,
        pass: false,
        recommendations: evalResult.recommendations,
        naverLogicEvaluation,        hashtags,
        imageFileNames,
      }));
      emit(controller, makeEvent("stage_change", "complete", {
        pipelineId,
        message: "본문 초안 저장 완료. 평가 점수는 개선 권고로 표시됩니다.",
      }));
      return;
    }

    // POST-AUDIT GATE PASS 후 최종 상태 전이 (차단 사유 없을 때만)
    emit(controller, makeEvent("progress", "evaluating", { message: "post-audit gate 통과" }));

    // candidate 등록 (gate 통과 시에만)
    const candidateResult = await registerBaselineCandidate({
      scenarioId,
      runId: evalResult.runId,
      postId: postRecord.postId,
      pipelineId,
      scores: evalResult.scores,
      aggregateScore: evalResult.aggregateScore,
      notes: `pipeline ${pipelineId} / post ${postRecord.postId}`,
    });
    await appendLog(pipelineId, {
      type: "baseline_candidate",
      scenarioId,
      runId: evalResult.runId,
      aggregateScore: evalResult.aggregateScore,
      registered: candidateResult.registered,
      reason: candidateResult.reason,
    });
    emit(controller, makeEvent("progress", "evaluating", {
      message: `baseline candidate: ${candidateResult.reason}`,
    }));

    // posting-list final update (gate 통과 시에만)
    await updatePostRecord(postRecord.postId, {
      evalScore: evalResult.aggregateScore,
      status: "approved",
    });

    // artifact contract 저장 (gate 통과 시에만)
    await saveArtifactContract({
      pipelineId,
      postId: postRecord.postId,
      topicId: request.topicId,
      userId: request.userId,
      title: writerResult.title,
      wordCount: writerResult.wordCount,
      contentPath: Paths.postContent(postRecord.postId),
      generatedAt: writerResult.generatedAt,
      evalRunId: evalResult.runId,
      evalScore: evalResult.aggregateScore,
    });

    // 승인 상태 전이: records_updated -> released (gate 통과 시에만)
    await transitionApprovalState({
      pipelineId,
      to: "released",
      reason: "모든 gate 통과 및 배포 준비 완료",
    });

    // 7. 완료
    state = updateState(state, { stage: "complete" });
    activePipelines.set(pipelineId, state);
    await upsertLedgerEntry({ pipelineId, topicId: request.topicId, userId: request.userId, stage: "complete", error: null, approvalGranted: true, postingListUpdated: true, indexUpdated: true, createdAt: now });

    emit(controller, makeEvent("result", "complete", {
      pipelineId,
      postId: postRecord.postId,
      title: writerResult.title,
      wordCount: writerResult.wordCount,
        evalScore: evalResult.aggregateScore,
        baselineDelta,
        pass: evalResult.pass,
        recommendations: evalResult.recommendations,
        naverLogicEvaluation,        hashtags,
        imageFileNames,
      }));
    emit(controller, makeEvent("stage_change", "complete", {
      pipelineId,
      message: "파이프라인이 완료되었습니다.",
    }));
  } catch (err) {
    let message = err instanceof Error ? err.message : "알 수 없는 오류";

    // APIConnectionError: 서버 로그에 상세 정보 기록 + 사용자 메시지 보강
    if (err instanceof Error && err.constructor.name === "APIConnectionError") {
      const cause = (err as { cause?: unknown }).cause;
      const causeMsg = cause instanceof Error ? ` (원인: ${cause.message})` : "";
      console.error("[orchestrator] Anthropic 연결 오류:", {
        message: err.message,
        cause,
        code: (err as { code?: string }).code,
      });
      message = `Anthropic API 연결 실패${causeMsg}. Railway 환경 변수 ANTHROPIC_API_KEY와 /api/anthropic/ping 진단을 확인해 주세요.`;
    }

    state = updateState(state, { stage: "failed", error: message });
    activePipelines.set(pipelineId, state);
    console.error(`[orchestrator] pipeline ${pipelineId} FAILED at stage=${state.stage}:`, message);
    await upsertLedgerEntry({ pipelineId, topicId: request.topicId, userId: request.userId, stage: "failed", error: message, approvalGranted: gate.approved, postingListUpdated: false, indexUpdated: false, createdAt: now }).catch((e) => {
      console.error(`[orchestrator] ledger failed-write error (ignored):`, e instanceof Error ? e.message : e);
    });
    await appendLog(pipelineId, {
      type: "pipeline_failure",
      stage: state.stage,
      topicId: request.topicId,
      userId: request.userId,
      message,
      recoveredTopicToDraft: false,
      errorName: err instanceof Error ? err.constructor.name : undefined,
    }).catch(() => {});
    emit(controller, makeEvent("error", "failed", { pipelineId, message }));

    // 파이프라인 실패 시 topic이 in-progress 상태로 멈추지 않도록 draft로 복구
    // thisSetTopicInProgress 플래그로 이 파이프라인이 직접 설정한 경우만 복구
    // (다른 파이프라인이 in-progress로 설정한 경우는 건드리지 않음)
    if (thisSetTopicInProgress) {
      try {
        const currentStatus = await loadTopicStatus(request.topicId);
        if (currentStatus === "in-progress") {
          await updateTopicStatus(request.topicId, "draft");
          await appendLog(pipelineId, {
            type: "pipeline_failure",
            stage: "failed",
            topicId: request.topicId,
            userId: request.userId,
            message,
            recoveredTopicToDraft: true,
            errorName: err instanceof Error ? err.constructor.name : undefined,
          }).catch(() => {});
          emit(controller, makeEvent("progress", "failed", { message: "주제 상태를 draft로 복구했습니다." }));
        }
      } catch (recoveryErr) {
        console.error(`[orchestrator] topic recovery failed (ignored):`, recoveryErr instanceof Error ? recoveryErr.message : recoveryErr);
      }
    }
  } finally {
    pendingApprovals.delete(pipelineId);
    controller.close();
  }
}

// ============================================================
// 승인 처리
// ============================================================

/**
 * 승인 처리는 메모리(동일 인스턴스) + GitHub(재시작/다중 인스턴스) 병행
 * approve 엔드포인트에서 호출한다. 정상 승인 처리.
 */
export async function handleApproval(approval: ApprovalRequest): Promise<boolean> {
  // 1. 메모리 경로 (동일 인스턴스 내 즉시 반영)
  const pending = pendingApprovals.get(approval.pipelineId);
  if (pending) {
    pending.resolve(approval);
    pendingApprovals.delete(approval.pipelineId);
  }

  // 2. GitHub 경로 (재시작/다중 인스턴스 fallback 용도로 기록)
  try {
    await resolveApprovalRecord(approval.pipelineId, approval.approved, approval.modifications);
  } catch {
    // best-effort: GitHub 기록이 실패해도 메모리 경로가 있으면 계속 진행
  }

  return true; // 정상 성공 반환 (404도 제거)
}

/**
 * 승인 대기는 메모리(즉시) + GitHub 폴링(3초 간격) 병렬 실행
 * 둘 중 먼저 응답하는 쪽을 사용
 */
async function waitForApproval(
  pipelineId: string,
  strategy: StrategyPlanResult
): Promise<ApprovalRequest> {
    // GitHub 승인 대기 레코드 생성 (서버 재시작 복구용)
  await createApprovalRecord(pipelineId).catch(() => {});

  return new Promise((resolve, reject) => {
    // 메모리 경로 등록
    pendingApprovals.set(pipelineId, { resolve, strategy });

    // GitHub 폴링 (3초 간격) - 재시작/다중 인스턴스 fallback
    const pollInterval = setInterval(async () => {
      try {
        const record = await readApprovalRecord(pipelineId);
        if (record?.status === "approved" || record?.status === "rejected") {
          clearInterval(pollInterval);
          pendingApprovals.delete(pipelineId);
          await markApprovalConsumed(pipelineId).catch(() => {});
          resolve({
            pipelineId,
            approved: record.status === "approved",
            modifications: record.modifications ?? undefined,
          });
        }
      } catch {
        // GitHub 일시 오류는 무시
      }
    }, 3000);

    // 타임아웃/정리
    const originalResolve = resolve;
    pendingApprovals.set(pipelineId, {
      resolve: (approval) => {
        clearInterval(pollInterval);
        originalResolve(approval);
      },
      strategy,
    });

    // reject 후 정리 (이미 timeout Promise가 reject하는 경우)
    void reject; // suppress unused warning ??reject is handled by outer Promise.race
  });
}

// ============================================================
// 파이프라인 상태 조회
// ============================================================

export function getPipelineState(pipelineId: string): PipelineState | null {
  return activePipelines.get(pipelineId) ?? null;
}

// ============================================================
// GitHub 데이터 헬퍼
// ============================================================

async function validateTopicSelectionFromGitHub(
  topicId: string
): Promise<{ valid: boolean; reason: string }> {
  try {
    const path = Paths.topicsIndex();
    if (!(await fileExists(path))) {
      return { valid: false, reason: "topics index 파일이 없습니다." };
    }
    const { data: index } = await readJsonFile<TopicIndex>(path);
    const { validateTopicSelection } = await import("./completion-checker");
    return validateTopicSelection(topicId, index.topics);
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "토픽 검증 실패" };
  }
}

async function loadTopicIndex(): Promise<TopicIndex | null> {
  try {
    const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
    return data;
  } catch {
    return null;
  }
}

async function loadTopicData(topicId: string): Promise<{ topic: Topic | null; index: TopicIndex | null }> {
  const index = await loadTopicIndex();
  if (!index) {
    return { topic: null, index: null };
  }

  return {
    topic: index.topics.find((candidate) => candidate.topicId === topicId) ?? null,
    index,
  };
}

async function assertSeriesPrerequisitesPublished(topicId: string): Promise<void> {
  const { topic, index } = await loadTopicData(topicId);
  if (!topic || !index || topic.seriesRole !== "main" || !topic.seriesId) return;

  const prerequisites = topic.prerequisiteTopicIds?.length
    ? index.topics.filter((candidate) => topic.prerequisiteTopicIds?.includes(candidate.topicId))
    : index.topics.filter(
        (candidate) =>
          candidate.seriesId === topic.seriesId &&
          candidate.seriesRole === "prelude" &&
          (candidate.sequenceOrder ?? 0) < (topic.sequenceOrder ?? Number.MAX_SAFE_INTEGER)
      );
  const missing = prerequisites.filter((candidate) => candidate.status !== "published");

  if (missing.length > 0) {
    throw new Error(
      `선행 포스팅 미발행: 메인 글 "${topic.title}" 작성 전 ${missing
        .map((candidate) => `"${candidate.title}"`)
        .join(", ")} 발행이 필요합니다.`
    );
  }
}

async function loadTopicTitle(topicId: string): Promise<string | null> {
  const { topic } = await loadTopicData(topicId);
  return topic?.title ?? null;
}

async function loadTopicStatus(topicId: string): Promise<string | null> {
  const { topic } = await loadTopicData(topicId);
  return topic?.status ?? null;
}

async function loadTopicCategory(topicId: string): Promise<string | undefined> {
  const { topic } = await loadTopicData(topicId);
  return topic?.category;
}

async function createPostingRecord(params: {
  topicId: string;
  userId: string;
  title: string;
  pipelineId: string;
}): Promise<{ postId: string }> {
  const userId = normalizeUserId(params.userId);
  const postId = `post-${randomUUID().slice(0, 8)}`;

  await withConflictRetry(async () => {
    const now = new Date().toISOString();
    const path = Paths.postingListIndex();
    const exists = await fileExists(path);
    let index: PostingIndex = { posts: [], lastUpdated: now };
    let sha: string | null = null;

    if (exists) {
      const result = await readJsonFile<PostingIndex>(path);
      index = result.data;
      sha = result.sha;
    }

    const updated: PostingIndex = {
      posts: [
        ...index.posts,
        {
          postId,
          topicId: params.topicId,
          userId,
          title: params.title,
          status: "draft",
          naverPostUrl: null,
          evalScore: null,
          wordCount: 0,
          compositionSessionId: params.pipelineId,
          pendingApproval: null,
          createdAt: now,
          publishedAt: null,
          updatedAt: now,
        },
      ],
      lastUpdated: now,
    };

    await writeJsonFile(path, updated, `feat: create post record ${postId}`, sha);
  });

  return { postId };
}

// SHA 충돌 재시도 헬퍼
// GitHub API는 SHA 불일치 시 409/422를 반환한다.
// 500/503은 서버 일시 오류, 429는 rate limit로 모두 재시도 가능하다.
// fn() 내부에서 최신 SHA를 매번 새로 읽으므로 순수 함수처럼 호출하면 된다.
async function withConflictRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 20
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const retryable = status === 409 || status === 422 || status === 429 || status === 500 || status === 503;
      if (retryable && attempt < maxAttempts - 1) {
        // jitter로 thundering herd 방지 (429면 더 길게 대기)
        const base = status === 429 ? 2_000 : 200;
        const delay = Math.min(10_000, base * 2 ** attempt) + Math.floor(Math.random() * base);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  /* istanbul ignore next */
  throw new Error("withConflictRetry: unreachable");
}

// 토픽 상태 원자적 in-progress 설정
// validate와 write를 하나의 SHA 트랜잭션 안에서 수행한다.
// 동시에 여러 파이프라인이 같은 토픽을 잡더라도 정확히 하나만 in-progress로 진입한다.
async function atomicSetTopicInProgress(
  topicId: string
): Promise<{ success: boolean; reason: string }> {
  let result: { success: boolean; reason: string } = { success: false, reason: "unknown" };

  await withConflictRetry(async () => {
    const path = Paths.topicsIndex();
    if (!(await fileExists(path))) {
      result = { success: false, reason: "topics index 파일이 없습니다." };
      return;
    }
    const { data: index, sha } = await readJsonFile<TopicIndex>(path);
    const topic = index.topics.find((t) => t.topicId === topicId);
    if (!topic) {
      result = { success: false, reason: `topicId "${topicId}"를 찾을 수 없습니다.` };
      return;
    }
    if (topic.status === "in-progress") {
      result = { success: false, reason: "이미 다른 파이프라인이 이 주제를 작성 중입니다." };
      return;
    }
    if (topic.status !== "draft") {
      result = { success: false, reason: `주제 상태가 draft가 아닙니다. (현재: ${topic.status})` };
      return;
    }
    const now = new Date().toISOString();
    const updated: TopicIndex = {
      topics: index.topics.map((t) =>
        t.topicId === topicId ? { ...t, status: "in-progress", updatedAt: now } : t
      ),
      lastUpdated: now,
    };
    await writeJsonFile(path, updated, `chore: topic ${topicId} -> in-progress [atomic]`, sha);
    result = { success: true, reason: "in-progress 설정 완료" };
  });

  return result;
}

async function updatePostRecord(
  postId: string,
  patch: Partial<import("@/lib/types/github-data").PostingRecord>
): Promise<void> {
  await withConflictRetry(async () => {
    const path = Paths.postingListIndex();
    if (!(await fileExists(path))) return;

    const { data: index, sha } = await readJsonFile<PostingIndex>(path);
    const now = new Date().toISOString();

    const updated: PostingIndex = {
      posts: index.posts.map((p) =>
        p.postId === postId ? { ...p, ...patch, updatedAt: now } : p
      ),
      lastUpdated: now,
    };

    await writeJsonFile(path, updated, `chore: update post ${postId}`, sha);
  });
}

async function updateTopicStatus(
  topicId: string,
  status: import("@/lib/types/github-data").Topic["status"]
): Promise<void> {
  await withConflictRetry(async () => {
    const path = Paths.topicsIndex();
    if (!(await fileExists(path))) return;

    const { data: index, sha } = await readJsonFile<TopicIndex>(path);
    const now = new Date().toISOString();

    const updated: TopicIndex = {
      topics: index.topics.map((t) =>
        t.topicId === topicId ? { ...t, status, updatedAt: now } : t
      ),
      lastUpdated: now,
    };

    await writeJsonFile(path, updated, `chore: topic ${topicId} -> ${status}`, sha);
  });
}

// ============================================================
// 2단계 파이프라인 - Phase 1: 전략 수립
// ============================================================

export async function runStrategyPhase(params: {
  topicId: string;
  userId: string;
  pipelineId: string;
  forcePreflightOverride?: boolean;
  controller: ReadableStreamDefaultController;
  signal?: AbortSignal;
}): Promise<void> {
  const { topicId, pipelineId, controller, signal } = params;
  const userId = normalizeUserId(params.userId);
  const now = new Date().toISOString();

  let state: PipelineState = {
    pipelineId,
    topicId,
    userId,
    stage: "idle",
    strategy: null,
    writerResult: null,
    evalResult: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  activePipelines.set(pipelineId, state);

  try {
    // Validate the selected topic before planning.
    const topicValidation = await validateTopicSelectionFromGitHub(topicId);
    if (!topicValidation.valid) {
      throw new Error(`토픽 선택 실패: ${topicValidation.reason}`);
    }
    await assertSeriesPrerequisitesPublished(topicId);

    // 1. 전략 수립
    state = updateState(state, { stage: "strategy-planning" });
    activePipelines.set(pipelineId, state);
    emit(controller, makeEvent("stage_change", "strategy-planning", {
      pipelineId,
      message: "전략 수립을 시작합니다.",
    }));

    const strategy = await runStrategyPlanner({
      topicId,
      userId,
      onProgress: (msg) => emit(controller, makeEvent("progress", "strategy-planning", { message: msg })),
      signal,
    });
    await assertPreflightPassed(
      { topicId, proposedTitle: strategy.title },
      { allowOverride: params.forcePreflightOverride }
    );

    state = updateState(state, { strategy });
    activePipelines.set(pipelineId, state);

    // strategy_plan artifact 저장 (best-effort)
    await saveArtifact<StrategyPlanData>(pipelineId, "strategy_plan", {
      title: strategy.title,
      outline: strategy.outline,
      keyPoints: strategy.keyPoints,
      estimatedLength: strategy.estimatedLength,
      tone: strategy.tone,
      keywords: strategy.keywords,
      rationale: strategy.rationale,
      corpusSummary: null,
      publicationLearning: strategy.publicationLearning ?? null,
    }).catch((e: unknown) => {
      console.warn("[orchestrator] saveArtifact(strategy_plan) 실패 (무시):", e instanceof Error ? e.message : e);
    });

    // 2. material_change 감지
    const originalTitle = (await loadTopicTitle(topicId)) ?? "";
    const mcResult = detectMaterialChange({
      original: { title: originalTitle },
      proposed: { title: strategy.title, keywords: strategy.keywords, rationale: strategy.rationale },
    });

    await appendLog(pipelineId, {
      type: "material_change",
      originalTitle,
      proposedTitle: strategy.title,
      isMaterial: mcResult.isMaterial,
      triggeredSignals: mcResult.triggeredSignals,
      stringSimilarity: mcResult.stringSimilarity ?? 0,
      overrideByHighSim: !mcResult.isMaterial && (mcResult.stringSimilarity ?? 0) >= 0.85,
    }).catch(() => {});

    state = updateState(state, { stage: "awaiting-approval" });
    activePipelines.set(pipelineId, state);

    // 승인 요청 이벤트 발행 (strategy 전체 포함, write phase에서 사용)
    emit(controller, makeEvent("approval_required", "awaiting-approval", {
      pipelineId,
      previousTitle: originalTitle,
      proposedTitle: strategy.title,
      materialChange: mcResult.isMaterial,
      rationale: strategy.rationale,
      outline: strategy.outline.map((s) => s.heading),
      strategy, // write phase가 이 값을 받아 POST body까지 사용
    }));

  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    state = updateState(state, { stage: "failed", error: message });
    activePipelines.set(pipelineId, state);
    console.error(`[orchestrator] strategy phase ${pipelineId} FAILED:`, message);
    await appendLog(pipelineId, {
      type: "pipeline_failure",
      stage: "strategy-planning",
      topicId,
      userId,
      message,
      recoveredTopicToDraft: false,
      errorName: err instanceof Error ? err.constructor.name : undefined,
    }).catch(() => {});
    emit(controller, makeEvent("error", "failed", { pipelineId, message }));
  } finally {
    controller.close();
  }
}

// ============================================================
// 2단계 파이프라인 - Phase 2: 글쓰기 + 평가
// ============================================================

export async function runWritePhase(params: {
  topicId: string;
  userId: string;
  pipelineId: string;
  strategy: StrategyPlanResult;
  modifications?: string;
  forcePreflightOverride?: boolean;
  controller: ReadableStreamDefaultController;
  signal?: AbortSignal;
}): Promise<void> {
  const { topicId, pipelineId, strategy, controller, signal } = params;
  const userId = normalizeUserId(params.userId);
  const now = new Date().toISOString();
  const gate = new ApprovalGate(pipelineId);
  gate.grant(); // 클라이언트에서 이미 승인됨
  let thisSetTopicInProgress = false;
  const approvalModifications = params.modifications?.trim() || "";
  const effectiveStrategy = applyApprovalModificationsToStrategy(strategy, approvalModifications);

  let state: PipelineState = {
    pipelineId,
    topicId,
    userId,
    stage: "awaiting-approval",
    strategy: effectiveStrategy,
    writerResult: null,
    evalResult: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  activePipelines.set(pipelineId, state);

  try {
    // Lock the topic before creating a post record so concurrent users cannot create orphan posts.
    gate.assertApproved();
    await assertPreflightPassed(
      { topicId, proposedTitle: effectiveStrategy.title },
      { allowOverride: params.forcePreflightOverride }
    );
    await assertSeriesPrerequisitesPublished(topicId);
    const setResult = await atomicSetTopicInProgress(topicId);
    if (!setResult.success) {
      throw new Error(`Topic lock failed: ${setResult.reason}`);
    }
    thisSetTopicInProgress = true;

    const postRecord = await createPostingRecord({ topicId, userId, title: effectiveStrategy.title, pipelineId });

    // approval_request artifact (best-effort)
    await saveArtifact<ApprovalRequestData>(pipelineId, "approval_request", {
      pipelineId,
      previousTitle: "",
      proposedTitle: effectiveStrategy.title,
      materialChange: false,
      materialChangeSignals: [],
      rationale: effectiveStrategy.rationale,
      requestedAt: now,
      response: { approved: true, respondedAt: now, modifications: approvalModifications || null },
    }).catch(() => {});

    // record_update artifact (best-effort)
    await saveArtifact<RecordUpdateData>(pipelineId, "record_update", {
      postingListUpdated: true,
      postingListUpdatedAt: now,
      indexUpdated: true,
      indexUpdatedAt: now,
      postId: postRecord.postId,
      topicStatusBefore: "draft",
      topicStatusAfter: "in-progress",
    }).catch(() => {});

    // 4.5. corpus + pre-write gate
    emit(controller, makeEvent("progress", "writing", { message: "코퍼스 분석 중..." }));
    const topicCategory = await loadTopicCategory(topicId);
    const corpusSummary = await getCorpusSummary({
      userId,
      category: topicCategory,
      userTone: strategy.tone,
      topicTitle: strategy.title,
    });
    await saveArtifact<StrategyPlanData>(pipelineId, "strategy_plan", {
      title: strategy.title,
      outline: strategy.outline,
      keyPoints: strategy.keyPoints,
      estimatedLength: strategy.estimatedLength,
      tone: strategy.tone,
      keywords: strategy.keywords,
      rationale: strategy.rationale,
      corpusSummary,
      publicationLearning: strategy.publicationLearning ?? null,
    }).catch(() => {});

    const { getArtifact: _getArtifact } = await import("./artifact-registry");
    const approvalArtifact = await _getArtifact<ApprovalRequestData>(pipelineId, "approval_request");
    const recordArtifact = await _getArtifact<RecordUpdateData>(pipelineId, "record_update");
    const preGateResult = runPreWriteGate({
      sourceReport: null as SourceReportData | null,
      approvalRequest: approvalArtifact?.data ?? null,
      recordUpdate: recordArtifact?.data ?? null,
    });

    if (!preGateResult.passed) {
      throw new Error(`pre-write gate 차단: ${preGateResult.reason}`);
    }
    emit(controller, makeEvent("progress", "writing", { message: "pre-write gate 통과" }));
    const baseHarnessBriefing = await prepareHarnessBriefing({
      userId,
      strategy: effectiveStrategy,
      corpusSummary,
    });
    const localityKeywordPlan = await localityKeywordAgent.buildPreWritePlan({
      userId,
      strategy: effectiveStrategy,
      topicId,
    });
    const harnessBriefing = [
      baseHarnessBriefing,
      localityKeywordPlan.writerBrief,
      buildApprovalModificationBrief(approvalModifications),
    ]
      .filter(Boolean)
      .join("\n\n");
    emit(controller, makeEvent("progress", "writing", { message: "하네스 기준을 반영한 작성 브리핑 준비 완료" }));

    // 5. 본문 작성
    state = updateState(state, { stage: "writing" });
    activePipelines.set(pipelineId, state);
    emit(controller, makeEvent("stage_change", "writing", {
      pipelineId,
      message: "Master Writer가 본문을 작성합니다.",
    }));

    let writerResult = await runMasterWriter({
      strategy: effectiveStrategy,
      userId,
      topicId,
      postId: postRecord.postId,
      corpusSummary,
      harnessBriefing,
      onToken: (token) => emit(controller, makeEvent("token", "writing", { token })),
      onProgress: (msg) => emit(controller, makeEvent("progress", "writing", { message: msg })),
      signal,
    });

    state = updateState(state, { writerResult });
    activePipelines.set(pipelineId, state);

    await saveArtifact<DraftOutputData>(pipelineId, "draft_output", {
      postId: writerResult.postId,
      title: writerResult.title,
      wordCount: writerResult.wordCount,
      generatedAt: writerResult.generatedAt,
      contentPath: Paths.postContent(postRecord.postId),
      corpusSummaryUsed: true,
    }).catch(() => {});

    await updatePostRecord(postRecord.postId, {
      status: "ready",
      wordCount: writerResult.wordCount,
      compositionSessionId: pipelineId,
    });

    // 6. 1차 평가
    state = updateState(state, { stage: "evaluating" });
    activePipelines.set(pipelineId, state);
    emit(controller, makeEvent("stage_change", "evaluating", {
      pipelineId,
      message: "Harness Evaluator가 초안을 평가합니다.",
    }));

    const revised = await evaluateAndMaybeReviseDraftSmart({
      pipelineId,
      topicId,
      userId,
      postId: postRecord.postId,
      strategy: effectiveStrategy,
      corpusSummary,
      harnessBriefing,
      writerResult,
      controller,
      signal,
    });
    writerResult = revised.writerResult;
    const evalResult = revised.evalResult;
    await localityKeywordAgent.recordUsedKeywords({
      userId,
      topicId,
      writerResult,
      plan: localityKeywordPlan,
    }).catch((error) => {
      console.warn("[orchestrator] locality keyword ledger update failed:", error instanceof Error ? error.message : error);
    });

    state = updateState(state, { writerResult, evalResult });
    activePipelines.set(pipelineId, state);

    const postGateResult = runPostAuditGate({
      auditReport: { pass: evalResult.pass, aggregateScore: evalResult.aggregateScore },
    });

    const scenarioId = topicId;
    const baselineDiff = await compareWithCurrentBaseline({
      scenarioId,
      current: { runId: evalResult.runId, scores: evalResult.scores, aggregateScore: evalResult.aggregateScore },
    });
    const baselineDelta = baselineDiff?.aggregateDelta ?? null;

    await saveArtifact<AuditReportData>(pipelineId, "audit_report", {
      runId: evalResult.runId,
      scores: evalResult.scores,
      aggregateScore: evalResult.aggregateScore,
      reasoning: evalResult.reasoning,
      recommendations: evalResult.recommendations,
      pass: evalResult.pass,
      baselineDelta,
    }).catch(() => {});

    const { hashtags, imageFileNames } = buildCompletionSupport(
      effectiveStrategy,
      writerResult.title,
      topicCategory
    );
    const naverLogicEvaluation = naverLogicAgent.auditAfterWriting({ strategy: effectiveStrategy, writerResult, evalResult });
    const seoEvaluation = evaluateSeoCompleteness({
      title: writerResult.title,
      body: writerResult.content,
      keywords: effectiveStrategy.keywords,
      targetSearchCombinations: effectiveStrategy.targetSearchCombinations,
      seriesRole: effectiveStrategy.seriesRole,
      targetMainKeyword: effectiveStrategy.targetMainKeyword,
    });

    if (!postGateResult.passed) {
      await updatePostRecord(postRecord.postId, {
        evalScore: evalResult.aggregateScore,
        status: "ready",
      });
      try { await updateTopicStatus(topicId, "draft"); } catch { /* ignore */ }

      state = updateState(state, { stage: "complete" });
      activePipelines.set(pipelineId, state);

      emit(controller, makeEvent("progress", "evaluating", {
        message: `평가 점수는 ${evalResult.aggregateScore}점으로 기준보다 낮지만, 본문 초안은 저장했습니다.`,
      }));
      emit(controller, makeEvent("result", "complete", {
        pipelineId,
        postId: postRecord.postId,
        title: writerResult.title,
        wordCount: writerResult.wordCount,
        evalScore: evalResult.aggregateScore,
        baselineDelta,
        pass: false,
        recommendations: evalResult.recommendations,
        seoEvaluation,
        naverLogicEvaluation,        hashtags,
        imageFileNames,
      }));
      emit(controller, makeEvent("stage_change", "complete", {
        pipelineId,
        message: "본문 초안 저장 완료. 평가 점수는 개선 권고로 표시됩니다.",
      }));
      return;
    }

    // 7. 완료
    const candidateResult = await registerBaselineCandidate({
      scenarioId,
      runId: evalResult.runId,
      postId: postRecord.postId,
      pipelineId,
      scores: evalResult.scores,
      aggregateScore: evalResult.aggregateScore,
      notes: `pipeline ${pipelineId} / post ${postRecord.postId}`,
    });

    if (baselineDiff?.overallRegression) {
      emit(controller, makeEvent("progress", "evaluating", {
        message: `baseline 경고: ${baselineDiff.summary}`,
      }));
    }
    emit(controller, makeEvent("progress", "evaluating", {
      message: `baseline candidate: ${candidateResult.reason}`,
    }));

    await updatePostRecord(postRecord.postId, {
      evalScore: evalResult.aggregateScore,
      status: "approved",
    });

    await saveArtifactContract({
      pipelineId,
      postId: postRecord.postId,
      topicId,
      userId,
      title: writerResult.title,
      wordCount: writerResult.wordCount,
      contentPath: Paths.postContent(postRecord.postId),
      generatedAt: writerResult.generatedAt,
      evalRunId: evalResult.runId,
      evalScore: evalResult.aggregateScore,
    });

    // 완료 후 topic을 draft로 복구해 글목록에서 다시 보이도록 함 (다음 단계 작업용)
    try { await updateTopicStatus(topicId, "draft"); } catch { /* 무시 */ }

    state = updateState(state, { stage: "complete" });
    activePipelines.set(pipelineId, state);

    emit(controller, makeEvent("result", "complete", {
      pipelineId,
      postId: postRecord.postId,
      title: writerResult.title,
      wordCount: writerResult.wordCount,
        evalScore: evalResult.aggregateScore,
        baselineDelta,
        pass: evalResult.pass,
        recommendations: evalResult.recommendations,
        seoEvaluation,
        naverLogicEvaluation,        hashtags,
        imageFileNames,
      }));
    emit(controller, makeEvent("stage_change", "complete", {
      pipelineId,
      message: "파이프라인이 완료되었습니다.",
    }));

  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    state = updateState(state, { stage: "failed", error: message });
    activePipelines.set(pipelineId, state);
    console.error(`[orchestrator] write phase ${pipelineId} FAILED:`, message);
    await appendLog(pipelineId, {
      type: "pipeline_failure",
      stage: state.stage,
      topicId,
      userId,
      message,
      recoveredTopicToDraft: false,
      errorName: err instanceof Error ? err.constructor.name : undefined,
    }).catch(() => {});
    emit(controller, makeEvent("error", "failed", { pipelineId, message }));

    if (thisSetTopicInProgress) {
      try {
        const currentStatus = await loadTopicStatus(topicId);
        if (currentStatus === "in-progress") {
          await updateTopicStatus(topicId, "draft");
          await appendLog(pipelineId, {
            type: "pipeline_failure",
            stage: "failed",
            topicId,
            userId,
            message,
            recoveredTopicToDraft: true,
            errorName: err instanceof Error ? err.constructor.name : undefined,
          }).catch(() => {});
        }
      } catch { /* ignore */ }
    }
  } finally {
    controller.close();
  }
}
