"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StageIndicator } from "@/components/pipeline/stage-indicator";
import { PipelineStream } from "@/components/pipeline/pipeline-stream";
import { ApprovalDialog } from "@/components/pipeline/approval-dialog";
import { PipelineStateInspector, applyEventToInspector } from "@/components/pipeline/state-inspector";
import { usePipelineStore } from "@/lib/store/pipeline-store";
import { reviewActualDraft, type DraftReviewIssue, type DraftReviewResult } from "@/lib/agents/draft-review";
import type { SSEEvent, ApprovalRequest, StrategyPlanResult, NaverLogicEvaluation } from "@/lib/agents/types";
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
  naverLogicEvaluation?: NaverLogicEvaluation;
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const planningTopics = topics.filter((topic) => topic.source !== "direct");
  const { remaining: availableTopics } = resolveRemainingTopics(planningTopics, posts);

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
    const uid = normalizeUserId(userId.trim());
    if (!uid) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    const timer = setTimeout(() => {
      setProfileLoading(true);
      setProfileError(null);
      fetch(`/api/github/profile?userId=${encodeURIComponent(uid)}`)
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
  }, [userId]);

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
    startWritePhase(currentApproval, uid);
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
        ? ` 남은 계획 글이 없어 다음 글목록 ${publishResult.autoGeneratedTopics}개를 자동 생성했습니다.`
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
            {recovering ? "복구 중" : "일괄 복구"}
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
            ×
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(390px,520px)_minmax(0,1fr)] gap-6 items-start">
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
                    <option value="">글 목록에서 주제를 선택하세요</option>
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
                    입력한 주제는 글 목록에 draft 주제로 등록한 뒤 글쓰기를 시작합니다.
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
        </section>

        <aside className="min-w-0 xl:sticky xl:top-8 space-y-6">
          {!events.length && !streamingBody && !result && !approval && (
            <div className="bg-white border border-dashed border-zinc-300 rounded-xl p-6 min-h-[24rem] flex flex-col justify-center">
              <p className="text-sm font-semibold text-zinc-700">본문 미리보기</p>
              <p className="text-sm text-zinc-500 mt-2 leading-6">
                글쓰기를 시작하면 생성되는 본문과 진행 로그가 이 영역에 표시됩니다.
              </p>
            </div>
          )}

          {(events.length > 0 || streamingBody) && (
            <PipelineStream events={events} streamingBody={streamingBody} />
          )}

          {approval && (
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
          )}

          {result && (
            <div className="space-y-4">
              <div className={`border rounded-xl p-5 ${result.pass ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                <p className={`font-semibold text-sm mb-1 ${result.pass ? "text-emerald-700" : "text-amber-700"}`}>
                  {result.pass ? "글쓰기 완료" : "초안 저장 완료 · 평가 점수 개선 필요"}
                </p>
                <p className="text-zinc-800 font-medium">{result.title}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {result.wordCount.toLocaleString()}자 · 평가 점수 {result.evalScore}점
                </p>
              </div>

              {result.naverLogicEvaluation && (
                <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-zinc-600 mb-1">네이버 로직 적용</p>
                      <p className="text-sm font-semibold text-zinc-900">{result.naverLogicEvaluation.label}</p>
                      <p className="text-xs text-zinc-500 mt-1">{result.naverLogicEvaluation.reason}</p>
                    </div>
                    <div className="shrink-0 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-right">
                      <p className="text-[11px] font-semibold text-blue-600">로직 완성도</p>
                      <p className="text-lg font-bold text-blue-700">{result.naverLogicEvaluation.completenessScore}점</p>
                    </div>
                  </div>
                  {result.naverLogicEvaluation.evidence.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-zinc-600 mb-1">반영 근거</p>
                      <ul className="space-y-1">
                        {result.naverLogicEvaluation.evidence.map((item, index) => (
                          <li key={`${item}-${index}`} className="text-sm text-zinc-700 flex gap-2">
                            <span className="text-zinc-400">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.naverLogicEvaluation.improvements.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-zinc-600 mb-1">보강 포인트</p>
                      <ul className="space-y-1">
                        {result.naverLogicEvaluation.improvements.map((item, index) => (
                          <li key={`${item}-${index}`} className="text-sm text-zinc-700 flex gap-2">
                            <span className="text-amber-500">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {result.recommendations.length > 0 && (
                <div className="bg-white border border-zinc-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-zinc-600 mb-2">개선 권고사항</p>
                  <ul className="space-y-1">
                    {result.recommendations.map((recommendation, index) => (
                      <li key={`${recommendation}-${index}`} className="text-sm text-zinc-700 flex gap-2">
                        <span className="text-zinc-400">•</span>
                        <span>{recommendation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.hashtags && result.hashtags.length > 0 && (
                <div className="bg-white border border-zinc-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-zinc-600 mb-2">권장 해시태그 10개</p>
                  <div className="flex flex-wrap gap-2">
                    {result.hashtags.map((tag) => (
                      <span key={tag} className="px-2.5 py-1 rounded-full bg-zinc-100 text-xs text-zinc-700">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result.imageFileNames && result.imageFileNames.length > 0 && (
                <div className="bg-white border border-zinc-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-zinc-600 mb-2">추천 이미지 파일명</p>
                  <ul className="space-y-1">
                    {result.imageFileNames.map((name) => (
                      <li key={name} className="font-mono text-xs text-zinc-700 bg-zinc-50 border border-zinc-100 rounded px-2 py-1">
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-600">실제 작성본 검토</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    OpenAI로 실제 발행 전 본문 전체를 검토한 뒤 오탈자, 제목 SEO, 네이버 블로그 가독성을 반영한 수정본을 작성합니다.
                  </p>
                </div>
                <div>
                  <label htmlFor="actual-title" className="sr-only">실제 발행 제목</label>
                  <input
                    id="actual-title"
                    value={reviewTitle}
                    onChange={(event) => {
                      setReviewTitle(event.target.value);
                      setReviewApplied(false);
                    }}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder="실제 발행 제목"
                  />
                </div>
                <div>
                  <label htmlFor="actual-body" className="sr-only">실제 작성 본문</label>
                  <textarea
                    id="actual-body"
                    value={reviewBody}
                    onChange={(event) => {
                      setReviewBody(event.target.value);
                      setReviewApplied(false);
                    }}
                    className="w-full min-h-40 border border-zinc-200 rounded-lg px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder="실제로 작성한 본문을 붙여 넣으면 OpenAI가 오탈자, SEO, 네이버 블로그 가독성을 검토하고 전체 수정본을 작성합니다."
                  />
                </div>
                <button
                  type="button"
                  onClick={runDraftReview}
                  disabled={reviewSaving || !reviewTitle.trim()}
                  className="w-full px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg disabled:opacity-40"
                >
                  {reviewSaving ? "OpenAI 수정본 작성 중" : "검토 후 수정본 작성"}
                </button>
                {reviewResult && (
                  <div className="border border-blue-100 bg-blue-50 rounded-lg p-3 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-blue-700">수정본</p>
                      <p className="text-xs text-blue-600 mt-1">
                        아래 수정본을 확인하고 필요한 부분을 직접 고친 뒤 저장본에 반영하세요.
                      </p>
                    </div>
                    {((reviewResult.changeDetails?.length ?? 0) > 0 || reviewResult.changes.length > 0 || reviewResult.seoNotes.length > 0 || reviewResult.naverLogicNotes.length > 0) && (
                      <div className="grid grid-cols-1 gap-2">
                        {(reviewResult.changeDetails?.length ?? 0) > 0 && (
                          <div className="bg-white/70 border border-blue-100 rounded-lg px-3 py-2">
                            <p className="text-xs font-semibold text-blue-700 mb-1">수정 전후 비교</p>
                            <div className="space-y-2">
                              {reviewResult.changeDetails.map((item, index) => (
                                <div key={`change-detail-${index}`} className="rounded-md border border-blue-50 bg-white px-2 py-2">
                                  <p className="text-[11px] font-semibold text-zinc-500">수정 전</p>
                                  <p className="text-xs text-zinc-600 whitespace-pre-wrap">{item.before}</p>
                                  <p className="text-[11px] font-semibold text-blue-600 mt-1">수정 후</p>
                                  <p className="text-xs text-zinc-800 whitespace-pre-wrap">{item.after}</p>
                                  <p className="text-[11px] text-zinc-500 mt-1">이유: {item.reason}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {reviewResult.changes.length > 0 && (
                          <div className="bg-white/70 border border-blue-100 rounded-lg px-3 py-2">
                            <p className="text-xs font-semibold text-blue-700 mb-1">수정된 내용</p>
                            <ul className="space-y-1">
                              {reviewResult.changes.map((item, index) => (
                                <li key={`change-${index}`} className="text-xs text-zinc-700">• {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {reviewResult.seoNotes.length > 0 && (
                          <div className="bg-white/70 border border-blue-100 rounded-lg px-3 py-2">
                            <p className="text-xs font-semibold text-blue-700 mb-1">SEO 검수</p>
                            <ul className="space-y-1">
                              {reviewResult.seoNotes.map((item, index) => (
                                <li key={`seo-${index}`} className="text-xs text-zinc-700">• {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {reviewResult.naverLogicNotes.length > 0 && (
                          <div className="bg-white/70 border border-blue-100 rounded-lg px-3 py-2">
                            <p className="text-xs font-semibold text-blue-700 mb-1">네이버 로직 검수</p>
                            <ul className="space-y-1">
                              {reviewResult.naverLogicNotes.map((item, index) => (
                                <li key={`naver-${index}`} className="text-xs text-zinc-700">• {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                    <input
                      value={reviewedTitle}
                      onChange={(event) => {
                        setReviewedTitle(event.target.value);
                        setReviewApplied(false);
                      }}
                      className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <textarea
                      value={reviewedBody}
                      onChange={(event) => {
                        setReviewedBody(event.target.value);
                        setReviewApplied(false);
                      }}
                      className="w-full min-h-64 border border-blue-200 rounded-lg px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <button
                      type="button"
                      onClick={applyReviewedDraft}
                      disabled={reviewSaving || !reviewedTitle.trim() || !reviewedBody.trim()}
                      className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40"
                    >
                      {reviewSaving ? "수정본 반영 중" : "수정본 저장본에 반영"}
                    </button>
                    {reviewApplied && (
                      <p className="text-xs text-emerald-600">수정본이 저장본에 반영됐습니다.</p>
                    )}
                  </div>
                )}
                <div className="border-t border-zinc-100 pt-3 space-y-2">
                  <p className="text-xs font-semibold text-zinc-600">발행 완료 후 인덱스 추가</p>
                  {!reviewApplied && (
                    <p className="text-xs text-amber-600">
                      먼저 검토 후 수정본을 작성하고, 수정본을 저장본에 반영해야 인덱스에 추가할 수 있습니다.
                    </p>
                  )}
                  <input
                    value={publishUrl}
                    onChange={(event) => {
                      setPublishUrl(event.target.value);
                      setPublishNotice(null);
                    }}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder="https://blog.naver.com/..."
                  />
                  <button
                    type="button"
                    onClick={publishToIndex}
                    disabled={publishingToIndex || !reviewApplied || !publishUrl.trim()}
                    className="w-full px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {publishingToIndex ? "인덱스 추가 중" : "검수 후 인덱스 목록에 추가"}
                  </button>
                  {publishNotice && (
                    <p className={`text-xs ${publishNotice.type === "ok" ? "text-emerald-600" : "text-red-500"}`}>
                      {publishNotice.msg}
                    </p>
                  )}
                </div>
                {reviewIssues.length > 0 && (
                  <div className="border border-zinc-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-zinc-600 mb-2">검토 결과</p>
                    {reviewResult?.checks && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                        {reviewResult.checks.map((check) => (
                          <div key={check.label} className="bg-zinc-50 border border-zinc-100 rounded px-2 py-1.5">
                            <p className={`text-xs font-semibold ${check.passed ? "text-emerald-600" : "text-amber-600"}`}>
                              {check.passed ? "통과" : "확인"} · {check.label}
                            </p>
                            <p className="text-[11px] text-zinc-500 mt-0.5">{check.detail}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <ul className="space-y-1">
                      {reviewIssues.map((issue, index) => (
                        <li key={`${issue.message}-${index}`} className="text-sm text-zinc-700 flex gap-2">
                          <span className={
                            issue.severity === "blocker"
                              ? "text-red-500"
                              : issue.severity === "warning"
                                ? "text-amber-500"
                                : "text-zinc-400"
                          }>
                            •
                          </span>
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
