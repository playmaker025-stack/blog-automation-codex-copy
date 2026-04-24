"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StageIndicator } from "@/components/pipeline/stage-indicator";
import { PipelineProgressLog } from "@/components/pipeline/progress-log";
import { PipelineWorkspacePanel } from "@/components/pipeline/workspace-panel";
import { PipelineReportPanel } from "@/components/pipeline/report-panel";
import { ApprovalDialog } from "@/components/pipeline/approval-dialog";
import { PipelineStateInspector, applyEventToInspector } from "@/components/pipeline/state-inspector";
import { usePipelineStore } from "@/lib/store/pipeline-store";
import { reviewActualDraft, type DraftReviewIssue, type DraftReviewResult } from "@/lib/agents/draft-review";
import type { SSEEvent, ApprovalRequest, StrategyPlanResult, NaverLogicEvaluation, SeoEvaluation, KeywordUsageReport } from "@/lib/agents/types";
import type { Topic, UserProfile, PostingRecord } from "@/lib/types/github-data";
import { resolveRemainingTopics } from "@/lib/skills/remaining-topic-resolver";
import { normalizeUserId } from "@/lib/utils/normalize";

interface ApprovalData {
  pipelineId: string;
  topicId: string;
  previousTitle: string;
  proposedTitle: string;
  rationale: string;
  outline: string[];
  strategy: StrategyPlanResult;
  modifications?: string;
}

interface ResultData {
  postId: string;
  title: string;
  wordCount: number;
  evalScore: number;
  pass: boolean;
  recommendations: string[];
  hashtags?: string[];
  imageFileNames?: string[];
  seoEvaluation?: SeoEvaluation;
  naverLogicEvaluation?: NaverLogicEvaluation;
}

type ContentTab = "draft" | "revision";

function keywordStatusTone(status: KeywordUsageReport["items"][number]["status"]): string {
  if (status === "적정") return "text-emerald-600";
  if (status === "과다") return "text-amber-600";
  return "text-blue-600";
}

function parseSseChunk(buffer: string, onEvent: (event: SSEEvent) => void): string {
  const lines = buffer.split("\n\n");
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    try {
      onEvent(JSON.parse(line.slice(6)) as SSEEvent);
    } catch {
      // Ignore malformed keepalive fragments.
    }
  }
  return rest;
}

function compactTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

const PIPELINE_SOFT_WARNING_SECONDS = 480;
const PIPELINE_TIMEOUT_SECONDS = 570;

