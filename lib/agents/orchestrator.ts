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
// ?뱀씤 ?湲?in-memory ??μ냼
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
// SSE ?대깽??諛쒗뻾 ?ы띁
// ============================================================

function emit(
  controller: ReadableStreamDefaultController,
  event: SSEEvent
): void {
  try {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  } catch {
    // stream???대? ?ロ엺 寃쎌슦 ??臾댁떆
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

const HASHTAG_STOPWORDS = new Set([
  "보는",
  "많이",
  "고르기",
  "고르는",
  "선택",
  "선택기준",
  "기준",
  "전에",
  "이유",
  "찾는",
  "정리",
  "가이드",
  "체크",
  "체크포인트",
  "체크리스트",
  "실제",
  "시작",
  "필수",
  "선행포스팅",
  "키워드빌드업",
  "메인포스팅",
  "네이버블로그",
  "블로그초안",
  "정보글",
]);

function isUsefulHashtagToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 2) return false;
  if (HASHTAG_STOPWORDS.has(normalized)) return false;
  if (/^\d+$/u.test(normalized)) return false;
  return true;
}

function extractHashtagTokens(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => isUsefulHashtagToken(word));
}

function makeHashtagText(value: string): string {
  return `#${value.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, "")}`;
}

function makeKoreanImageStem(value: string): string {
  const stem = value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, "_");
  return stem.slice(0, 64) || "블로그_초안";
}

