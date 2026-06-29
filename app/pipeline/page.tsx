"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StageIndicator } from "@/components/pipeline/stage-indicator";
import { PipelineProgressLog } from "@/components/pipeline/progress-log";
import { PipelineWorkspacePanel } from "@/components/pipeline/workspace-panel";
import { PipelineReportPanel } from "@/components/pipeline/report-panel";
import { ApprovalDialog } from "@/components/pipeline/approval-dialog";
import { PipelineStateInspector, applyEventToInspector } from "@/components/pipeline/state-inspector";
import { usePipelineStore } from "@/lib/store/pipeline-store";
import { reviewActualDraft, type DraftReviewIssue, type DraftReviewResult } from "@/lib/agents/draft-review";
import type { SSEEvent, ApprovalRequest, StrategyPlanResult, NaverLogicEvaluation, SeoEvaluation, KeywordUsageReport, FinalDraftCheck, DuplicateMode } from "@/lib/agents/types";
import { evaluateSeoCompleteness } from "@/lib/agents/seo-metrics";
import { canApproveFinalDraft } from "@/lib/agents/final-draft-check";
import { buildConfirmedSeoKeywords } from "@/lib/agents/confirmed-seo-keywords";
import { parseKeywordList } from "@/lib/agents/direct-intent-utils";
import type { Topic, UserProfile, PostingRecord } from "@/lib/types/github-data";
import { resolveRemainingTopics } from "@/lib/skills/remaining-topic-resolver";
import type { PipelineUserDraft } from "@/lib/pipeline-user-draft";
import { hasMeaningfulPipelineDraft } from "@/lib/pipeline-user-draft";
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

interface ApprovalModificationFeedback {
  status: "submitting" | "applied" | "error";
  text: string;
  error?: string;
  updatedAt: string;
}

interface DraftRewriteContext {
  topicId: string;
  strategy: StrategyPlanResult;
  modifications?: string;
}

interface PipelineDraftSyncState {
  status: "idle" | "loading" | "saving" | "saved" | "error";
  message: string | null;
  updatedAt: string | null;
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
  finalDraftCheck?: FinalDraftCheck;
}

interface DraftSessionRecord {
  sessionId: string;
  userId: string;
  topicId: string;
  topicTitle: string;
  pipelineId?: string;
  strategy?: StrategyPlanResult;
  streamingBody: string;
  result: ResultData;
  status: "draft_generated";
  createdAt: string;
  updatedAt: string;
}

type ContentTab = "draft" | "revision";

interface DraftVersionSnapshot {
  label: string;
  body: string;
}

interface DraftVersionSeoReport extends DraftVersionSnapshot {
  seoEvaluation: SeoEvaluation;
  keywordReport: KeywordUsageReport;
}

const AUTO_DRAFT_MARKER_2 = "\n\n---\n\n[2차 초안]\n";
const AUTO_DRAFT_MARKER_3 = "\n\n---\n\n[3차 초안]\n";

function parseDraftVersionSnapshots(streamingBody: string): DraftVersionSnapshot[] {
  const normalized = streamingBody.replace(/\r\n/g, "\n");
  const secondMarkerIndex = normalized.indexOf(AUTO_DRAFT_MARKER_2);
  const thirdMarkerIndex = normalized.indexOf(AUTO_DRAFT_MARKER_3);

  const firstBody = (
    secondMarkerIndex >= 0 ? normalized.slice(0, secondMarkerIndex) : normalized
  ).trim();
  const secondBody = secondMarkerIndex >= 0
    ? normalized.slice(
      secondMarkerIndex + AUTO_DRAFT_MARKER_2.length,
      thirdMarkerIndex >= 0 ? thirdMarkerIndex : undefined
    ).trim()
    : "";
  const thirdBody = thirdMarkerIndex >= 0
    ? normalized.slice(thirdMarkerIndex + AUTO_DRAFT_MARKER_3.length).trim()
    : "";

  return [
    { label: "\u0031\uCC28 \uCD08\uC548", body: firstBody },
    { label: "\u0032\uCC28 \uCD08\uC548", body: secondBody },
    { label: "\u0033\uCC28 \uCD08\uC548", body: thirdBody },
  ];
}

function buildDraftCompletionMessage(streamingBody: string): string | null {
  const completedCount = parseDraftVersionSnapshots(streamingBody).filter((version) => version.body).length;

  if (completedCount <= 0) return null;
  if (completedCount === 1) {
    return "\u0031\uCC28 \uCD08\uC548 \uC791\uC131\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uCD94\uAC00 \uBCF4\uAC15\uC774 \uAF2D \uD544\uC694\uD558\uC9C0 \uC54A\uB2E4\uBA74 \uBC14\uB85C \uC218\uC815\uBCF8 \uB2E8\uACC4\uB85C \uB118\uC5B4\uAC00\uBA74 \uB429\uB2C8\uB2E4.";
  }
  if (completedCount === 2) {
    return "\u0031\uCC28 \uCD08\uC548\uACFC \uC790\uB3D9 \uBCF4\uAC15\uBCF8 2\uCC28\uAC00 \uC900\uBE44\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB450 \uBC84\uC804\uC744 \uBE44\uAD50\uD574 \uB354 \uB098\uC740 \uCABD\uC744 \uACE8\uB77C \uC218\uC815\uBCF8\uC73C\uB85C \uB118\uAE30\uBA74 \uB429\uB2C8\uB2E4.";
  }
  return "\u0031\uCC28 \uCD08\uC548\uBD80\uD130 \uC790\uB3D9 \uBCF4\uAC15\uBCF8 3\uCC28\uAE4C\uC9C0 \uBAA8\uB450 \uC900\uBE44\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uAC00\uC7A5 \uB098\uC740 \uBC84\uC804\uC744 \uACE8\uB77C \uC218\uC815\uBCF8 \uD0ED\uC5D0\uC11C \uC2E4\uC81C \uBC1C\uD589 \uBCF8\uBB38\uC744 \uC815\uB9AC\uD574 \uC8FC\uC138\uC694.";
}

function pickLatestDraftSnapshot(streamingBody: string): DraftVersionSnapshot | null {
  const versions = parseDraftVersionSnapshots(streamingBody).filter((version) => version.body.trim());
  return versions.at(-1) ?? null;
}