export default function PipelinePage() {
  const userId = usePipelineStore((state) => state.userId);
  const topicMode = usePipelineStore((state) => state.topicMode);
  const selectedTopicId = usePipelineStore((state) => state.selectedTopicId);
  const directTitle = usePipelineStore((state) => state.directTitle);
  const autoApprove = usePipelineStore((state) => state.autoApprove);
  const stage = usePipelineStore((state) => state.stage);
  const events = usePipelineStore((state) => state.events);
  const streamingBody = usePipelineStore((state) => state.streamingBody);
  const result = usePipelineStore((state) => state.result);
  const inspector = usePipelineStore((state) => state.inspector);
  const runningTitle = usePipelineStore((state) => state.runningTitle);

  const setUserId = usePipelineStore((state) => state.setUserId);
  const setTopicMode = usePipelineStore((state) => state.setTopicMode);
  const setSelectedTopicId = usePipelineStore((state) => state.setSelectedTopicId);
  const setDirectTitle = usePipelineStore((state) => state.setDirectTitle);
  const setAutoApprove = usePipelineStore((state) => state.setAutoApprove);
  const setStage = usePipelineStore((state) => state.setStage);
  const appendEvent = usePipelineStore((state) => state.appendEvent);
  const setEvents = usePipelineStore((state) => state.setEvents);
  const appendStreamingToken = usePipelineStore((state) => state.appendStreamingToken);
  const setStreamingBody = usePipelineStore((state) => state.setStreamingBody);
  const setResult = usePipelineStore((state) => state.setResult);
  const setInspector = usePipelineStore((state) => state.setInspector);
  const setRunningTitle = usePipelineStore((state) => state.setRunningTitle);
  const resetRun = usePipelineStore((state) => state.resetRun);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [posts, setPosts] = useState<PostingRecord[]>([]);
  const [approval, setApproval] = useState<ApprovalData | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stuckCount, setStuckCount] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [preflightBlocked, setPreflightBlocked] = useState(false);
  const forcePreflightOverrideRef = useRef(false);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewIssues, setReviewIssues] = useState<DraftReviewIssue[]>([]);
  const [reviewResult, setReviewResult] = useState<DraftReviewResult | null>(null);
  const [reviewedTitle, setReviewedTitle] = useState("");
  const [reviewedBody, setReviewedBody] = useState("");
  const [reviewApplied, setReviewApplied] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [publishUrl, setPublishUrl] = useState("");
  const [publishingToIndex, setPublishingToIndex] = useState(false);
  const [publishNotice, setPublishNotice] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [contentTab, setContentTab] = useState<ContentTab>("draft");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const normalizedUserId = normalizeUserId(userId.trim());

  const planningTopics = topics.filter((topic) => topic.source !== "direct");
  const userScopedPlanningTopics = planningTopics.filter((topic) => {
    if (!normalizedUserId) return true;
    return normalizeUserId(topic.assignedUserId ?? "") === normalizedUserId;
  });
  const { remaining: availableTopics } = resolveRemainingTopics(userScopedPlanningTopics, posts);
  const progressEvents = events.filter(
    (event) => event.type === "stage_change" || event.type === "progress" || event.type === "error"
  );

  useEffect(() => {
    if (topicMode !== "list" || !selectedTopicId) return;
    if (!availableTopics.some((topic) => topic.topicId === selectedTopicId)) {
      setSelectedTopicId("");
    }
  }, [availableTopics, selectedTopicId, setSelectedTopicId, topicMode]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  const reloadTopics = useCallback(() => {
    const timestamp = Date.now();
    Promise.allSettled([
      fetch(`/api/github/topics?_t=${timestamp}`).then((res) => res.json()) as Promise<{ topics: Topic[] }>,
      fetch(`/api/github/posts?status=published&limit=1000&_t=${timestamp}`).then((res) => res.json()) as Promise<{ posts: PostingRecord[] }>,
      fetch(`/api/github/topics/recover-stuck?_t=${timestamp}`).then((res) => res.json()) as Promise<{ count: number }>,
    ]).then(([topicResult, postResult, stuckResult]) => {
      const topicData = topicResult.status === "fulfilled" ? topicResult.value : { topics: [] };
      const postData = postResult.status === "fulfilled" ? postResult.value : { posts: [] };
      const stuckData = stuckResult.status === "fulfilled" ? stuckResult.value : { count: 0 };
      setTopics((topicData.topics ?? []).filter((topic) => topic.status === "draft" && topic.source !== "direct"));
      setPosts(postData.posts ?? []);
      setStuckCount(stuckData.count ?? 0);
    });
  }, []);

  useEffect(() => {
    reloadTopics();
  }, [reloadTopics]);

  useEffect(() => {
    if (!normalizedUserId) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    const timer = setTimeout(() => {
      setProfileLoading(true);
      setProfileError(null);
      fetch(`/api/github/profile?userId=${encodeURIComponent(normalizedUserId)}`)
        .then(async (res) => {
          const json = await res.json() as { profile?: UserProfile; error?: string };
          if (res.ok) {
            setProfile(json.profile ?? null);
            return;
          }
          setProfile(null);
          setProfileError(json.error ?? "프로필 조회 실패");
        })
        .catch((error) => {
          setProfile(null);
          setProfileError(error instanceof Error ? error.message : "네트워크 오류");
        })
        .finally(() => setProfileLoading(false));
    }, 500);

    return () => clearTimeout(timer);
  }, [normalizedUserId]);

  const handleEvent = useCallback((event: SSEEvent) => {
    appendEvent(event);
    setInspector((prev) => applyEventToInspector(prev, event));

    if (event.type === "stage_change") {
      setStage(event.stage);
    }

    if (event.type === "token") {
      appendStreamingToken((event.data as { token?: string })?.token ?? "");
    }

    if (event.type === "approval_required") {
      const data = event.data as {
        pipelineId: string;
        previousTitle: string;
        proposedTitle: string;
        rationale: string;
        outline: string[];
        strategy: StrategyPlanResult;
        __topicId?: string;
      };
      setApproval({
        pipelineId: data.pipelineId,
        topicId: data.__topicId ?? "",
        previousTitle: data.previousTitle,
        proposedTitle: data.proposedTitle,
        rationale: data.rationale,
        outline: data.outline,
        strategy: data.strategy,
        modifications: "",
      });
    }

    if (event.type === "result") {
      const data = event.data as ResultData;
      setResult(data);
      setReviewTitle(data.title ?? "");
      setReviewBody("");
      setReviewIssues([]);
      setReviewResult(null);
      setReviewedTitle("");
      setReviewedBody("");
      setReviewApplied(false);
      setPublishUrl("");
      setPublishNotice(null);
      setContentTab("draft");
      setRunning(false);
      setRunningTitle(null);
      stopTimer();
      reloadTopics();
    }

    if (event.type === "error") {
      const message = (event.data as { message?: string })?.message ?? "파이프라인 오류가 발생했습니다.";
      const isPreflight = message.includes("Preflight check blocked writing");
      setPreflightBlocked(isPreflight);
      setPipelineError(
        isPreflight
          ? "이미 이전 작성목록에 있는 내용입니다. 비슷한 주제로 유사문서가 되지 않게 다른 각도로 작성할까요?"
          : message.includes("Request was aborted")
            ? "요청 시간이 길어져 중단되었습니다. 잠시 후 다시 실행해 주세요."
            : message
      );
      setStage("idle");
      setRunning(false);
      setRunningTitle(null);
      stopTimer();
      reloadTopics();
    }
  }, [
    appendEvent,
    appendStreamingToken,
    reloadTopics,
    setInspector,
    setResult,
    setRunningTitle,
    setStage,
    stopTimer,
  ]);

  const startWritePhase = useCallback((approvalData: ApprovalData, uid: string) => {
    fetch("/api/pipeline/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipelineId: approvalData.pipelineId,
        topicId: approvalData.topicId,
        userId: uid,
        strategy: approvalData.strategy,
        modifications: approvalData.modifications?.trim() || undefined,
        forcePreflightOverride: forcePreflightOverrideRef.current,
      }),
    })
      .then((res) => {
        if (!res.body) {
          setRunning(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const read = () => {
          reader.read()
            .then(({ done, value }) => {
              if (done) {
                setRunning(false);
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              buffer = parseSseChunk(buffer, handleEvent);
              read();
            })
            .catch(() => setRunning(false));
        };
        read();
      })
      .catch(() => setRunning(false));
  }, [handleEvent]);

  const autoApproveRef = useRef(autoApprove);
  useEffect(() => {
    autoApproveRef.current = autoApprove;
  }, [autoApprove]);

  useEffect(() => {
    if (!approval || !autoApproveRef.current) return;
    const uid = normalizeUserId(userId.trim());
    setApproval(null);
    setInspector((prev) => ({ ...prev, approval_received: true }));
    startWritePhase(approval, uid);
  }, [approval, setInspector, startWritePhase, userId]);

  const resolveTopicId = async (): Promise<string | null> => {
    if (topicMode === "list") return selectedTopicId || null;

    const title = directTitle.trim();
    if (!title) return null;

    const res = await fetch("/api/github/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        assignedUserId: normalizeUserId(userId.trim()),
        category: "direct-run",
        source: "direct",
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { topic: Topic };
    return json.topic.topicId;
  };

  const startPipeline = async (forcePreflightOverride = false) => {
    const uid = normalizeUserId(userId.trim());
    if (!uid) return;
    if (topicMode === "list" && !selectedTopicId) return;
    if (topicMode === "direct" && !directTitle.trim()) return;
    if (
      topicMode === "direct" &&
      posts.some((post) => post.status === "published" && compactTitle(post.title) === compactTitle(directTitle))
    ) {
      setPipelineError("이미 발행 인덱스에 있는 제목입니다. 글목록 또는 인덱스를 확인해 주세요.");
      return;
    }

    resetRun();
    setEvents([]);
    setStreamingBody("");
    setResult(null);
    setReviewTitle("");
    setReviewBody("");
    setReviewIssues([]);
    setReviewResult(null);
    setReviewedTitle("");
    setReviewedBody("");
    setReviewApplied(false);
    setPublishUrl("");
    setPublishNotice(null);
    setContentTab("draft");
    setStage("idle");
    setApproval(null);
    setPipelineError(null);
    setPreflightBlocked(false);
    setRunning(true);
    setElapsed(0);
    forcePreflightOverrideRef.current = forcePreflightOverride;

    const selectedTitle =
      topicMode === "list"
        ? topics.find((topic) => topic.topicId === selectedTopicId)?.title ?? selectedTopicId
        : directTitle.trim();

    setRunningTitle(selectedTitle);
    setInspector({
      ...usePipelineStore.getState().inspector,
      selected_topic: selectedTitle,
      remaining_topics_count: availableTopics.length,
    });

    const topicId = await resolveTopicId();
    if (!topicId) {
      setRunning(false);
      setPipelineError("주제를 준비하지 못했습니다.");
      return;
    }

    timerRef.current = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);

    fetch("/api/pipeline/strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, userId: uid, forcePreflightOverride }),
    })
      .then((res) => {
        if (!res.body) {
          setRunning(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let topicIdInjected = false;

        const read = () => {
          reader.read()
            .then(({ done, value }) => {
              if (done) {
                setApproval((current) => {
                  if (!current) {
                    setRunning(false);
                    stopTimer();
                  }
                  return current;
                });
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              buffer = parseSseChunk(buffer, (event) => {
                if (event.type === "approval_required" && !topicIdInjected) {
                  topicIdInjected = true;
                  (event.data as Record<string, unknown>).__topicId = topicId;
                }
                handleEvent(event);
              });
              read();
            })
            .catch(() => setRunning(false));
        };
        read();
      })
      .catch(() => setRunning(false));
  };

  const handleApprove = async (request: ApprovalRequest) => {
    const uid = normalizeUserId(userId.trim());
    if (!request.approved) {
      setApproval(null);
      setRunning(false);
      setRunningTitle(null);
      setStage("idle");
      stopTimer();
      return;
    }

    const currentApproval = approval;
    setApproval(null);
    setInspector((prev) => ({ ...prev, approval_received: true }));

    if (!currentApproval) return;
    startWritePhase(
      {
        ...currentApproval,
        modifications: request.modifications?.trim() || "",
      },
      uid
    );
  };

  const handleRecoverStuck = async () => {
    setRecovering(true);
    try {
      const res = await fetch("/api/github/topics/recover-stuck", { method: "POST" });
      if (res.ok) reloadTopics();
    } finally {
      setRecovering(false);
    }
  };

  const runDraftReview = async () => {
    if (!result) return;
    setReviewSaving(true);
    setPublishNotice(null);

    try {
      const res = await fetch("/api/pipeline/review-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalTitle: result.title,
          title: reviewTitle,
          body: reviewBody,
        }),
      });
      const review = await res.json() as DraftReviewResult & { error?: string };
      if (!res.ok) {
        setReviewIssues(review.issues ?? [{ severity: "blocker", message: review.error ?? "검토에 실패했습니다." }]);
        setReviewResult(review.issues ? review : null);
        return;
      }
      setReviewIssues(review.issues);
      setReviewResult(review);
      setReviewedTitle(review.revisedTitle);
      setReviewedBody(review.revisedBody);
      setReviewApplied(false);
      setContentTab("revision");
    } catch (error) {
      setReviewIssues([
        { severity: "blocker", message: error instanceof Error ? error.message : "OpenAI 검토 요청에 실패했습니다." },
      ]);
    } finally {
      setReviewSaving(false);
    }
  };

  const applyReviewedDraft = async () => {
    if (!result || !reviewResult) return;

    setReviewSaving(true);
    try {
      const res = await fetch("/api/github/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: result.postId,
          title: reviewedTitle.trim(),
          content: reviewedBody.trim(),
        }),
      });
      if (!res.ok) throw new Error("reviewed draft update failed");
      setResult({ ...result, title: reviewedTitle.trim() });
      setReviewTitle(reviewedTitle.trim());
      setReviewBody(reviewedBody.trim());
      setReviewApplied(true);
      setPublishNotice({ type: "ok", msg: "수정본을 저장본에 반영했습니다. 이제 네이버에 반영한 뒤 URL을 입력해 인덱스에 추가하세요." });
    } catch {
      setReviewIssues((prev) => [
        { severity: "blocker", message: "수정본을 저장본에 반영하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        ...prev,
      ]);
    } finally {
      setReviewSaving(false);
    }
  };

  const publishToIndex = async () => {
    if (!result) return;

    const url = publishUrl.trim();
    const finalTitle = (reviewedTitle || reviewTitle).trim();
    const finalBody = (reviewedBody || reviewBody).trim();
    if (!reviewApplied) {
      setPublishNotice({ type: "err", msg: "검토 수정본을 먼저 저장본에 반영해 주세요." });
      return;
    }
    const review = reviewActualDraft({
      originalTitle: result.title,
      title: finalTitle,
      body: finalBody,
    });
    setReviewIssues(review.issues);
    setReviewResult(review);
    setPublishNotice(null);

    if (!review.passed) {
      setPublishNotice({ type: "err", msg: "차단 항목을 먼저 수정한 뒤 인덱스에 추가해 주세요." });
      return;
    }

    if (!url || !/^https?:\/\/blog\.naver\.com\//i.test(url)) {
      setPublishNotice({ type: "err", msg: "발행 완료된 네이버 블로그 URL을 입력해 주세요." });
      return;
    }

    setPublishingToIndex(true);
    try {
      const res = await fetch("/api/github/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: result.postId,
          title: review.normalizedTitle,
          content: finalBody,
          status: "published",
          naverPostUrl: url,
          publishedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error("publish update failed");
      const publishResult = await res.json() as { autoGeneratedTopics?: number; learned?: boolean };
      setResult({ ...result, title: review.normalizedTitle, pass: true });
      setReviewTitle(review.normalizedTitle);
      setReviewBody(finalBody);
      setReviewApplied(true);
      const generatedMsg = publishResult.autoGeneratedTopics
        ? ` 현재 계획 글이 없어 다음 글목록 ${publishResult.autoGeneratedTopics}개를 자동 생성했습니다.`
        : "";
      const learningMsg = publishResult.learned ? " 발행 데이터도 학습 기록에 누적했습니다." : "";
      setPublishNotice({ type: "ok", msg: `발행 인덱스 목록에 추가했습니다.${generatedMsg}${learningMsg}` });
      reloadTopics();
    } catch {
      setPublishNotice({ type: "err", msg: "인덱스 추가에 실패했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      setPublishingToIndex(false);
    }
  };

  const canStart = (() => {
    if (!userId.trim() || running) return false;
    if (topicMode === "list") return !!selectedTopicId;
    return !!directTitle.trim();
  })();

  return (
    <div className="p-6 lg:p-8 max-w-none">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">글쓰기 실행</h1>
        <p className="text-zinc-500 mt-1 text-sm">전략 수립부터 본문 작성, 평가, 실제 작성본 검토까지 한 화면에서 진행합니다.</p>
      </div>

      {stuckCount > 0 && (
        <div className="mb-4 flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{stuckCount}개 주제</span>가 이전 실패로 진행 중 상태에 머물러 있습니다.
          </p>
          <button
            type="button"
            onClick={handleRecoverStuck}
            disabled={recovering}
            className="ml-4 px-3 py-1 bg-amber-600 text-white text-xs font-semibold rounded hover:bg-amber-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {recovering ? "복구 중" : "즉시 복구"}
          </button>
        </div>
      )}

      {pipelineError && (
        <div className="mb-4 flex items-start justify-between bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-700">글쓰기 실패</p>
            <p className="text-xs text-red-600 mt-0.5 break-words">{pipelineError}</p>
            {preflightBlocked && (
              <button
                type="button"
                onClick={() => startPipeline(true)}
                className="mt-3 px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
              >
                다른 각도로 작성
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="오류 닫기"
            onClick={() => setPipelineError(null)}
            className="ml-3 text-red-400 hover:text-red-600 shrink-0 text-lg leading-none"
          >
            횞
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)_minmax(320px,380px)] gap-6 items-start">
        <section className="min-w-0 space-y-6">
          <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-5">
            <div>
              <label htmlFor="pipeline-user" className="block text-xs font-semibold text-zinc-600 mb-1">사용자 선택</label>
              <div className="flex items-center gap-3">
                <input
                  id="pipeline-user"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  placeholder="사용자 ID 입력"
                  disabled={running}
                  className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
                {profileLoading && <span className="text-xs text-zinc-400">확인 중</span>}
                {!profileLoading && profile && (
                  <span className="text-xs text-emerald-600 font-medium">{profile.displayName}</span>
                )}
                {!profileLoading && userId.trim() && !profile && profileError && (
                  <span className="text-xs text-red-500" title={profileError}>오류: {profileError}</span>
                )}
              </div>
            </div>

            <div>
              <p className="block text-xs font-semibold text-zinc-600 mb-1">블로그</p>
              {profile?.naverBlogUrl ? (
                <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-500">네이버 블로그</span>
                  <a
                    href={profile.naverBlogUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline truncate"
                  >
                    {profile.naverBlogUrl}
                  </a>
                </div>
              ) : (
                <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-400">
                  사용자 ID를 입력하면 블로그 정보가 표시됩니다.
                </div>
              )}
            </div>

            <div>
              <p className="block text-xs font-semibold text-zinc-600 mb-2">주제 선택 방식</p>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setTopicMode("list")}
                  disabled={running}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors disabled:opacity-50 ${
                    topicMode === "list"
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  글 목록에서 선택
                </button>
                <button
                  type="button"
                  onClick={() => setTopicMode("direct")}
                  disabled={running}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors disabled:opacity-50 ${
                    topicMode === "direct"
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  직접 주제 입력
                </button>
              </div>

              {topicMode === "list" ? (
                <div>
                  <label htmlFor="pipeline-topic" className="sr-only">글 목록에서 주제 선택</label>
                  <select
                    id="pipeline-topic"
                    value={selectedTopicId}
                    onChange={(event) => setSelectedTopicId(event.target.value)}
                    disabled={running}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="">글 목록에서 주제를 선택해 주세요.</option>
                    {availableTopics.map((topic) => (
                      <option key={topic.topicId} value={topic.topicId}>
                        {topic.title}
                      </option>
                    ))}
                  </select>
                  {availableTopics.length === 0 && (
                    <p className="text-xs text-zinc-400 mt-1.5">
                      {userId.trim()
                        ? `'${userId.trim()}' 사용자에게 배정된 주제가 없습니다.`
                        : "글 목록이 비어 있습니다. 먼저 주제를 등록해 주세요."}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label htmlFor="pipeline-direct-title" className="sr-only">직접 주제 입력</label>
                  <input
                    id="pipeline-direct-title"
                    value={directTitle}
                    onChange={(event) => setDirectTitle(event.target.value)}
                    placeholder="예: 부평 전자담배 입문 기기 추천"
                    disabled={running}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <p className="text-xs text-zinc-400 mt-1.5">
                    입력한 주제는 글 목록의 draft 주제로 등록되고 바로 글쓰기를 시작합니다.
                  </p>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(event) => setAutoApprove(event.target.checked)}
                disabled={running}
                className="rounded"
              />
              <span>자동 승인 모드 <span className="text-zinc-400">테스트용으로 전략 확인 없이 이어서 작성합니다.</span></span>
            </label>

            <button
              type="button"
              onClick={() => startPipeline()}
              disabled={!canStart}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {running ? "글쓰기 진행 중" : "글쓰기 시작"}
            </button>
          </div>

          {running && (
            <div className={`rounded-xl p-4 flex items-center justify-between ${elapsed > PIPELINE_SOFT_WARNING_SECONDS ? "bg-red-50 border border-red-200" : "bg-blue-50 border border-blue-200"}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                <span className={`text-sm font-medium truncate ${elapsed > PIPELINE_SOFT_WARNING_SECONDS ? "text-red-700" : "text-blue-700"}`}>
                  {runningTitle ?? "글쓰기 진행 중"}
                </span>
              </div>
              <div className="ml-4 shrink-0 text-right">
                <span className={`text-lg font-mono font-bold ${elapsed > PIPELINE_SOFT_WARNING_SECONDS ? "text-red-600" : "text-blue-600"}`}>
                  {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
                </span>
                <span className={`text-xs ml-1 ${elapsed > PIPELINE_SOFT_WARNING_SECONDS ? "text-red-400" : "text-blue-400"}`}>
                  / {Math.floor(PIPELINE_TIMEOUT_SECONDS / 60)}:{String(PIPELINE_TIMEOUT_SECONDS % 60).padStart(2, "0")}
                </span>
              </div>
            </div>
          )}

          {stage !== "idle" && (
            <div className="bg-white border border-zinc-200 rounded-xl p-5 overflow-x-auto">
              <StageIndicator currentStage={stage} />
            </div>
          )}
          <PipelineStateInspector state={inspector} />
          <PipelineProgressLog events={progressEvents} />
        </section>

        <PipelineWorkspacePanel
          contentTab={contentTab}
          setContentTab={setContentTab}
          runningTitle={runningTitle}
          events={events}
          streamingBody={streamingBody}
          result={result ? { title: result.title, wordCount: result.wordCount } : null}
          reviewTitle={reviewTitle}
          reviewBody={reviewBody}
          reviewedTitle={reviewedTitle}
          reviewedBody={reviewedBody}
          reviewSaving={reviewSaving}
          reviewApplied={reviewApplied}
          reviewResult={reviewResult}
          onReviewTitleChange={(value) => {
            setReviewTitle(value);
            setReviewApplied(false);
          }}
          onReviewBodyChange={(value) => {
            setReviewBody(value);
            setReviewApplied(false);
          }}
          onReviewedTitleChange={(value) => {
            setReviewedTitle(value);
            setReviewApplied(false);
          }}
          onReviewedBodyChange={(value) => {
            setReviewedBody(value);
            setReviewApplied(false);
          }}
          onRunDraftReview={runDraftReview}
          onApplyReviewedDraft={applyReviewedDraft}
        />

        <PipelineReportPanel
          approval={approval ? (
            <ApprovalDialog
              pipelineId={approval.pipelineId}
              previousTitle={approval.previousTitle}
              proposedTitle={approval.proposedTitle}
              rationale={approval.rationale}
              outline={approval.outline}
              naverLogic={approval.strategy.naverLogic}
              onApprove={handleApprove}
              onReject={() => handleApprove({ pipelineId: approval.pipelineId, approved: false })}
            />
          ) : null}
          result={result}
          reviewResult={reviewResult}
          reviewIssues={reviewIssues}
          reviewApplied={reviewApplied}
          publishUrl={publishUrl}
          publishingToIndex={publishingToIndex}
          publishNotice={publishNotice}
          onPublishUrlChange={(value) => {
            setPublishUrl(value);
            setPublishNotice(null);
          }}
          onPublishToIndex={publishToIndex}
          keywordStatusTone={keywordStatusTone}
        />
      </div>
    </div>
  );
}