function buildCompletionSupport(strategy: StrategyPlanResult, title: string): {
  hashtags: string[];
  imageFileNames: string[];
} {
  const phraseSeeds = strategy.keywords.filter((keyword) => keyword.trim().length >= 2);
  const tokenSeeds = uniqueNonEmpty([
    ...phraseSeeds.flatMap((keyword) => extractHashtagTokens(keyword)),
    ...extractHashtagTokens(title),
  ]);

  const hashtagSeeds = uniqueNonEmpty([
    ...phraseSeeds,
    ...tokenSeeds,
  ]);

  const hashtags = uniqueNonEmpty(hashtagSeeds.map(makeHashtagText))
    .filter((tag) => tag.length > 1)
    .slice(0, 10);

  const imageStem = makeKoreanImageStem(title);
  const imageLabels = [
    "대표",
    "문제상황",
    "정상비정상",
    "원인분류",
    "체크포인트",
    "제품상세",
    "해결방법",
    "비교전후",
    "주의사항",
    "매장확인",
    "요약",
    "마무리",
  ];
  const imageFileNames = imageLabels.map(
    (label, index) => `${imageStem}_${label}_${String(index + 1).padStart(2, "0")}.jpg`
  );

  return { hashtags, imageFileNames };
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

async function evaluateAndMaybeReviseDraft(params: {
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

  for (let round = 1; round <= MAX_AUTO_REVISION_ROUNDS; round += 1) {
    emit(controller, makeEvent("progress", "evaluating", {
      message: `초안 예상 점수 ${evalResult.aggregateScore}점으로 자동 보강을 ${round}/${MAX_AUTO_REVISION_ROUNDS}회 진행합니다.`,
    }));
    emit(controller, makeEvent("token", "writing", {
      token: round === 1 ? "\n\n---\n\n[자동 보강본]\n" : `\n\n---\n\n[자동 보강본 ${round}차]\n`,
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
      message: round === MAX_AUTO_REVISION_ROUNDS
        ? "자동 보강본 최종 하네스 평가 중..."
        : `자동 보강본 ${round}차 하네스 평가 중...`,
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
// ?곹깭 ?낅뜲?댄듃 ?ы띁
// ============================================================

function updateState(
  state: PipelineState,
  patch: Partial<PipelineState>
): PipelineState {
  return { ...state, ...patch, updatedAt: new Date().toISOString() };
}

// ============================================================
// ?뚯씠?꾨씪???ㅽ뻾
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

  // ???뚯씠?꾨씪?몄씠 吏곸젒 topic??in-progress濡??ㅼ젙??寃쎌슦?먮쭔 catch?먯꽌 蹂듦뎄
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
    // ?? 0. ?좏뵿 ?좏깮 ?좏슚??寃????????????????????????????????
    const topicValidation = await validateTopicSelectionFromGitHub(request.topicId);
    if (!topicValidation.valid) {
      throw new Error(`?좏뵿 ?좏깮 ?ㅽ뙣: ${topicValidation.reason}`);
    }
    await assertSeriesPrerequisitesPublished(request.topicId);

    // ?? 1. ?꾨왂 ?섎┰ ??????????????????????????????????????????
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

    // strategy_plan artifact ???(best-effort ??GitHub ?ㅽ뙣?대룄 ?뚯씠?꾨씪??怨꾩냽)
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
      console.warn("[orchestrator] saveArtifact(strategy_plan) ?ㅽ뙣 (臾댁떆):", e instanceof Error ? e.message : e);
    });

    // ?? 2. material_change 媛먯? + ?뱀씤 ?湲????????????????????
    const originalTitle = (await loadTopicTitle(request.topicId)) ?? "";
    const mcResult = detectMaterialChange({
      original: { title: originalTitle },
      proposed: { title: strategy.title, keywords: strategy.keywords, rationale: strategy.rationale },
    });
    const materialChange = mcResult.isMaterial;

    // material_change 濡쒓렇
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

    // ?뱀씤 ?곹깭 ?꾩씠: draft_ready ??waiting_for_user_approval (best-effort ??in-memory 寃쎈줈媛 ?듭떖)
    await transitionApprovalState({
      pipelineId,
      to: "waiting_for_user_approval",
      reason: "승인 요청 발송",
    }).catch((e: unknown) => {
      console.warn("[orchestrator] transitionApprovalState(waiting) ?ㅽ뙣 (臾댁떆):", e instanceof Error ? e.message : e);
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

    // ?뱀씤 ?湲?(理쒕? 30遺?
    let timedOut = false;
    const approval = await Promise.race([
      waitForApproval(pipelineId, strategy),
      new Promise<never>((_, reject) =>
        setTimeout(() => { timedOut = true; reject(new Error("승인 대기 시간이 초과되었습니다. (30분)")); }, 30 * 60 * 1000)
      ),
    ]);

    // approval_ux 濡쒓렇
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
      // 嫄곗젅 ??topic ?곹깭媛 ?대? in-progress??寃쎌슦 draft濡?蹂듦뎄
      try {
        const statusAtReject = await loadTopicStatus(request.topicId);
        if (statusAtReject === "in-progress") {
          await updateTopicStatus(request.topicId, "draft");
        }
      } catch { /* 蹂듦뎄 ?ㅽ뙣??臾댁떆 */ }
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

    // ?뱀씤 ?곹깭 ?꾩씠: waiting_for_user_approval ??approved_pending_record_update
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

    // ?뱀씤 ?곹깭 ?꾩씠: approved_pending_record_update ??records_updated
    await transitionApprovalState({
      pipelineId,
      to: "records_updated",
      reason: "posting-list와 topic index 반영 완료",
    });

    // ?? 4.5. corpus summary 以鍮?+ pre-write gate ????????????
    emit(controller, makeEvent("progress", "writing", { message: "코퍼스 분석 중..." }));
    const corpusSummary = await getCorpusSummary({
      userId: request.userId,
      category: await loadTopicCategory(request.topicId),
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

    // corpus_retrieval 濡쒓렇
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
      targetCategory: await loadTopicCategory(request.topicId),
    });

    if (corpusSummary.staleWarnings.length > 0) {
      emit(controller, makeEvent("progress", "writing", {
        message: `오래된 예시 글 경고: ${corpusSummary.staleWarnings.join("; ")}`,
      }));
    }

    // pre-write gate 寃??(議곌굔 1-3)
    const { getArtifact: _getArtifact } = await import("./artifact-registry");
    const approvalArtifact = await _getArtifact<ApprovalRequestData>(pipelineId, "approval_request");
    const recordArtifact = await _getArtifact<RecordUpdateData>(pipelineId, "record_update");

    const preGateResult = runPreWriteGate({
      sourceReport: null as SourceReportData | null,
      approvalRequest: approvalArtifact?.data ?? null,
      recordUpdate: recordArtifact?.data ?? null,
    });
    // pre-write gate 濡쒓렇
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

    // ?? 5. 蹂몃Ц ?묒꽦 ??????????????????????????????????????????
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

    // posting-list wordCount ?낅뜲?댄듃
    await updatePostRecord(postRecord.postId, {
      status: "ready",
      wordCount: writerResult.wordCount,
      compositionSessionId: pipelineId,
    });

    // ?? 6. ?덉쭏 ?됯? ??????????????????????????????????????????
    state = updateState(state, { stage: "evaluating" });
    activePipelines.set(pipelineId, state);
    emit(controller, makeEvent("stage_change", "evaluating", {
      pipelineId,
      message: "Harness Evaluator가 초안을 평가합니다.",
    }));

    const revised = await evaluateAndMaybeReviseDraft({
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

    // post-audit gate 寃??(議곌굔 4)
    const postGateResult = runPostAuditGate({
      auditReport: { pass: evalResult.pass, aggregateScore: evalResult.aggregateScore },
    });

    // baseline 鍮꾧탳 (gate 寃곌낵? 臾닿??섍쾶 ??긽 ?섑뻾)
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

    // audit_report artifact ?????gate 寃곌낵/baseline delta ?ы븿 (??긽 ???
    await saveArtifact<AuditReportData>(pipelineId, "audit_report", {
      runId: evalResult.runId,
      scores: evalResult.scores,
      aggregateScore: evalResult.aggregateScore,
      reasoning: evalResult.reasoning,
      recommendations: evalResult.recommendations,
      pass: evalResult.pass,
      baselineDelta,
    });

    // post-audit gate 濡쒓렇
    await appendLog(pipelineId, {
      type: "gate_result",
      gate: "post-audit",
      passed: postGateResult.passed,
      blockedBy: postGateResult.blockedBy,
      reason: postGateResult.reason,
      evalScore: evalResult.aggregateScore,
    });

    const completionSupport = buildCompletionSupport(strategy, writerResult.title);
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
        naverLogicEvaluation,
        ...completionSupport,
      }));
      emit(controller, makeEvent("stage_change", "complete", {
        pipelineId,
        message: "본문 초안 저장 완료. 평가 점수는 개선 권고로 표시됩니다.",
      }));
      return;
    }

    // ?? POST-AUDIT GATE PASS ??理쒖쥌 ?곹깭 ?꾩씠 (李⑤떒 ????덉슜) ?
    emit(controller, makeEvent("progress", "evaluating", { message: "post-audit gate 통과" }));

    // candidate ?깅줉 (gate ?듦낵 ?쒖뿉留?
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

    // posting-list final update (gate ?듦낵 ?쒖뿉留?
    await updatePostRecord(postRecord.postId, {
      evalScore: evalResult.aggregateScore,
      status: "approved",
    });

    // artifact contract ???(gate ?듦낵 ?쒖뿉留?
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

    // ?뱀씤 ?곹깭 ?꾩씠: records_updated ??released (gate ?듦낵 ?쒖뿉留?
    await transitionApprovalState({
      pipelineId,
      to: "released",
      reason: "모든 gate 통과 및 배포 준비 완료",
    });

    // ?? 7. ?꾨즺 ???????????????????????????????????????????????
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
        naverLogicEvaluation,
        ...completionSupport,
      }));
    emit(controller, makeEvent("stage_change", "complete", {
      pipelineId,
      message: "파이프라인이 완료되었습니다.",
    }));
  } catch (err) {
    let message = err instanceof Error ? err.message : "알 수 없는 오류";

    // APIConnectionError: ?쒕쾭 濡쒓렇???곸꽭 ?뺣낫 湲곕줉 + ?ъ슜??硫붿떆吏 蹂닿컯
    if (err instanceof Error && err.constructor.name === "APIConnectionError") {
      const cause = (err as { cause?: unknown }).cause;
      const causeMsg = cause instanceof Error ? ` (원인: ${cause.message})` : "";
      console.error("[orchestrator] Anthropic ?곌껐 ?ㅻ쪟:", {
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

    // ?뚯씠?꾨씪???ㅽ뙣 ??topic??in-progress ?곹깭濡?stuck?섎뒗 寃?諛⑹? ??draft濡?蹂듦뎄
    // thisSetTopicInProgress ?뚮옒洹몃줈 ???뚯씠?꾨씪?몄씠 吏곸젒 ?ㅼ젙??寃쎌슦留?蹂듦뎄
    // (?ㅻⅨ ?뚯씠?꾨씪?몄씠 in-progress濡??ㅼ젙??寃쎌슦 ??뼱?곗? ?딆쓬)
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
// ?뱀씤 泥섎━
// ============================================================

/**
 * ?뱀씤 泥섎━ ??硫붾え由??숈씪 ?몄뒪?댁뒪) + GitHub(?ъ떆???ㅼ쨷 ?몄뒪?댁뒪) 蹂묓뻾
 * approve ?붾뱶?ъ씤?몄뿉???몄텧. ??긽 ?깃났 泥섎━.
 */
export async function handleApproval(approval: ApprovalRequest): Promise<boolean> {
  // 1. 硫붾え由?寃쎈줈 (?숈씪 ?몄뒪?댁뒪 ??利됱떆 諛섏쁺)
  const pending = pendingApprovals.get(approval.pipelineId);
  if (pending) {
    pending.resolve(approval);
    pendingApprovals.delete(approval.pipelineId);
  }

  // 2. GitHub 寃쎈줈 (?ъ떆???ㅼ쨷 ?몄뒪?댁뒪 fallback ???대쭅?쇰줈 ?섏떊)
  try {
    await resolveApprovalRecord(approval.pipelineId, approval.approved, approval.modifications);
  } catch {
    // best-effort ??GitHub 湲곕줉 ?ㅽ뙣?대룄 硫붾え由?寃쎈줈媛 ?덉쑝硫?怨꾩냽 吏꾪뻾
  }

  return true; // ??긽 ?깃났 諛섑솚 (404 ?쒓굅)
}

/**
 * ?뱀씤 ?湲???硫붾え由?利됱떆) + GitHub ?대쭅(3珥?媛꾧꺽) 蹂묐젹 ?ㅽ뻾
 * ??以?癒쇱? ?묐떟?섎뒗 履쎌쓣 ?ъ슜
 */
async function waitForApproval(
  pipelineId: string,
  strategy: StrategyPlanResult
): Promise<ApprovalRequest> {
  // GitHub???뱀씤 ?湲??덉퐫???앹꽦 (?쒕쾭 ?ъ떆??蹂듦뎄??
  await createApprovalRecord(pipelineId).catch(() => {});

  return new Promise((resolve, reject) => {
    // 硫붾え由?寃쎈줈 ?깅줉
    pendingApprovals.set(pipelineId, { resolve, strategy });

    // GitHub ?대쭅 (3珥?媛꾧꺽) ???ъ떆???ㅼ쨷 ?몄뒪?댁뒪 fallback
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
        // GitHub ?쇱떆???ㅻ쪟 臾댁떆
      }
    }, 3000);

    // ??꾩븘?????뺣━
    const originalResolve = resolve;
    pendingApprovals.set(pipelineId, {
      resolve: (approval) => {
        clearInterval(pollInterval);
        originalResolve(approval);
      },
      strategy,
    });

    // reject ???뺣━ (?몃? timeout Promise媛 reject?섎뒗 寃쎌슦)
    void reject; // suppress unused warning ??reject is handled by outer Promise.race
  });
}

// ============================================================
// ?뚯씠?꾨씪???곹깭 議고쉶
// ============================================================

export function getPipelineState(pipelineId: string): PipelineState | null {
  return activePipelines.get(pipelineId) ?? null;
}

// ============================================================
// GitHub ?곗씠???ы띁
// ============================================================

async function validateTopicSelectionFromGitHub(
  topicId: string
): Promise<{ valid: boolean; reason: string }> {
  try {
    const path = Paths.topicsIndex();
    if (!(await fileExists(path))) {
      return { valid: false, reason: "topics index ?뚯씪???놁뒿?덈떎." };
    }
    const { data: index } = await readJsonFile<TopicIndex>(path);
    const { validateTopicSelection } = await import("./completion-checker");
    return validateTopicSelection(topicId, index.topics);
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "?좏뵿 寃利??ㅽ뙣" };
  }
}

async function loadTopic(topicId: string): Promise<Topic | null> {
  try {
    const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
    return data.topics.find((t) => t.topicId === topicId) ?? null;
  } catch {
    return null;
  }
}

async function assertSeriesPrerequisitesPublished(topicId: string): Promise<void> {
  const topic = await loadTopic(topicId);
  if (!topic || topic.seriesRole !== "main" || !topic.seriesId) return;

  const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
  const prerequisites = topic.prerequisiteTopicIds?.length
    ? data.topics.filter((candidate) => topic.prerequisiteTopicIds?.includes(candidate.topicId))
    : data.topics.filter(
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
  try {
    const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
    return data.topics.find((t) => t.topicId === topicId)?.title ?? null;
  } catch {
    return null;
  }
}

async function loadTopicStatus(topicId: string): Promise<string | null> {
  try {
    const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
    return data.topics.find((t) => t.topicId === topicId)?.status ?? null;
  } catch {
    return null;
  }
}

async function loadTopicCategory(topicId: string): Promise<string | undefined> {
  try {
    const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
    return data.topics.find((t) => t.topicId === topicId)?.category;
  } catch {
    return undefined;
  }
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

// ?? SHA 異⑸룎 ?ъ떆???섑띁 ????????????????????????????????????????
// GitHub API??SHA 遺덉씪移???409/422瑜?諛섑솚?쒕떎.
// 500/503? ?쒕쾭 ?쇱떆 ?ㅻ쪟, 429??rate limit ??紐⑤몢 ?ъ떆?꾪븳??
// fn() ?대??먯꽌 理쒖떊 SHA瑜?留ㅻ쾲 ?덈줈 ?쎌쑝誘濡??⑥닚???ы샇異쒗븯硫??쒕떎.
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
        // jitter濡?thundering herd 諛⑹? (429??寃쎌슦 ??湲??湲?
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

// ?? ?좏뵿 ?곹깭 ?먯옄??in-progress ?ㅼ젙 ??????????????????????????
// validate ??write瑜???踰덉쓽 SHA ?몃옖??뀡 ?덉뿉???섑뻾.
// ?숈떆 ?뚯씠?꾨씪?몄씠 媛숈? ?좏뵿???묎렐?대룄 ?뺥솗???섎굹留?in-progress濡?吏꾩엯.
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
// 2?④퀎 ?뚯씠?꾨씪????Phase 1: ?꾨왂 ?섎┰
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
      throw new Error(`?좏뵿 ?좏깮 ?ㅽ뙣: ${topicValidation.reason}`);
    }
    await assertSeriesPrerequisitesPublished(topicId);

    // ?? 1. ?꾨왂 ?섎┰
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

    // strategy_plan artifact ???(best-effort)
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
      console.warn("[orchestrator] saveArtifact(strategy_plan) ?ㅽ뙣 (臾댁떆):", e instanceof Error ? e.message : e);
    });

    // ?? 2. material_change 媛먯?
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

    // ?뱀씤 ?붿껌 ?대깽??諛쒗뻾 (strategy ?꾩껜 ?ы븿 ??write phase?먯꽌 ?ъ슜)
    emit(controller, makeEvent("approval_required", "awaiting-approval", {
      pipelineId,
      previousTitle: originalTitle,
      proposedTitle: strategy.title,
      materialChange: mcResult.isMaterial,
      rationale: strategy.rationale,
      outline: strategy.outline.map((s) => s.heading),
      strategy, // write phase媛 ??媛믪쓣 諛쏆븘 POST body???ы븿
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
// 2?④퀎 ?뚯씠?꾨씪????Phase 2: 湲?곌린 + ?됯?
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
  gate.grant(); // ?대씪?댁뼵?몄뿉???대? ?뱀씤??
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

    // ?? 4.5. corpus + pre-write gate
    emit(controller, makeEvent("progress", "writing", { message: "코퍼스 분석 중..." }));
    const corpusSummary = await getCorpusSummary({
      userId,
      category: await loadTopicCategory(topicId),
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

    // ?? 5. 蹂몃Ц ?묒꽦
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

    // ?? 6. ?덉쭏 ?됯?
    state = updateState(state, { stage: "evaluating" });
    activePipelines.set(pipelineId, state);
    emit(controller, makeEvent("stage_change", "evaluating", {
      pipelineId,
      message: "Harness Evaluator가 초안을 평가합니다.",
    }));

    const revised = await evaluateAndMaybeReviseDraft({
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

    const completionSupport = buildCompletionSupport(effectiveStrategy, writerResult.title);
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
        naverLogicEvaluation,
        ...completionSupport,
      }));
      emit(controller, makeEvent("stage_change", "complete", {
        pipelineId,
        message: "본문 초안 저장 완료. 평가 점수는 개선 권고로 표시됩니다.",
      }));
      return;
    }

    // ?? 7. ?꾨즺
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

    // ?꾨즺 ??topic??draft濡?蹂듦뎄 ??湲紐⑸줉?먯꽌 ?ㅼ떆 蹂댁씠?꾨줉 (?ㅼ쓬 ?④퀎 ?묒뾽 ?꾪빐)
    try { await updateTopicStatus(topicId, "draft"); } catch { /* 臾댁떆 */ }

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
        naverLogicEvaluation,
        ...completionSupport,
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