function looksBrokenKorean(value: string | null | undefined): boolean {
  if (!value) return false;
  return /[\uFFFD]|\u00C3|\u00C2|[\u00EC\u00ED\u00EF][\S\s]{0,3}[\u00EB\u00EA]|[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/.test(value);
}

function formatPipelineError(message: string): string {
  if (/AI 요청량 제한/i.test(message)) {
    return message.includes("반복")
      ? "AI 요청량 제한이 반복되고 있습니다. 잠시 후 다시 시도하거나 초안 보강 단계를 줄여 주세요."
      : message;
  }
  const retryMatch = message.match(/Please try again in\s+([\d.]+)s/i);
  if (/rate limit reached|rate_limit_exceeded|tokens per min|TPM/i.test(message)) {
    if (retryMatch) {
      return `현재 AI 요청량 제한에 걸렸습니다. 약 ${Math.max(1, Math.ceil(Number(retryMatch[1])))}초 후 자동 재시도를 시도했지만, 아직 한도가 충분히 회복되지 않았습니다. 잠시 후 다시 실행해 주세요.`;
    }
    return "현재 AI 요청량 제한에 걸렸습니다. 잠시 후 다시 실행해 주세요.";
  }
  if (message.includes("data/posting-list/index.json") && message.includes("파일이 아닙니다")) {
    return `${message}\n\n로컬 확인 결과 codex-copy/main의 해당 경로는 정상 파일입니다. 같은 오류가 계속 뜨면 Railway Variables가 다른 데이터 저장소나 브랜치를 보고 있을 가능성이 큽니다.`;
  }
  if (message.includes("data/posting-list/index.json")) {
    return '"data/posting-list/index.json" 파일을 읽는 중 문제가 발생했습니다. GitHub 데이터 저장소에서 해당 경로가 정상 JSON 파일인지 확인해 주세요.';
  }
  if (looksBrokenKorean(message)) {
    return "글쓰기 중 오류가 발생했습니다. 잠시 후 다시 실행하거나 데이터 저장소 상태를 확인해 주세요.";
  }
  return message;
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

function buildDirectTopicTitle(mainKeyword: string, subKeyword: string): string {
  return [mainKeyword.trim(), subKeyword.trim()].filter(Boolean).join(" ");
}

function looksCorruptedText(value: string | null | undefined): boolean {
  if (!value) return false;
  return /[\uFFFD]|\u00C3|\u00C2|[\u00C0-\u00FF]{2,}/u.test(value) && !/[가-힣]/u.test(value);
}

function compareTopicsForPipeline(left: Topic, right: Topic): number {
  const leftSeries = left.seriesId ?? "";
  const rightSeries = right.seriesId ?? "";

  if (leftSeries && rightSeries) {
    if (leftSeries === rightSeries) {
      return (left.sequenceOrder ?? 999) - (right.sequenceOrder ?? 999);
    }
    const keywordCompare = (left.targetMainKeyword ?? leftSeries).localeCompare(
      right.targetMainKeyword ?? rightSeries,
      "ko"
    );
    if (keywordCompare !== 0) return keywordCompare;
  }

  if (leftSeries && !rightSeries) return -1;
  if (!leftSeries && rightSeries) return 1;

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function formatPipelineTopicLabel(topic: Topic): string {
  if (!topic.seriesId || !topic.seriesRole) {
    return topic.title;
  }

  const roleLabel = topic.seriesRole === "main" ? "\uBA54\uC778" : `\uC120\uD589 ${topic.sequenceOrder ?? 0}`;
  const keywordLabel = topic.targetMainKeyword?.trim() ? ` | ${topic.targetMainKeyword.trim()}` : "";

  return `[${roleLabel}${keywordLabel}] ${topic.title}`;
}

function topicIsPublishedById(topic: Topic, posts: PostingRecord[]): boolean {
  return posts.some((post) => post.status === "published" && post.topicId === topic.topicId);
}

const PIPELINE_SOFT_WARNING_SECONDS = 480;
const PIPELINE_TIMEOUT_SECONDS = 570;

export default function PipelinePage() {
  const userId = usePipelineStore((state) => state.userId);
  const topicMode = usePipelineStore((state) => state.topicMode);
  const selectedTopicId = usePipelineStore((state) => state.selectedTopicId);
  const directTopicTitle = usePipelineStore((state) => state.directTopicTitle);
  const directMainKeyword = usePipelineStore((state) => state.directMainKeyword);
  const directSubKeyword = usePipelineStore((state) => state.directSubKeyword);
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
  const setDirectTopicTitle = usePipelineStore((state) => state.setDirectTopicTitle);
  const setDirectMainKeyword = usePipelineStore((state) => state.setDirectMainKeyword);
  const setDirectSubKeyword = usePipelineStore((state) => state.setDirectSubKeyword);
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
  const [approvalModificationFeedback, setApprovalModificationFeedback] = useState<ApprovalModificationFeedback | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stuckCount, setStuckCount] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [preflightBlocked, setPreflightBlocked] = useState(false);
  const [publishedDuplicateBlocked, setPublishedDuplicateBlocked] = useState(false);
  const [strategyDuplicateBlocked, setStrategyDuplicateBlocked] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [titleCandidates, setTitleCandidates] = useState<string[]>([]);
  const forcePreflightOverrideRef = useRef(false);
  const duplicateModeOverrideRef = useRef<DuplicateMode | undefined>(undefined);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [revisionRequest] = useState("");
  const [reviewIssues, setReviewIssues] = useState<DraftReviewIssue[]>([]);
  const [reviewResult, setReviewResult] = useState<DraftReviewResult | null>(null);
  const [reviewedTitle, setReviewedTitle] = useState("");
  const [reviewedBody, setReviewedBody] = useState("");
  const [_reviewApplied, setReviewApplied] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishTitle, setPublishTitle] = useState("");
  const [publishBody, setPublishBody] = useState("");
  const [draftRewriteContext, setDraftRewriteContext] = useState<DraftRewriteContext | null>(null);
  const [publishUrl, setPublishUrl] = useState("");
  const [publishingToIndex, setPublishingToIndex] = useState(false);
  const [publishNotice, setPublishNotice] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [publishCompletionMessage, setPublishCompletionMessage] = useState<string | null>(null);
  const [draftCompletionMessage, setDraftCompletionMessage] = useState<string | null>(null);
  const [draftSessions, setDraftSessions] = useState<DraftSessionRecord[]>([]);
  const [draftSessionNotice, setDraftSessionNotice] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [draftSessionSaving, setDraftSessionSaving] = useState(false);
  const [draftSessionLoading, setDraftSessionLoading] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [contentTab, setContentTab] = useState<ContentTab>("draft");
  const [draftSync, setDraftSync] = useState<PipelineDraftSyncState>({
    status: "idle",
    message: null,
    updatedAt: null,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const strategyAbortRef = useRef<AbortController | null>(null);
  const writeAbortRef = useRef<AbortController | null>(null);
  const forceManualApprovalRef = useRef(false);
  const streamingBodyRef = useRef("");
  const draftLoadReadyRef = useRef(false);
  const lastSavedDraftRef = useRef("");
  const normalizedUserId = normalizeUserId(userId.trim());

  const planningTopics = topics.filter((topic) => topic.source !== "direct");
  const userScopedPlanningTopics = planningTopics.filter((topic) => {
    if (!normalizedUserId) return true;
    return normalizeUserId(topic.assignedUserId ?? "") === normalizedUserId;
  });
  const { remaining: availableTopics } = resolveRemainingTopics(userScopedPlanningTopics, posts);
  const seriesTopicsHiddenByTitleMatch = userScopedPlanningTopics.filter(
    (topic) =>
      topic.seriesId &&
      topic.status === "draft" &&
      !availableTopics.some((candidate) => candidate.topicId === topic.topicId) &&
      !topicIsPublishedById(topic, posts)
  );
  const pipelineSelectableTopics = useMemo(() => {
    const merged = [...availableTopics];
    for (const topic of seriesTopicsHiddenByTitleMatch) {
      if (!merged.some((candidate) => candidate.topicId === topic.topicId)) {
        merged.push(topic);
      }
    }
    return merged;
  }, [availableTopics, seriesTopicsHiddenByTitleMatch]);
  const orderedAvailableTopics = useMemo(
    () => [...pipelineSelectableTopics].sort(compareTopicsForPipeline),
    [pipelineSelectableTopics]
  );
  const progressEvents = events.filter(
    (event) => event.type === "stage_change" || event.type === "progress" || event.type === "error"
  );
  const selectedTopic = selectedTopicId
    ? topics.find((topic) => topic.topicId === selectedTopicId) ?? null
    : null;
  const selectedDraftSessions = selectedTopicId
    ? draftSessions.filter((session) => session.topicId === selectedTopicId)
    : [];
  const confirmedSeoKeywords = useMemo(
    () =>
      buildConfirmedSeoKeywords({
        keywordContract: draftRewriteContext?.strategy?.keywordContract,
        directInput:
          topicMode === "direct"
            ? {
                mainKeyword: directMainKeyword,
                subKeywords: parseKeywordList(directSubKeyword),
              }
            : undefined,
        selectedPostingTopic: selectedTopic
          ? {
              title: selectedTopic.title,
              targetKeyword: selectedTopic.targetKeyword,
              targetMainKeyword: selectedTopic.targetMainKeyword,
              subKeywords: selectedTopic.subKeywords,
            }
          : undefined,
        topicMetadata: {
          targetKeyword: draftRewriteContext?.strategy?.keywordContract?.mainKeyword,
          targetMainKeyword: draftRewriteContext?.strategy?.targetMainKeyword,
          subKeywords: draftRewriteContext?.strategy?.keywordContract?.subKeywords,
        },
      }),
    [directMainKeyword, directSubKeyword, draftRewriteContext?.strategy, selectedTopic, topicMode]
  );
  const stage1EmptyMessage = useMemo(() => {
    if (confirmedSeoKeywords.mainKeyword || confirmedSeoKeywords.subKeywords.length > 0) return null;
    if (topicMode === "direct" && !directMainKeyword.trim()) {
      return "메인 키워드가 입력되지 않았습니다.";
    }
    if (topicMode === "list" && selectedTopic) {
      const postingListWarning = confirmedSeoKeywords.rejectedCandidates.find(
        (candidate) => candidate.reason === "이 글 목록 항목에 타깃 키워드가 없습니다."
      );
      if (postingListWarning) return postingListWarning.reason;
    }
    return "표시 가능한 SEO 키워드가 없습니다.";
  }, [confirmedSeoKeywords, directMainKeyword, selectedTopic, topicMode]);
  const draftVersionReports = useMemo<Array<DraftVersionSeoReport | null>>(() => {
    const strategy = draftRewriteContext?.strategy;
    if (!strategy || !streamingBody.trim()) return [null, null, null];

    return parseDraftVersionSnapshots(streamingBody)
      .map((snapshot) => {
        if (!snapshot.body.trim()) return null;

        const seoEvaluation = evaluateSeoCompleteness({
          title: strategy.title,
          body: snapshot.body,
          keywords: strategy.keywords,
          targetSearchCombinations: strategy.targetSearchCombinations,
          seriesRole: strategy.seriesRole,
          targetMainKeyword: strategy.targetMainKeyword,
          keywordContract: strategy.keywordContract,
          articlePlan: strategy.articlePlan,
          confirmedSeoKeywords,
        });

        return {
          ...snapshot,
          seoEvaluation,
          keywordReport: seoEvaluation.keywordReport,
        };
      });
  }, [confirmedSeoKeywords, draftRewriteContext?.strategy, streamingBody]);
  const latestDraftSnapshot = useMemo(() => pickLatestDraftSnapshot(streamingBody), [streamingBody]);
  const profileDisplayName = !profile?.displayName || looksCorruptedText(profile.displayName)
    ? normalizedUserId || "\uC0AC\uC6A9\uC790 \uC5F0\uACB0\uB428"
    : profile.displayName;

  useEffect(() => {
    if (topicMode !== "list" || !selectedTopicId) return;
    if (!orderedAvailableTopics.some((topic) => topic.topicId === selectedTopicId)) {
      setSelectedTopicId("");
    }
  }, [orderedAvailableTopics, selectedTopicId, setSelectedTopicId, topicMode]);

  useEffect(() => {
    setPublishedDuplicateBlocked(false);
  }, [directMainKeyword, directSubKeyword, topicMode, userId]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const applyPipelineDraft = useCallback((draft: PipelineUserDraft | null) => {
    if (!draft) return;

    setTopicMode(draft.topicMode);
    setSelectedTopicId(draft.selectedTopicId);
    setDirectTopicTitle(draft.directTopicTitle);
    setDirectMainKeyword(draft.directMainKeyword);
    setDirectSubKeyword(draft.directSubKeyword);
    setAutoApprove(draft.autoApprove);
  }, [
    setAutoApprove,
    setDirectMainKeyword,
    setDirectSubKeyword,
    setDirectTopicTitle,
    setSelectedTopicId,
    setTopicMode,
  ]);

  useEffect(() => {
    return () => {
      stopTimer();
      strategyAbortRef.current?.abort();
      writeAbortRef.current?.abort();
    };
  }, [stopTimer]);

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
          setProfileError(json.error ?? "\uD504\uB85C\uD544 \uC870\uD68C \uC2E4\uD328");
        })
        .catch((error) => {
          setProfile(null);
          setProfileError(error instanceof Error ? error.message : "\uB124\uD2B8\uC6CC\uD06C \uC624\uB958");
        })
        .finally(() => setProfileLoading(false));
    }, 500);

    return () => clearTimeout(timer);
  }, [normalizedUserId]);

  useEffect(() => {
    draftLoadReadyRef.current = false;
    lastSavedDraftRef.current = "";

    if (!normalizedUserId) {
      setDraftSync({ status: "idle", message: null, updatedAt: null });
      return;
    }

    const controller = new AbortController();
    setDraftSync({ status: "loading", message: "임시저장 불러오는 중", updatedAt: null });

    const timer = setTimeout(() => {
      fetch(`/api/pipeline/draft?userId=${encodeURIComponent(normalizedUserId)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const json = await res.json() as {
            draft?: PipelineUserDraft | null;
            error?: string;
            userId?: string;
          };
          if (!res.ok) {
            throw new Error(json.error ?? "임시저장 불러오기에 실패했습니다.");
          }

          if (json.userId && json.userId !== normalizedUserId) return;

          applyPipelineDraft(json.draft ?? null);
          const serialized = json.draft
            ? JSON.stringify({
                userId: json.draft.userId,
                topicMode: json.draft.topicMode,
                selectedTopicId: json.draft.selectedTopicId,
                directTopicTitle: json.draft.directTopicTitle,
                directMainKeyword: json.draft.directMainKeyword,
                directSubKeyword: json.draft.directSubKeyword,
                autoApprove: json.draft.autoApprove,
              })
            : "";
          lastSavedDraftRef.current = serialized;
          draftLoadReadyRef.current = true;
          setDraftSync(
            json.draft
              ? {
                  status: "saved",
                  message: "사용자별 임시저장을 불러왔습니다.",
                  updatedAt: json.draft.updatedAt,
                }
              : {
                  status: "idle",
                  message: "저장된 임시입력이 없습니다.",
                  updatedAt: null,
                }
          );
        })
        .catch((error) => {
          if ((error as Error).name === "AbortError") return;
          draftLoadReadyRef.current = true;
          setDraftSync({
            status: "error",
            message: error instanceof Error ? error.message : "임시저장 불러오기에 실패했습니다.",
            updatedAt: null,
          });
        });
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [applyPipelineDraft, normalizedUserId]);

  useEffect(() => {
    if (!normalizedUserId || !draftLoadReadyRef.current) return;

    const draftInput = {
      userId: normalizedUserId,
      topicMode,
      selectedTopicId,
      directTopicTitle,
      directMainKeyword,
      directSubKeyword,
      autoApprove,
    } as const;

    if (!hasMeaningfulPipelineDraft(draftInput) && !lastSavedDraftRef.current) return;

    const timer = setTimeout(() => {
      const payload = {
        ...draftInput,
        userId: normalizedUserId,
      };
      const serialized = JSON.stringify(payload);
      if (serialized === lastSavedDraftRef.current) return;

      setDraftSync((prev) => ({
        status: "saving",
        message: "사용자별 임시저장 저장 중",
        updatedAt: prev.updatedAt,
      }));

      fetch("/api/pipeline/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: serialized,
      })
        .then(async (res) => {
          const json = await res.json() as { draft?: PipelineUserDraft; error?: string };
          if (!res.ok || !json.draft) {
            throw new Error(json.error ?? "임시저장 저장에 실패했습니다.");
          }

          lastSavedDraftRef.current = serialized;
          setDraftSync({
            status: "saved",
            message: "사용자별 임시저장이 저장되었습니다.",
            updatedAt: json.draft.updatedAt,
          });
        })
        .catch((error) => {
          setDraftSync({
            status: "error",
            message: error instanceof Error ? error.message : "임시저장 저장에 실패했습니다.",
            updatedAt: null,
          });
        });
    }, 900);

    return () => clearTimeout(timer);
  }, [
    autoApprove,
    directMainKeyword,
    directSubKeyword,
    directTopicTitle,
    normalizedUserId,
    selectedTopicId,
    topicMode,
  ]);

  const reloadDraftSessions = useCallback(async () => {
    if (!normalizedUserId) {
      setDraftSessions([]);
      return;
    }

    setDraftSessionLoading(true);
    try {
      const res = await fetch(`/api/pipeline/draft-session?userId=${encodeURIComponent(normalizedUserId)}`, { cache: "no-store" });
      if (!res.ok) {
        setDraftSessions([]);
        return;
      }
      const json = await res.json() as { sessions?: DraftSessionRecord[] };
      setDraftSessions(Array.isArray(json.sessions) ? json.sessions : []);
    } catch {
      setDraftSessions([]);
    } finally {
      setDraftSessionLoading(false);
    }
  }, [normalizedUserId]);

  useEffect(() => {
    reloadDraftSessions();
  }, [reloadDraftSessions]);

  const handleEvent = useCallback((event: SSEEvent) => {
    appendEvent(event);
    setInspector((prev) => applyEventToInspector(prev, event));

    if (event.type === "stage_change") {
      setStage(event.stage);
    }

    if (event.type === "token") {
      const token = (event.data as { token?: string })?.token ?? "";
      streamingBodyRef.current += token;
      appendStreamingToken(token);
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
      setApprovalModificationFeedback(null);
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
      setPublishCompletionMessage(null);
      setDraftCompletionMessage(buildDraftCompletionMessage(streamingBodyRef.current));
      setReviewModalOpen(false);
      setPublishModalOpen(false);
      setContentTab("draft");
      setRunning(false);
      setRunningTitle(null);
      stopTimer();
      reloadTopics();
    }

    if (event.type === "error") {
      const message = (event.data as { message?: string })?.message ?? "\uD30C\uC774\uD504\uB77C\uC778 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.";
      const isPreflight = message.includes("Preflight check blocked writing");
      const isPublishedTopicBlock = message.includes("\uC774\uBBF8 \uBC1C\uD589\uB41C \uD1A0\uD53D\uC785\uB2C8\uB2E4");
      const isStrategyDuplicateBlock =
        message.includes("전략 계약서가 불완전") && message.includes("중복 위험");
      setPreflightBlocked(isPreflight);
      setPublishedDuplicateBlocked(isPublishedTopicBlock);
      setStrategyDuplicateBlocked(isStrategyDuplicateBlock);
      setPipelineError(
        isStrategyDuplicateBlock
          ? "기존 글과의 중복 위험이 높아 writer 실행이 차단되었습니다. 다른 각도로 다시 설계하거나, 사용자가 의도한 중복 작성이면 무시하고 작성할 수 있습니다."
          : isPreflight
          ? "\uC774\uBBF8 \uC774\uC804 \uC791\uC131\uBAA9\uB85D\uC5D0 \uC788\uB294 \uB0B4\uC6A9\uC785\uB2C8\uB2E4. \uBE44\uC2B7\uD55C \uC8FC\uC81C\uB85C \uC720\uC0AC\uBB38\uC11C\uAC00 \uB418\uC9C0 \uC54A\uAC8C \uB2E4\uB978 \uAC01\uB3C4\uB85C \uC791\uC131\uD560\uAE4C\uC694?"
          : isPublishedTopicBlock
            ? "\uC774\uBBF8 \uBC1C\uD589\uB41C \uD1A0\uD53D\uC785\uB2C8\uB2E4. \uADF8\uB798\uB3C4 \uAC19\uC740 \uC81C\uBAA9/\uD1A0\uD53D\uC73C\uB85C \uB2E4\uC2DC \uBC1C\uD589\uD558\uB824\uBA74 \uACC4\uC18D \uC9C4\uD589\uC744 \uB20C\uB7EC \uC8FC\uC138\uC694."
          : message.includes("Request was aborted")
            ? "\uC694\uCCAD \uC2DC\uAC04\uC774 \uAE38\uC5B4\uC838 \uC911\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2E4\uD589\uD574 \uC8FC\uC138\uC694."
            : formatPipelineError(message)
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
    writeAbortRef.current?.abort();
    const abortController = new AbortController();
    writeAbortRef.current = abortController;

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
        duplicateModeOverride: duplicateModeOverrideRef.current,
      }),
      signal: abortController.signal,
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
                if (writeAbortRef.current === abortController) {
                  writeAbortRef.current = null;
                }
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              buffer = parseSseChunk(buffer, handleEvent);
              read();
            })
            .catch((error) => {
              if ((error as Error).name === "AbortError") return;
              setRunning(false);
            });
        };
        read();
      })
      .catch((error) => {
        if ((error as Error).name === "AbortError") return;
        setRunning(false);
      })
      .finally(() => {
        if (writeAbortRef.current === abortController) {
          writeAbortRef.current = null;
        }
      });
  }, [handleEvent]);

  const [isReplanning, setIsReplanning] = useState(false);

  const autoApproveRef = useRef(autoApprove);
  useEffect(() => {
    autoApproveRef.current = autoApprove;
  }, [autoApprove]);

  useEffect(() => {
    if (!approval || !autoApproveRef.current || forceManualApprovalRef.current) return;
    const uid = normalizeUserId(userId.trim());
    setApproval(null);
    setInspector((prev) => ({ ...prev, approval_received: true }));
    setDraftRewriteContext({
      topicId: approval.topicId,
      strategy: approval.strategy,
      modifications: approval.modifications,
    });
    startWritePhase(approval, uid);
  }, [approval, setInspector, startWritePhase, userId]);

  const generateTitle = async () => {
    const mainKeyword = directMainKeyword.trim();
    if (!mainKeyword || isGeneratingTitle) return;
    setIsGeneratingTitle(true);
    setTitleCandidates([]);
    try {
      const res = await fetch("/api/pipeline/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mainKeyword,
          subKeywords: parseKeywordList(directSubKeyword),
          userId: normalizeUserId(userId.trim()),
        }),
      });
      const json = (await res.json()) as { titles?: string[]; error?: string };
      if (!res.ok || !json.titles?.length) {
        throw new Error(json.error ?? "제목 생성 실패");
      }
      setTitleCandidates(json.titles);
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : "제목 생성 중 오류가 발생했습니다.");
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const resolveTopicId = async (): Promise<string | null> => {
    if (topicMode === "list") return selectedTopicId || null;

    const mainKeyword = directMainKeyword.trim();
    const subKeywords = parseKeywordList(directSubKeyword);
    const subKeyword = subKeywords[0] ?? "";
    const title = directTopicTitle.trim() || buildDirectTopicTitle(mainKeyword, subKeyword);
    if (!mainKeyword || !title) return null;

    const res = await fetch("/api/github/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: subKeyword
          ? `메인키워드: ${mainKeyword} / 서브 키워드: ${subKeywords.join(", ")}`
          : `메인키워드: ${mainKeyword}`,
        tags: [mainKeyword, ...subKeywords].filter(Boolean),
        targetKeyword: mainKeyword,
        targetMainKeyword: mainKeyword,
        subKeywords,
        assignedUserId: normalizeUserId(userId.trim()),
        category: "direct-run",
        source: "direct",
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { topic: Topic };
    return json.topic.topicId;
  };

  const startPipeline = async (
    forcePreflightOverride = false,
    forcePublishedDuplicateOverride = false,
    duplicateModeOverride?: DuplicateMode
  ) => {
    const uid = normalizeUserId(userId.trim());
    const directComposedTitle = directTopicTitle.trim() || buildDirectTopicTitle(directMainKeyword, directSubKeyword);
    if (!uid) return;
    if (topicMode === "list" && !selectedTopicId) return;
    if (topicMode === "direct" && !directMainKeyword.trim()) return;
    const selectedTitle = topicMode === "list"
      ? selectedTopic?.title?.trim() ?? ""
      : directComposedTitle;
    const hasPublishedDuplicate = posts.some((post) => {
      if (post.status !== "published") return false;
      if (topicMode === "list" && selectedTopic && post.topicId === selectedTopic.topicId) return true;
      return compactTitle(post.title) === compactTitle(selectedTitle);
    });
    if (
      !forcePublishedDuplicateOverride &&
      selectedTitle &&
      hasPublishedDuplicate
    ) {
      setPublishedDuplicateBlocked(true);
      setPreflightBlocked(false);
      setPipelineError("이미 발행 인덱스에 같은 제목이 있습니다. 같은 제목으로도 다시 발행하려면 아래에서 계속 진행을 눌러 주세요.");
      return;
    }

    resetRun();
    setEvents([]);
    setStreamingBody("");
    streamingBodyRef.current = "";
    setResult(null);
    setDraftRewriteContext(null);
    setReviewTitle("");
    setReviewBody("");
    setReviewIssues([]);
    setReviewResult(null);
    setReviewedTitle("");
    setReviewedBody("");
    setReviewApplied(false);
    setPublishUrl("");
    setPublishTitle("");
    setPublishBody("");
    setPublishNotice(null);
    setPublishCompletionMessage(null);
    setDraftCompletionMessage(null);
    setReviewModalOpen(false);
    setPublishModalOpen(false);
    setContentTab("draft");
    setStage("idle");
    setApproval(null);
    setApprovalModificationFeedback(null);
    setPipelineError(null);
    setPreflightBlocked(false);
    setPublishedDuplicateBlocked(false);
    setStrategyDuplicateBlocked(false);
    setRunning(true);
    setElapsed(0);
    forcePreflightOverrideRef.current = forcePreflightOverride;
    duplicateModeOverrideRef.current = duplicateModeOverride;
    forceManualApprovalRef.current = forcePreflightOverride || forcePublishedDuplicateOverride;

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

    strategyAbortRef.current?.abort();
    const abortController = new AbortController();
    strategyAbortRef.current = abortController;

    fetch("/api/pipeline/strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, userId: uid, forcePreflightOverride, duplicateModeOverride }),
      signal: abortController.signal,
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
            .catch((error) => {
              if ((error as Error).name === "AbortError") return;
              setRunning(false);
            });
        };
        read();
      })
      .catch((error) => {
        if ((error as Error).name === "AbortError") return;
        setRunning(false);
      })
      .finally(() => {
        if (strategyAbortRef.current === abortController) {
          strategyAbortRef.current = null;
        }
      });
  };

  const stopPipeline = useCallback(() => {
    strategyAbortRef.current?.abort();
    writeAbortRef.current?.abort();
    strategyAbortRef.current = null;
    writeAbortRef.current = null;
    stopTimer();
    setRunning(false);
    setElapsed(0);
    setApproval(null);
    setApprovalModificationFeedback(null);
    setRunningTitle(null);
    setStage("idle");
    forceManualApprovalRef.current = false;
    appendEvent({
      type: "progress",
      stage: "idle",
      data: { message: "사용자가 글쓰기 진행을 중단했습니다." },
      timestamp: new Date().toISOString(),
    });
  }, [appendEvent, setRunningTitle, setStage, stopTimer]);

  const saveCurrentDraftSession = useCallback(async () => {
    const uid = normalizeUserId(userId.trim());
    const topicId = draftRewriteContext?.topicId || selectedTopicId;
    const topicTitle = selectedTopic?.title || runningTitle || result?.title || directTopicTitle || directMainKeyword;
    if (!uid || !topicId || !topicTitle || !result || !streamingBody.trim()) {
      setDraftSessionNotice({ type: "err", msg: "저장할 초안이 아직 없습니다. 초안 생성 완료 후 저장할 수 있습니다." });
      return;
    }

    setDraftSessionSaving(true);
    setDraftSessionNotice(null);
    try {
      const res = await fetch("/api/pipeline/draft-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: uid,
          topicId,
          topicTitle,
          pipelineId: draftRewriteContext?.strategy ? approval?.pipelineId : undefined,
          strategy: draftRewriteContext?.strategy,
          streamingBody,
          result,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error ?? "임시저장에 실패했습니다.");
      }
      setDraftSessionNotice({ type: "ok", msg: "현재 초안 작업을 임시저장했습니다." });
      reloadDraftSessions();
    } catch (error) {
      setDraftSessionNotice({
        type: "err",
        msg: error instanceof Error ? error.message : "임시저장에 실패했습니다.",
      });
    } finally {
      setDraftSessionSaving(false);
    }
  }, [
    approval?.pipelineId,
    directMainKeyword,
    directTopicTitle,
    draftRewriteContext,
    reloadDraftSessions,
    result,
    runningTitle,
    selectedTopic?.title,
    selectedTopicId,
    streamingBody,
    userId,
  ]);

  const loadDraftSession = useCallback((session: DraftSessionRecord) => {
    setResult(session.result);
    setStreamingBody(session.streamingBody);
    streamingBodyRef.current = session.streamingBody;
    setDraftRewriteContext(
      session.strategy
        ? {
            topicId: session.topicId,
            strategy: session.strategy,
          }
        : null
    );
    setReviewTitle(session.result.title ?? "");
    setReviewBody("");
    setReviewIssues([]);
    setReviewResult(null);
    setReviewedTitle("");
    setReviewedBody("");
    setReviewApplied(false);
    setPublishUrl("");
    setPublishNotice(null);
    setPublishCompletionMessage(null);
    setDraftCompletionMessage(buildDraftCompletionMessage(session.streamingBody));
    setContentTab("draft");
    setPipelineError(null);
    setDraftSessionNotice({ type: "ok", msg: "임시저장된 초안을 불러왔습니다." });
  }, [setResult, setStreamingBody]);

  const deleteDraftSession = useCallback(async (sessionId: string) => {
    const uid = normalizeUserId(userId.trim());
    if (!uid) return;
    setDeletingSessionId(sessionId);
    try {
      await fetch(`/api/pipeline/draft-session?userId=${encodeURIComponent(uid)}&sessionId=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      await reloadDraftSessions();
    } finally {
      setDeletingSessionId(null);
    }
  }, [userId, reloadDraftSessions]);

  const handleApprove = async (request: ApprovalRequest) => {
    const uid = normalizeUserId(userId.trim());
    if (!request.approved) {
      setApproval(null);
      setApprovalModificationFeedback(null);
      setRunning(false);
      setRunningTitle(null);
      setStage("idle");
      forceManualApprovalRef.current = false;
      stopTimer();
      return;
    }

    const currentApproval = approval;
    setApproval(null);
    setInspector((prev) => ({ ...prev, approval_received: true }));
    forceManualApprovalRef.current = false;

    if (!currentApproval) return;
    const approvalPayload = {
      ...currentApproval,
      modifications: request.modifications?.trim() || "",
    };
    setDraftRewriteContext({
      topicId: approvalPayload.topicId,
      strategy: approvalPayload.strategy,
      modifications: approvalPayload.modifications,
    });
    startWritePhase(
      approvalPayload,
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

  const requestDraftReview = async (payload: {
    originalTitle?: string;
    title: string;
    body: string;
  }) => {
    setReviewSaving(true);
    setPublishNotice(null);

    try {
      const res = await fetch("/api/pipeline/review-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalTitle: payload.originalTitle,
          title: payload.title,
          body: payload.body,
          revisionRequest,
          keywordContract: draftRewriteContext?.strategy.keywordContract,
          confirmedSeoKeywords,
        }),
      });
      const review = await res.json() as DraftReviewResult & { error?: string };
      if (!res.ok) {
        setReviewIssues(review.issues ?? [{ severity: "blocker", message: review.error ?? "검토에 실패했습니다." }]);
        setReviewResult(review.issues ? review : null);
        return;
      }
      setReviewTitle(payload.title);
      setReviewBody(payload.body);
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

  const openReviewModal = useCallback(() => {
    setReviewTitle("");
    setReviewBody("");
    setReviewModalOpen(true);
  }, []);

  const fillReviewModalFromLatestDraft = useCallback(() => {
    const baseTitle = reviewedTitle.trim() || reviewTitle.trim() || result?.title?.trim() || "";
    const baseBody = reviewedBody.trim() || reviewBody.trim() || latestDraftSnapshot?.body?.trim() || "";
    setReviewTitle(baseTitle);
    setReviewBody(baseBody);
  }, [latestDraftSnapshot?.body, result?.title, reviewBody, reviewTitle, reviewedBody, reviewedTitle]);

  const submitReviewModal = async () => {
    if (!result || !reviewTitle.trim() || !reviewBody.trim()) return;
    setReviewModalOpen(false);
    await requestDraftReview({
      originalTitle: result.title,
      title: reviewTitle,
      body: reviewBody,
    });
  };

  const openPublishModal = useCallback(() => {
    const baseTitle = reviewedTitle.trim() || reviewResult?.revisedTitle?.trim() || reviewTitle.trim() || result?.title?.trim() || "";
    const baseBody =
      reviewedBody.trim() ||
      reviewResult?.revisedBody?.trim() ||
      reviewBody.trim() ||
      latestDraftSnapshot?.body?.trim() ||
      "";
    setPublishTitle(baseTitle);
    setPublishBody(baseBody);
    setPublishModalOpen(true);
  }, [latestDraftSnapshot?.body, result?.title, reviewBody, reviewResult?.revisedBody, reviewResult?.revisedTitle, reviewTitle, reviewedBody, reviewedTitle]);

  const publishToIndex = async () => {
    if (!result) return;

    const url = publishUrl.trim();
    const finalTitle = publishTitle.trim();
    const finalBody = publishBody.trim();
    if (!result.postId) {
      setPublishNotice({ type: "err", msg: "발행 대상 글 정보를 찾지 못했습니다. 다시 글쓰기를 실행해 주세요." });
      return;
    }
    if (!finalTitle || !finalBody) {
      setPublishNotice({ type: "err", msg: "최종 발행 제목과 본문을 먼저 입력해 주세요." });
      return;
    }
    const review = reviewActualDraft({
      originalTitle: result.title,
      title: finalTitle,
      body: finalBody,
      keywordContract: draftRewriteContext?.strategy.keywordContract,
      confirmedSeoKeywords,
    });
    setReviewIssues(review.issues);
    setReviewResult(review);
    setPublishNotice(null);
    setPublishCompletionMessage(null);

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
      setReviewedTitle(review.normalizedTitle);
      setReviewedBody(finalBody);
      setReviewApplied(true);
      setPublishModalOpen(false);
      const generatedMsg = publishResult.autoGeneratedTopics
        ? ` 현재 계획 글이 없어 다음 글목록 ${publishResult.autoGeneratedTopics}개를 자동 생성했습니다.`
        : "";
      const learningMsg = publishResult.learned ? " 발행 데이터도 학습 기록에 누적했습니다." : "";
      const completionMessage = `발행 완료 및 인덱스에 추가되었습니다.${generatedMsg}${learningMsg} 확인을 누르면 페이지를 새로고침합니다.`;
      setPublishNotice({ type: "ok", msg: completionMessage });
      setPublishCompletionMessage(completionMessage);
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
    return !!directMainKeyword.trim();
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
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startPipeline(true, false, "different_angle")}
                  className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
                >
                  기존 글과 다른 각도로 작성
                </button>
                <button
                  type="button"
                  onClick={() => startPipeline(true, false, "force_duplicate")}
                  className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                >
                  무시하고 작성
                </button>
              </div>
            )}
            {strategyDuplicateBlocked && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startPipeline(false, false, "different_angle")}
                  className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
                >
                  기존 글과 다른 각도로 작성
                </button>
                <button
                  type="button"
                  onClick={() => startPipeline(false, false, "force_duplicate")}
                  className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                >
                  무시하고 작성
                </button>
              </div>
            )}
            {publishedDuplicateBlocked && (
              <button
                type="button"
                onClick={() => startPipeline(true, true, "force_duplicate")}
                className="mt-3 ml-2 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
              >
                무시하고 작성
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label="\uC624\uB958 \uB2EB\uAE30"
            onClick={() => setPipelineError(null)}
            className="ml-3 text-red-400 hover:text-red-600 shrink-0 text-lg leading-none"
          >
            \u00D7
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(220px,260px)_minmax(0,2.15fr)_minmax(220px,280px)] 2xl:grid-cols-[minmax(230px,280px)_minmax(0,2.45fr)_minmax(230px,300px)] gap-5 xl:gap-6 items-start">
        <section className="min-w-0 space-y-6">
          <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-5">
            <div>
              <label htmlFor="pipeline-user" className="block text-xs font-semibold text-zinc-600 mb-1">사용자 선택</label>
              <input
                id="pipeline-user"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="사용자 ID 입력"
                disabled={running}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                {profileLoading && <span className="text-xs text-zinc-400">확인 중</span>}
                {!profileLoading && profile && (
                  <span className="min-w-0 break-words text-xs font-medium text-emerald-600">{profileDisplayName}</span>
                )}
                {!draftSessionLoading && draftSessions.length > 0 && (
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
                    임시저장 {draftSessions.length}개
                  </span>
                )}
                {!profileLoading && userId.trim() && !profile && profileError && (
                  <span className="min-w-0 break-words text-xs text-red-500" title={profileError}>오류: {profileError}</span>
                )}
              </div>
              {normalizedUserId && (
                <p className={`mt-1.5 text-[11px] ${
                  draftSync.status === "error"
                    ? "text-red-500"
                    : draftSync.status === "saving" || draftSync.status === "loading"
                      ? "text-blue-500"
                      : "text-zinc-500"
                }`}>
                  사용자 키: <span className="font-mono">{normalizedUserId}</span>
                  {draftSync.message ? ` · ${draftSync.message}` : ""}
                  {draftSync.updatedAt ? ` · ${new Date(draftSync.updatedAt).toLocaleString("ko-KR")}` : ""}
                </p>
              )}
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
                    {orderedAvailableTopics.map((topic) => (
                      <option key={topic.topicId} value={topic.topicId}>
                        {formatPipelineTopicLabel(topic)}
                      </option>
                    ))}
                  </select>
                  {selectedTopic?.seriesId && (
                    <p className="text-[11px] text-zinc-500 mt-1.5">
                      {selectedTopic.seriesRole === "main"
                        ? `시리즈 메인 글입니다. 선행 ${selectedTopic.prerequisiteTopicIds?.length ?? 0}개가 모두 발행되어야 작성할 수 있습니다.`
                        : `시리즈 선행 글 ${selectedTopic.sequenceOrder ?? "-"}번입니다. 메인 키워드: ${selectedTopic.targetMainKeyword ?? "-"}`}
                    </p>
                  )}
                  {selectedDraftSessions.length > 0 && (
                    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-blue-700">
                        이 주제에 임시저장 {selectedDraftSessions.length}개
                      </p>
                      <div className="mt-1.5 space-y-1.5">
                        {selectedDraftSessions.map((session) => (
                          <div key={session.sessionId} className="flex items-center gap-2 rounded border border-blue-100 bg-white px-2 py-1.5">
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-medium text-blue-700">
                                {new Date(session.updatedAt).toLocaleString("ko-KR")}
                              </p>
                              <p className="text-[11px] text-zinc-500">
                                {session.result.wordCount ? `${session.result.wordCount.toLocaleString()}자` : ""}
                                {session.result.evalScore ? ` · 점수 ${session.result.evalScore}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => loadDraftSession(session)}
                              disabled={running}
                              className="shrink-0 rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              불러오기
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteDraftSession(session.sessionId)}
                              disabled={running || deletingSessionId === session.sessionId}
                              className="shrink-0 rounded bg-zinc-200 px-2 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-300 disabled:opacity-50"
                            >
                              {deletingSessionId === session.sessionId ? "…" : "삭제"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {orderedAvailableTopics.length === 0 && (
                    <p className="text-xs text-zinc-400 mt-1.5">
                      {userId.trim()
                        ? `'${userId.trim()}' 사용자에게 배정된 주제가 없습니다.`
                        : "글 목록이 비어 있습니다. 먼저 주제를 등록해 주세요."}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="pipeline-direct-main-keyword" className="block text-[11px] font-semibold text-zinc-500 mb-1.5">
                      메인 키워드
                    </label>
                    <input
                      id="pipeline-direct-main-keyword"
                      value={directMainKeyword}
                      onChange={(event) => setDirectMainKeyword(event.target.value)}
                      placeholder="예: 부평 전자담배"
                      disabled={running}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="pipeline-direct-sub-keyword" className="block text-[11px] font-semibold text-zinc-500 mb-1.5">
                      서브 키워드
                    </label>
                    <input
                      id="pipeline-direct-sub-keyword"
                      value={directSubKeyword}
                      onChange={(event) => setDirectSubKeyword(event.target.value)}
                      placeholder="예: 입문 기기 추천"
                      disabled={running}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="pipeline-direct-topic-title" className="text-[11px] font-semibold text-zinc-500">
                        제목 또는 주제
                      </label>
                      <button
                        type="button"
                        onClick={generateTitle}
                        disabled={!directMainKeyword.trim() || isGeneratingTitle || running}
                        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isGeneratingTitle ? (
                          <>
                            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
                            생성 중…
                          </>
                        ) : (
                          "✦ AI 제목생성"
                        )}
                      </button>
                    </div>
                    <input
                      id="pipeline-direct-topic-title"
                      value={directTopicTitle}
                      onChange={(event) => {
                        setDirectTopicTitle(event.target.value);
                        setTitleCandidates([]);
                      }}
                      placeholder="예: 부평 전자담배 액상 고를 때 먼저 보는 기준"
                      disabled={running}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                    {titleCandidates.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[10px] font-semibold text-violet-500">클릭하면 제목으로 입력됩니다</p>
                        {titleCandidates.map((candidate, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => {
                              setDirectTopicTitle(candidate);
                              setTitleCandidates([]);
                            }}
                            className="block w-full text-left px-3 py-2 text-xs text-zinc-800 bg-white border border-violet-200 rounded-lg hover:bg-violet-50 hover:border-violet-400 transition-colors"
                          >
                            {candidate}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <p className="text-[11px] font-semibold text-zinc-500">조합 제목 미리보기</p>
                    <p className="mt-1 text-sm text-zinc-800">
                      {directTopicTitle.trim() || buildDirectTopicTitle(directMainKeyword, directSubKeyword) || "메인 키워드를 입력해 주세요."}
                    </p>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1.5">
                    제목 또는 주제는 선택이고, 메인 키워드는 필수입니다. 입력한 키워드는 확정 SEO 키워드 사용량의 기준으로 바로 사용됩니다.
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

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => startPipeline()}
                disabled={!canStart}
                className="py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {running ? "글쓰기 진행 중" : "글쓰기 시작"}
              </button>
              <button
                type="button"
                onClick={stopPipeline}
                disabled={!running && !approval}
                className="py-2.5 bg-zinc-200 text-zinc-800 text-sm font-semibold rounded-lg hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                글쓰기 진행 멈춤
              </button>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-700">초안 임시저장</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    초안 생성 완료 상태까지만 사용자별로 저장합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={saveCurrentDraftSession}
                  disabled={running || draftSessionSaving || !result || !streamingBody.trim()}
                  className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {draftSessionSaving ? "저장 중" : "현재 작업까지 임시저장"}
                </button>
              </div>
              {draftSessionNotice && (
                <p className={`mt-2 text-[11px] ${draftSessionNotice.type === "ok" ? "text-emerald-600" : "text-red-500"}`}>
                  {draftSessionNotice.msg}
                </p>
              )}
            </div>
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
          reviewResult={reviewResult}
          reviewIssues={reviewIssues}
          draftVersionReports={draftVersionReports}
          stage1EmptyMessage={stage1EmptyMessage}
          onOpenReviewModal={openReviewModal}
          onOpenPublishModal={openPublishModal}
        />

        <PipelineReportPanel
          contentTab={contentTab}
          approval={approval ? (
            <ApprovalDialog
              pipelineId={approval.pipelineId}
              previousTitle={approval.previousTitle}
              proposedTitle={approval.proposedTitle}
              rationale={approval.rationale}
              outline={approval.outline}
              keywordContract={approval.strategy.keywordContract}
              naverLogic={approval.strategy.naverLogic}
              onApprove={handleApprove}
              onReject={() => handleApprove({ pipelineId: approval.pipelineId, approved: false })}
              isReplanning={isReplanning}
              modificationFeedback={approvalModificationFeedback}
              onReplan={(mods) => {
                const uid = normalizeUserId(userId.trim());
                const currentApproval = approval;
                const requestedModifications = mods.trim();
                if (!currentApproval || !requestedModifications) return;

                setIsReplanning(true);
                setApprovalModificationFeedback({
                  status: "submitting",
                  text: requestedModifications,
                  updatedAt: new Date().toISOString(),
                });
                fetch("/api/pipeline/revise-strategy", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    topicId: currentApproval.topicId,
                    userId: uid,
                    strategy: currentApproval.strategy,
                    modifications: requestedModifications,
                  }),
                })
                  .then(async (res) => {
                    const json = await res.json() as { strategy?: StrategyPlanResult; error?: string };
                    if (!res.ok || !json.strategy) {
                      const errorMessage = json.error ?? "알 수 없는 오류";
                      setApprovalModificationFeedback({
                        status: "error",
                        text: requestedModifications,
                        error: errorMessage,
                        updatedAt: new Date().toISOString(),
                      });
                      setPipelineError(`전략 수정 실패: ${errorMessage}`);
                      return;
                    }
                    setApprovalModificationFeedback({
                      status: "applied",
                      text: requestedModifications,
                      updatedAt: new Date().toISOString(),
                    });
                    setApproval((prev) =>
                      prev
                        ? {
                            ...prev,
                            strategy: json.strategy!,
                            proposedTitle: json.strategy!.title ?? prev.proposedTitle,
                            rationale: json.strategy!.rationale ?? prev.rationale,
                            modifications: requestedModifications,
                            outline: Array.isArray(json.strategy!.outline)
                              ? (json.strategy!.outline as Array<{ heading: string } | string>).map(
                                  (item) => (typeof item === "string" ? item : item.heading)
                                )
                              : prev.outline,
                          }
                        : null
                    );
                  })
                  .catch((err: unknown) => {
                    const errorMessage = err instanceof Error ? err.message : "네트워크 오류";
                    setApprovalModificationFeedback({
                      status: "error",
                      text: requestedModifications,
                      error: errorMessage,
                      updatedAt: new Date().toISOString(),
                    });
                    setPipelineError(`전략 수정 오류: ${errorMessage}`);
                  })
                  .finally(() => setIsReplanning(false));
              }}
            />
          ) : null}
          result={result}
          reviewResult={reviewResult}
          reviewIssues={reviewIssues}
          publishUrl={publishUrl}
          publishNotice={publishNotice}
        />
      </div>

      {publishCompletionMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-emerald-200 bg-white shadow-2xl">
            <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-4">
              <p className="text-sm font-semibold text-emerald-700">인덱스 추가 완료</p>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm leading-6 text-zinc-700">{publishCompletionMessage}</p>
            </div>
            <div className="flex justify-end border-t border-zinc-100 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setPublishCompletionMessage(null);
                  window.location.reload();
                }}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                확인 후 새로고침
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-zinc-200 bg-white shadow-2xl">
            <div className="border-b border-zinc-100 px-6 py-4">
              <p className="text-sm font-semibold text-zinc-900">수정본 검토</p>
              <p className="mt-1 text-xs text-zinc-500">사용자가 직접 작성한 제목과 본문을 붙여 넣어 검토합니다. 기본값은 비워 둡니다.</p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">수정 제목</label>
                <input
                  value={reviewTitle}
                  onChange={(event) => {
                    setReviewTitle(event.target.value);
                    setReviewApplied(false);
                  }}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="수정할 제목"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={fillReviewModalFromLatestDraft}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  초안 가져오기
                </button>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">수정 본문</label>
                <textarea
                  value={reviewBody}
                  onChange={(event) => {
                    setReviewBody(event.target.value);
                    setReviewApplied(false);
                  }}
                  className="min-h-[22rem] w-full rounded-lg border border-zinc-200 px-3 py-3 text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="수정할 본문"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setReviewModalOpen(false)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={submitReviewModal}
                disabled={reviewSaving || !reviewTitle.trim() || !reviewBody.trim()}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {reviewSaving ? "검토 중..." : "수정본 검토하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {publishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-emerald-200 bg-white shadow-2xl">
            <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-4">
              <p className="text-sm font-semibold text-emerald-700">실제 발행본 진행</p>
              <p className="mt-1 text-xs text-emerald-700/80">최종 발행 제목, 본문, URL을 입력하면 인덱스 반영까지 이어집니다.</p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">최종 발행 제목</label>
                <input
                  value={publishTitle}
                  onChange={(event) => setPublishTitle(event.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="최종 발행 제목"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">최종 발행 본문</label>
                <textarea
                  value={publishBody}
                  onChange={(event) => setPublishBody(event.target.value)}
                  className="min-h-[18rem] w-full rounded-lg border border-zinc-200 px-3 py-3 text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="최종 발행 본문"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">발행 URL</label>
                <input
                  value={publishUrl}
                  onChange={(event) => {
                    setPublishUrl(event.target.value);
                    setPublishNotice(null);
                    setPublishCompletionMessage(null);
                  }}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="https://blog.naver.com/..."
                />
              </div>

              {!publishUrl.trim() ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-700">
                  발행 URL 입력 후 인덱스 반영 가능
                </div>
              ) : result?.finalDraftCheck && !canApproveFinalDraft(result.finalDraftCheck) ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-700">
                  본문 검수 차단 사유는 참고용입니다. 실제 발행본과 URL이 있으면 인덱스 반영은 계속 진행할 수 있습니다.
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                  본문 승인 가능 · 인덱스 반영 준비 완료
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setPublishModalOpen(false)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={publishToIndex}
                disabled={publishingToIndex || !publishTitle.trim() || !publishBody.trim() || !publishUrl.trim()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {publishingToIndex ? "인덱스 반영 중..." : "발행 완료 및 인덱스 반영"}
              </button>
            </div>
          </div>
        </div>
      )}

      {draftCompletionMessage && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-blue-200 bg-white shadow-2xl">
            <div className="border-b border-blue-100 bg-blue-50 px-6 py-4">
              <p className="text-sm font-semibold text-blue-700">\uCD08\uC548 \uC791\uC131 \uC644\uB8CC</p>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm leading-6 text-zinc-700">{draftCompletionMessage}</p>
            </div>
            <div className="flex justify-end border-t border-zinc-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setDraftCompletionMessage(null)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                \uD655\uC778
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
