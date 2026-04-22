"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StageIndicator } from "@/components/pipeline/stage-indicator";
import { PipelineStream } from "@/components/pipeline/pipeline-stream";
import { ApprovalDialog } from "@/components/pipeline/approval-dialog";
import { PipelineStateInspector, applyEventToInspector } from "@/components/pipeline/state-inspector";
import { usePipelineStore } from "@/lib/store/pipeline-store";
import { reviewActualDraft, type DraftReviewIssue } from "@/lib/agents/draft-review";
import type { SSEEvent, ApprovalRequest, StrategyPlanResult } from "@/lib/agents/types";
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
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewIssues, setReviewIssues] = useState<DraftReviewIssue[]>([]);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [publishUrl, setPublishUrl] = useState("");
  const [publishingToIndex, setPublishingToIndex] = useState(false);
  const [publishNotice, setPublishNotice] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentUid = normalizeUserId(userId);
  const userTopics = currentUid
    ? topics.filter((topic) => normalizeUserId(topic.assignedUserId ?? "") === currentUid)
    : topics;
  const { remaining: availableTopics } = resolveRemainingTopics(userTopics, posts);

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
      fetch(`/api/github/posts?limit=1000&_t=${timestamp}`).then((res) => res.json()) as Promise<{ posts: PostingRecord[] }>,
      fetch(`/api/github/topics/recover-stuck?_t=${timestamp}`).then((res) => res.json()) as Promise<{ count: number }>,
    ]).then(([topicResult, postResult, stuckResult]) => {
      const topicData = topicResult.status === "fulfilled" ? topicResult.value : { topics: [] };
      const postData = postResult.status === "fulfilled" ? postResult.value : { posts: [] };
      const stuckData = stuckResult.status === "fulfilled" ? stuckResult.value : { count: 0 };
      setTopics((topicData.topics ?? []).filter((topic) => topic.status === "draft"));
      setPosts(postData.posts ?? []);
      setStuckCount(stuckData.count ?? 0);
    });
  }, []);

  useEffect(() => {
    reloadTopics();
  }, [reloadTopics]);

  useEffect(() => {
    const uid = userId.trim();
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
      setPublishUrl("");
      setPublishNotice(null);
      setRunning(false);
      setRunningTitle(null);
      stopTimer();
      reloadTopics();
    }

    if (event.type === "error") {
      const message = (event.data as { message?: string })?.message ?? "파이프라인 오류가 발생했습니다.";
      setPipelineError(message);
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
    const uid = userId.trim();
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
      body: JSON.stringify({ title, assignedUserId: userId.trim() }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { topic: Topic };
    return json.topic.topicId;
  };

  const startPipeline = async () => {
    const uid = userId.trim();
    if (!uid) return;
    if (topicMode === "list" && !selectedTopicId) return;
    if (topicMode === "direct" && !directTitle.trim()) return;

    resetRun();
    setEvents([]);
    setStreamingBody("");
    setResult(null);
    setReviewTitle("");
    setReviewBody("");
    setReviewIssues([]);
    setPublishUrl("");
    setPublishNotice(null);
    setStage("idle");
    setApproval(null);
    setPipelineError(null);
    setRunning(true);
    setElapsed(0);

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
      body: JSON.stringify({ topicId, userId: uid }),
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
    const uid = userId.trim();
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

    const review = reviewActualDraft({
      originalTitle: result.title,
      title: reviewTitle,
      body: reviewBody,
    });
    setReviewIssues(review.issues);

    if (!review.normalizedTitle || review.normalizedTitle === result.title) return;

    setReviewSaving(true);
    try {
      const res = await fetch("/api/github/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: result.postId, title: review.normalizedTitle }),
      });
      if (!res.ok) throw new Error("title update failed");
      setResult({ ...result, title: review.normalizedTitle });
      setReviewTitle(review.normalizedTitle);
    } catch {
      setReviewIssues((prev) => [
        { severity: "blocker", message: "변경한 제목을 글 목록에 반영하지 못했습니다." },
        ...prev,
      ]);
    } finally {
      setReviewSaving(false);
    }
  };

  const publishToIndex = async () => {
    if (!result) return;

    const url = publishUrl.trim();
    const review = reviewActualDraft({
      originalTitle: result.title,
      title: reviewTitle,
      body: reviewBody,
    });
    setReviewIssues(review.issues);
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
          status: "published",
          naverPostUrl: url,
          publishedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error("publish update failed");
      setResult({ ...result, title: review.normalizedTitle, pass: true });
      setReviewTitle(review.normalizedTitle);
      setPublishNotice({ type: "ok", msg: "발행 인덱스 목록에 추가했습니다." });
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
              onClick={startPipeline}
              disabled={!canStart}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {running ? "글쓰기 진행 중" : "글쓰기 시작"}
            </button>
          </div>

          {running && (
            <div className={`rounded-xl p-4 flex items-center justify-between ${elapsed > 240 ? "bg-red-50 border border-red-200" : "bg-blue-50 border border-blue-200"}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                <span className={`text-sm font-medium truncate ${elapsed > 240 ? "text-red-700" : "text-blue-700"}`}>
                  {runningTitle ?? "글쓰기 진행 중"}
                </span>
              </div>
              <div className="ml-4 shrink-0 text-right">
                <span className={`text-lg font-mono font-bold ${elapsed > 240 ? "text-red-600" : "text-blue-600"}`}>
                  {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
                </span>
                <span className={`text-xs ml-1 ${elapsed > 240 ? "text-red-400" : "text-blue-400"}`}>/ 5:00</span>
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
                    사용자가 확정한 제목은 글 목록에 반영하고, 본문은 위험 표현과 오탈자성 문제를 점검합니다.
                  </p>
                </div>
                <div>
                  <label htmlFor="actual-title" className="sr-only">실제 발행 제목</label>
                  <input
                    id="actual-title"
                    value={reviewTitle}
                    onChange={(event) => setReviewTitle(event.target.value)}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder="실제 발행 제목"
                  />
                </div>
                <div>
                  <label htmlFor="actual-body" className="sr-only">실제 작성 본문</label>
                  <textarea
                    id="actual-body"
                    value={reviewBody}
                    onChange={(event) => setReviewBody(event.target.value)}
                    className="w-full min-h-40 border border-zinc-200 rounded-lg px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder="실제로 작성한 본문을 붙여 넣으면 위험 요소와 수정 권고를 확인합니다."
                  />
                </div>
                <button
                  type="button"
                  onClick={runDraftReview}
                  disabled={reviewSaving || !reviewTitle.trim()}
                  className="w-full px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg disabled:opacity-40"
                >
                  {reviewSaving ? "제목 반영 중" : "검토하고 제목 반영"}
                </button>
                <div className="border-t border-zinc-100 pt-3 space-y-2">
                  <p className="text-xs font-semibold text-zinc-600">발행 완료 후 인덱스 추가</p>
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
                    disabled={publishingToIndex || !reviewTitle.trim() || !publishUrl.trim()}
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
