"use client";

import { useEffect, useRef, useState } from "react";
import type { Topic, PostingRecord } from "@/lib/types/github-data";
import { parseTopicText, readFileAutoEncoding } from "@/lib/skills/import-parser";
import { resolveRemainingTopics } from "@/lib/skills/remaining-topic-resolver";
import { blogCode, userIdToBlogCode } from "@/lib/utils/blog-code";
import type {
  GeneratedTopic,
  SeriesPostPlan,
  SeriesValidationChecklist,
  SeriesWorkflowOutput,
  TopicGeneratorOutput,
} from "@/lib/agents/topic-generator";

interface SeriesDetailPreviewItem {
  topicId: string;
  title: string;
  seriesRole: "prelude" | "main";
  sequenceOrder: number;
  detailPlan: {
    articleGoal: string;
    searchIntent: string;
    readerQuestion: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    recommendedSections: string[];
    keywordPlacementRules: string[];
    internalLinkTitles: string[];
    callToAction: string;
    draftAngle: string;
  };
}

interface SeriesDetailPreviewResult {
  seriesId: string;
  mainKeyword: string;
  plannedTopics: SeriesDetailPreviewItem[];
}

interface SavedSeriesSummary {
  seriesId: string;
  mainKeyword: string;
  topicIds: string[];
  titles: string[];
  savedAt: string;
  replacementTopicText?: string;
}

type GenerateMode = "topics" | "preposting-series" | "series-detail" | "series-workflow";
type SeriesWorkflowResult = SeriesWorkflowOutput;

interface TopicPersistResponse {
  topic: Topic;
  error?: string;
}

type StatusFilter = "all" | "remaining" | "matched" | Topic["status"];
type UserFilter = "all" | "unassigned" | string;

const STATUS_LABELS: Record<Topic["status"], string> = {
  draft: "대기",
  planned: "계획됨",
  "in-progress": "진행 중",
  published: "발행됨",
  archived: "보관됨",
};

const STATUS_COLORS: Record<Topic["status"], string> = {
  draft: "bg-zinc-100 text-zinc-600",
  planned: "bg-sky-100 text-sky-700",
  "in-progress": "bg-blue-100 text-blue-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-zinc-100 text-zinc-400",
};

const BLOG_BADGE_COLORS: Record<string, string> = {
  A: "bg-blue-100 text-blue-700",
  B: "bg-violet-100 text-violet-700",
  C: "bg-emerald-100 text-emerald-700",
  D: "bg-orange-100 text-orange-700",
  E: "bg-pink-100 text-pink-700",
};

const SERIES_ROLE_LABELS: Record<SeriesPostPlan["role"], string> = {
  preheat_criteria: "예열글 1 · 기준 정리형",
  preheat_experience: "예열글 2 · 체감/문제 인식형",
  preheat_consulting: "예열글 3 · 상담/구매 전 질문형",
  main_hub: "본편 · 추천 허브형",
  followup: "후속글 · 만족도/실패 방지형",
};

const RISK_LABELS: Record<"low" | "medium" | "high", string> = {
  low: "낮음",
  medium: "주의",
  high: "높음",
};

const CHECKLIST_LABELS: Record<keyof SeriesValidationChecklist, string> = {
  mainKeywordReservedForMainPost: "본편 메인 키워드가 본편에만 예약되었는가",
  preheatKeywordsAreDistributed: "예열글 3편의 키워드가 역할별로 분산되었는가",
  searchIntentIsDifferentEachPost: "각 글의 검색의도가 서로 다른가",
  mainPostIsHub: "본편이 허브 글로 설계되었는가",
  preheatPostsAreLeaf: "예열글 3편이 모두 리프 글인가",
  followupConnectsAfterMain: "후속글이 본편 이후 흐름으로 연결되는가",
  internalLinksAreDesigned: "내부링크 문장과 방향이 설계되었는가",
  existingIndexChecked: "기존 인덱스를 확인했는가",
  existingPostHistoryChecked: "기존 작성/발행 내역을 확인했는가",
  cannibalizationRiskAcceptable: "키워드 충돌 위험이 허용 가능한 수준인가",
};

interface EditSeriesDetailState {
  articleGoal: string;
  searchIntent: string;
  readerQuestion: string;
  primaryKeyword: string;
  secondaryKeywords: string;   // 쉼표 구분
  recommendedSections: string; // 줄바꿈 구분
  keywordPlacementRules: string;
  internalLinkTitles: string;
  callToAction: string;
  draftAngle: string;
}

interface EditTopicState {
  topicId: string;
  title: string;
  assignedUserId: string;
  status: Topic["status"];
  seriesDetailPlan?: EditSeriesDetailState;
  hasSeries: boolean;
  seriesRole?: "prelude" | "main";
  sequenceOrder?: number;
  targetMainKeyword?: string;
}

function resolveTopicBadgeCode(topic: Topic): string | null {
  return blogCode(topic.category) ?? (topic.assignedUserId ? userIdToBlogCode(topic.assignedUserId) : null);
}

function getGeneratePanelCopy(mode: GenerateMode): {
  title: string;
  badge: string;
  description: string;
  actionLabel: string;
} {
  if (mode === "preposting-series") {
    return {
      title: "선행 포스팅 설계",
      badge: "시리즈 일괄 설계",
      description:
        "메인 키워드를 넣으면 선행 글 2~3개와 메인 글 1개를 시리즈로 설계하고, 저장할 때 편별 상세 전략까지 한 번에 함께 저장합니다.",
      actionLabel: "시리즈 설계",
    };
  }

  if (mode === "series-detail") {
    return {
      title: "시리즈 상세 설계",
      badge: "편별 상세 전략",
      description:
        "이미 만든 시리즈 토픽을 불러와 각 편의 목표, 검색 의도, 핵심 키워드, 섹션 구조, 내부링크 계획까지 저장합니다. 이후 전략 수립과 초안 생성이 이 설계를 우선 참고합니다.",
      actionLabel: "상세 설계 생성",
    };
  }

  if (mode === "series-workflow") {
    return {
      title: "시리즈물 선행포스팅 설계",
      badge: "검색자 여정 기반",
      description:
        "본편 키워드를 예약한 뒤 예열글 3편, 본편 1편, 후속글 1편을 검색의도와 내부링크 흐름까지 포함해 한 번에 설계합니다.",
      actionLabel: "시리즈 설계 생성",
    };
  }

  return {
    title: "AI 새 글목록 생성",
    badge: "네이버 리서치 기반",
    description:
      "기존 발행 글을 분석해 연관된 신규 토픽 5개를 생성합니다. 남은 계획 글이 있어도 사용자가 원하면 추가로 생성할 수 있고, 생성 후 원하는 항목만 선택해 추가할 수 있습니다.",
    actionLabel: "추가 생성",
  };
}

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [posts, setPosts] = useState<PostingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");

  // 불러오기 패널
  const [importTab, setImportTab] = useState<"text" | "file">("text");
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<Array<{ title: string; blog: string }>>([]);
  const [parsedCount, setParsedCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [savedSeriesSummary, setSavedSeriesSummary] = useState<SavedSeriesSummary | null>(null);

  // 개별 편집
  const [editing, setEditing] = useState<EditTopicState | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // 단일 추가
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addUserId, setAddUserId] = useState("");

  // AI 글목록 생성
  const [generateMode, setGenerateMode] = useState<GenerateMode>("topics");
  const [generateUserId, setGenerateUserId] = useState("");
  const [seriesMainKeyword, setSeriesMainKeyword] = useState("");
  const [seriesPreludeCount, setSeriesPreludeCount] = useState(3);
  const [seriesTargetTopic, setSeriesTargetTopic] = useState("");
  const [seriesRegion, setSeriesRegion] = useState("");
  const [seriesProductGroup, setSeriesProductGroup] = useState("");
  const [seriesTargetUser, setSeriesTargetUser] = useState("");
  const [seriesPreferredBlog, setSeriesPreferredBlog] = useState<"" | "A" | "B" | "C" | "D" | "E">("");
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<TopicGeneratorOutput | null>(null);
  const [seriesDetailResult, setSeriesDetailResult] = useState<SeriesDetailPreviewResult | null>(null);
  const [seriesWorkflowResult, setSeriesWorkflowResult] = useState<SeriesWorkflowResult | null>(null);
  const [selectedGenerated, setSelectedGenerated] = useState<Set<number>>(new Set());
  const [selectedSeriesDetails, setSelectedSeriesDetails] = useState<Set<number>>(new Set());
  const [savingGenerated, setSavingGenerated] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const savedSeriesSummaryRef = useRef<HTMLDivElement>(null);
  const panelCopy = getGeneratePanelCopy(generateMode);
  const seriesWorkflowReady = seriesWorkflowResult
    ? Object.values(seriesWorkflowResult.validationChecklist).every(Boolean)
    : false;

  const loadTopics = () => {
    setLoading(true);
    const t = Date.now();
    Promise.allSettled([
      fetch(`/api/github/topics?_t=${t}`).then((r) => r.json()) as Promise<{ topics: Topic[] }>,
      fetch(`/api/github/posts?limit=1000&_t=${t}`).then((r) => r.json()) as Promise<{ posts: PostingRecord[] }>,
    ]).then(([topicResult, postResult]) => {
      const topicData = topicResult.status === "fulfilled" ? topicResult.value : { topics: [] };
      const postData = postResult.status === "fulfilled" ? postResult.value : { posts: [] };
      setTopics(topicData.topics ?? []);
      setPosts(postData.posts ?? []);
    }).catch(() => setNotice({ type: "err", msg: "글목록 로드 실패" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTopics(); }, []);

  useEffect(() => {
    if (!savedSeriesSummary) return;
    const timer = setTimeout(() => {
      savedSeriesSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(timer);
  }, [savedSeriesSummary]);

  // RemainingTopicResolver: 교차체크
  const planningTopics = topics.filter((topic) => topic.source !== "direct");
  const userOptions = Array.from(
    new Set(planningTopics.map((topic) => topic.assignedUserId?.trim().toLowerCase()).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));
  const userScopedTopics = planningTopics.filter((topic) => {
    if (userFilter === "all") return true;
    if (userFilter === "unassigned") return !topic.assignedUserId;
    return topic.assignedUserId?.trim().toLowerCase() === userFilter;
  });
  const { remaining, matched } = resolveRemainingTopics(userScopedTopics, posts);
  const remainingIds = new Set(remaining.map((t) => t.topicId));

  // ── 파일/텍스트 처리 ────────────────────────────────────
  const applyText = (text: string) => {
    setPasteText(text);
    const result = parseTopicText(text);
    setPreview(result.items);
    setParsedCount(result.parsed_count);
    setDuplicateCount(result.duplicate_count);
    setFailedCount(result.failed_count);
    setNotice(null);
    setSavedSeriesSummary(null);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readFileAutoEncoding(file);
    applyText(text);
  };

  // ── 교체 저장 ──────────────────────────────────────────
  const handleSave = async () => {
    if (preview.length === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/github/topics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: preview }),
      });
      const json = await res.json() as { replaced?: number; kept?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "저장 실패");
      const parts = [`저장 ${json.replaced}건`];
      if (json.kept) parts.push(`진행 중 ${json.kept}건 유지`);
      if (duplicateCount > 0) parts.push(`중복 ${duplicateCount}건 제외`);
      if (failedCount > 0) parts.push(`실패 ${failedCount}건 제외`);
      setNotice({ type: "ok", msg: parts.join(" / ") });
      setPasteText(""); setPreview([]);
      setParsedCount(0); setDuplicateCount(0); setFailedCount(0);
      if (fileRef.current) fileRef.current.value = "";
      loadTopics();
    } catch (e) {
      setNotice({ type: "err", msg: e instanceof Error ? e.message : "저장 중 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  };

  // ── 단일 추가 ───────────────────────────────────────────
  const handleAdd = async () => {
    if (!addTitle.trim()) return;
    try {
      const res = await fetch("/api/github/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: addTitle.trim(), assignedUserId: addUserId.trim().toLowerCase() || null }),
      });
      if (!res.ok) throw new Error();
      setShowAdd(false); setAddTitle(""); setAddUserId("");
      setNotice({ type: "ok", msg: "항목이 추가되었습니다." });
      loadTopics();
    } catch {
      setNotice({ type: "err", msg: "추가 실패" });
    }
  };

  // ── 수정 ───────────────────────────────────────────────
  const startEdit = (t: Topic) => {
    const dp = t.seriesDetailPlan;
    setEditing({
      topicId: t.topicId,
      title: t.title,
      assignedUserId: t.assignedUserId ?? "",
      status: t.status,
      hasSeries: !!t.seriesId,
      seriesRole: t.seriesRole,
      sequenceOrder: t.sequenceOrder,
      targetMainKeyword: t.targetMainKeyword,
      seriesDetailPlan: dp ? {
        articleGoal: dp.articleGoal ?? "",
        searchIntent: dp.searchIntent ?? "",
        readerQuestion: dp.readerQuestion ?? "",
        primaryKeyword: dp.primaryKeyword ?? "",
        secondaryKeywords: (dp.secondaryKeywords ?? []).join(", "),
        recommendedSections: (dp.recommendedSections ?? []).join("\n"),
        keywordPlacementRules: (dp.keywordPlacementRules ?? []).join("\n"),
        internalLinkTitles: (dp.internalLinkTitles ?? []).join("\n"),
        callToAction: dp.callToAction ?? "",
        draftAngle: dp.draftAngle ?? "",
      } : (t.seriesId ? {
        articleGoal: "", searchIntent: "", readerQuestion: "", primaryKeyword: "",
        secondaryKeywords: "", recommendedSections: "", keywordPlacementRules: "",
        internalLinkTitles: "", callToAction: "", draftAngle: "",
      } : undefined),
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      const dp = editing.seriesDetailPlan;
      const body: Record<string, unknown> = {
        topicId: editing.topicId,
        title: editing.title,
        assignedUserId: editing.assignedUserId.trim().toLowerCase() || null,
        status: editing.status,
      };
      if (dp) {
        body.seriesDetailPlan = {
          articleGoal: dp.articleGoal.trim(),
          searchIntent: dp.searchIntent.trim(),
          readerQuestion: dp.readerQuestion.trim(),
          primaryKeyword: dp.primaryKeyword.trim(),
          secondaryKeywords: dp.secondaryKeywords.split(",").map((s) => s.trim()).filter(Boolean),
          recommendedSections: dp.recommendedSections.split("\n").map((s) => s.trim()).filter(Boolean),
          keywordPlacementRules: dp.keywordPlacementRules.split("\n").map((s) => s.trim()).filter(Boolean),
          internalLinkTitles: dp.internalLinkTitles.split("\n").map((s) => s.trim()).filter(Boolean),
          callToAction: dp.callToAction.trim(),
          draftAngle: dp.draftAngle.trim(),
        };
        body.seriesDetailReadyAt = new Date().toISOString();
      }
      const res = await fetch("/api/github/topics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setEditing(null);
      setNotice({ type: "ok", msg: "수정되었습니다." });
      loadTopics();
    } catch {
      setNotice({ type: "err", msg: "수정 실패" });
    }
  };

  // ── 시리즈 상세 설계 AI 재생성 ─────────────────────────
  const handleRegenerateSeriesDetail = async () => {
    if (!editing?.seriesDetailPlan) return;
    setRegenerating(true);
    try {
      const dp = editing.seriesDetailPlan;
      const res = await fetch("/api/topics/series-detail/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: editing.topicId,
          userId: editing.assignedUserId.trim().toLowerCase() || undefined,
          title: editing.title,
          primaryKeyword: dp.primaryKeyword,
          secondaryKeywords: dp.secondaryKeywords.split(",").map((s) => s.trim()).filter(Boolean),
          seriesRole: editing.seriesRole,
          sequenceOrder: editing.sequenceOrder,
          targetMainKeyword: editing.targetMainKeyword,
        }),
      });
      const json = await res.json() as { detailPlan?: {
        articleGoal: string; searchIntent: string; readerQuestion: string;
        primaryKeyword: string; secondaryKeywords: string[];
        recommendedSections: string[]; keywordPlacementRules: string[];
        internalLinkTitles: string[]; callToAction: string; draftAngle: string;
      }; error?: string };
      if (!res.ok || !json.detailPlan) throw new Error(json.error ?? "재생성 실패");
      const p = json.detailPlan;
      setEditing({
        ...editing,
        seriesDetailPlan: {
          articleGoal: p.articleGoal,
          searchIntent: p.searchIntent,
          readerQuestion: p.readerQuestion,
          primaryKeyword: p.primaryKeyword,
          secondaryKeywords: p.secondaryKeywords.join(", "),
          recommendedSections: p.recommendedSections.join("\n"),
          keywordPlacementRules: p.keywordPlacementRules.join("\n"),
          internalLinkTitles: p.internalLinkTitles.join("\n"),
          callToAction: p.callToAction,
          draftAngle: p.draftAngle,
        },
      });
    } catch (e) {
      setNotice({ type: "err", msg: e instanceof Error ? e.message : "재생성 실패" });
    } finally {
      setRegenerating(false);
    }
  };

  // ── AI 글목록 생성 ─────────────────────────────────────
  const handleGenerate = async () => {
    if (!generateUserId.trim()) return;
    if (generateMode !== "topics" && !seriesMainKeyword.trim()) return;
    setGenerating(true);
    setGenerateResult(null);
    setSeriesDetailResult(null);
    setSeriesWorkflowResult(null);
    setSelectedGenerated(new Set());
    setSelectedSeriesDetails(new Set());
    setNotice(null);
    try {
      if (generateMode === "series-detail") {
        const res = await fetch("/api/topics/series-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: generateUserId.trim(),
            mainKeyword: seriesMainKeyword.trim(),
          }),
        });
        const json = await res.json() as SeriesDetailPreviewResult & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "상세 설계 생성 실패");
        setSeriesDetailResult(json);
        setSelectedSeriesDetails(new Set(json.plannedTopics.map((_, i) => i)));
      } else if (generateMode === "series-workflow") {
        const res = await fetch("/api/topics/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: generateUserId.trim(),
            mode: generateMode,
            targetTopic: seriesTargetTopic.trim() || seriesMainKeyword.trim(),
            targetKeyword: seriesMainKeyword.trim(),
            region: seriesRegion.trim() || undefined,
            productGroup: seriesProductGroup.trim() || undefined,
            targetUser: seriesTargetUser.trim() || undefined,
            preferredBlog: seriesPreferredBlog || undefined,
          }),
        });
        const json = await res.json() as SeriesWorkflowResult & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "시리즈 설계 생성 실패");
        setSeriesWorkflowResult(json);
        setSelectedGenerated(new Set(json.generatedTopics.map((_, i) => i)));
      } else {
        const res = await fetch("/api/topics/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: generateUserId.trim(),
            mode: generateMode,
            mainKeyword: seriesMainKeyword.trim(),
            preludeCount: seriesPreludeCount,
          }),
        });
        let json: TopicGeneratorOutput & { error?: string };
        try {
          json = await res.json() as TopicGeneratorOutput & { error?: string };
        } catch {
          throw new Error("서버 응답 파싱 실패 — 잠시 후 다시 시도해주세요.");
        }
        if (!res.ok) throw new Error(json.error ?? "생성 실패");
        setGenerateResult(json);
        setSelectedGenerated(new Set(json.generatedTopics.map((_, i) => i)));
      }
    } catch (e) {
      setNotice({ type: "err", msg: e instanceof Error ? e.message : "생성 실패" });
    } finally {
      setGenerating(false);
    }
  };

  const saveSeriesDetailsForSeries = async (params: {
    userId: string;
    mainKeyword: string;
    seriesId?: string;
    topicIds?: string[];
  }) => {
    const res = await fetch("/api/topics/series-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: params.userId,
        mainKeyword: params.mainKeyword,
        seriesId: params.seriesId,
        topicIds: params.topicIds,
      }),
    });
    const json = await res.json() as SeriesDetailPreviewResult & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "상세 설계 생성 실패");

    for (const item of json.plannedTopics) {
      await fetch("/api/github/topics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: item.topicId,
          seriesDetailPlan: item.detailPlan,
          seriesDetailReadyAt: new Date().toISOString(),
        }),
      });
    }

    return json;
  };

  const handleSaveSeriesDetails = async () => {
    if (!seriesDetailResult || selectedSeriesDetails.size === 0) return;
    setSavingGenerated(true);
    setNotice(null);
    try {
      const selected = seriesDetailResult.plannedTopics.filter((_, i) => selectedSeriesDetails.has(i));
      for (const item of selected) {
        await fetch("/api/github/topics", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topicId: item.topicId,
            seriesDetailPlan: item.detailPlan,
            seriesDetailReadyAt: new Date().toISOString(),
          }),
        });
      }
      setNotice({ type: "ok", msg: `${selected.length}개 토픽에 상세 설계가 저장되었습니다.` });
      setSeriesDetailResult(null);
      setSelectedSeriesDetails(new Set());
      loadTopics();
    } catch {
      setNotice({ type: "err", msg: "상세 설계 저장 실패" });
    } finally {
      setSavingGenerated(false);
    }
  };

  const handleSaveGenerated = async () => {
    const activeGeneratedTopics =
      generateMode === "series-workflow"
        ? seriesWorkflowResult?.generatedTopics ?? []
        : generateResult?.generatedTopics ?? [];
    if (activeGeneratedTopics.length === 0 || selectedGenerated.size === 0) return;
    setSavingGenerated(true);
    setNotice(null);
    let savedCount = 0;
    try {
      const selected = activeGeneratedTopics.filter((_, i) => selectedGenerated.has(i));
      const savedTopics: Topic[] = [];
      for (const topic of selected) {
        const res = await fetch("/api/github/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topicId: topic.topicId,
            title: topic.title,
            description: topic.description,
            category: topic.category,
            tags: topic.tags,
            source: "generated",
            contentKind: topic.contentKind,
            seriesId: topic.seriesId,
            seriesRole: topic.seriesRole,
            targetMainKeyword: topic.targetMainKeyword,
            sequenceOrder: topic.sequenceOrder,
            prerequisiteTopicIds: topic.prerequisiteTopicIds,
            assignedUserId: generateUserId.trim().toLowerCase(),
          }),
        });
        const json = await res.json() as TopicPersistResponse;
        if (!res.ok || !json.topic) {
          throw new Error(json.error ?? "토픽 저장 실패");
        }
        savedTopics.push(json.topic);
        savedCount += 1;
      }

      if (generateMode === "preposting-series") {
        const seriesId = savedTopics.find((topic) => topic.seriesId)?.seriesId;
        const detailResult = await saveSeriesDetailsForSeries({
          userId: generateUserId.trim(),
          mainKeyword: seriesMainKeyword.trim(),
          seriesId,
          topicIds: savedTopics.map((topic) => topic.topicId),
        });
        setNotice({
          type: "ok",
          msg: `${selected.length}개 시리즈 토픽과 ${detailResult.plannedTopics.length}개 상세 설계가 함께 저장되었습니다.`,
        });
        setSavedSeriesSummary({
          seriesId: detailResult.seriesId,
          mainKeyword: detailResult.mainKeyword,
          topicIds: detailResult.plannedTopics.map((item) => item.topicId),
          titles: detailResult.plannedTopics.map((item) => item.title),
          savedAt: new Date().toISOString(),
        });
        setUserFilter(generateUserId.trim().toLowerCase());
        setFilter("all");
      } else if (generateMode === "series-workflow" && seriesWorkflowResult) {
        const selectedIndexes = [...selectedGenerated].sort((left, right) => left - right);
        const summaryTitles = selectedIndexes
          .map((index) => seriesWorkflowResult.seriesPlans[index])
          .filter(Boolean)
          .map((plan) => `${plan.sequence}. ${plan.title}`);
        setNotice({ type: "ok", msg: `${selected.length}개 시리즈 토픽이 포스팅 목록에 반영되었습니다.` });
        setSavedSeriesSummary({
          seriesId: seriesWorkflowResult.seriesId,
          mainKeyword: seriesWorkflowResult.reservedMainKeyword,
          topicIds: savedTopics.map((topic) => topic.topicId),
          titles: summaryTitles,
          savedAt: new Date().toISOString(),
          replacementTopicText: seriesWorkflowResult.replacementTopicText,
        });
        setUserFilter(generateUserId.trim().toLowerCase());
        setFilter("all");
      } else {
        setNotice({ type: "ok", msg: `${selected.length}개 토픽이 추가되었습니다.` });
        setSavedSeriesSummary(null);
      }
      setGenerateResult(null);
      setSeriesDetailResult(null);
      setSeriesWorkflowResult(null);
      setSelectedGenerated(new Set());
      setSelectedSeriesDetails(new Set());
      loadTopics();
    } catch (error) {
      setSavedSeriesSummary(null);
      setNotice({
        type: "err",
        msg:
          savedCount > 0
            ? `토픽 ${savedCount}개 저장 후 후속 처리 중 실패: ${error instanceof Error ? error.message : "저장 실패"}`
            : error instanceof Error
              ? error.message
              : "저장 실패",
      });
    } finally {
      setSavingGenerated(false);
    }
  };

  // ── 삭제 ───────────────────────────────────────────────
  const handleDelete = async (topicId: string, title: string) => {
    if (!confirm(`"${title}" 항목을 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/github/topics?topicId=${topicId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json() as { error: string };
        throw new Error(j.error);
      }
      setNotice({ type: "ok", msg: "삭제되었습니다." });
      loadTopics();
    } catch (e) {
      setNotice({ type: "err", msg: e instanceof Error ? e.message : "삭제 실패" });
    }
  };

  const handleDeleteSeries = async (seriesId: string, mainKeyword?: string | null) => {
    const label = mainKeyword?.trim() || seriesId;
    if (!confirm(`"${label}" 시리즈 전체를 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/github/topics?seriesId=${encodeURIComponent(seriesId)}`, { method: "DELETE" });
      const json = await res.json() as { error?: string; deletedCount?: number };
      if (!res.ok) {
        throw new Error(json.error ?? "시리즈 삭제 실패");
      }
      setNotice({
        type: "ok",
        msg: `${json.deletedCount ?? 0}개 시리즈 토픽이 삭제되었습니다.`,
      });
      loadTopics();
    } catch (e) {
      setNotice({ type: "err", msg: e instanceof Error ? e.message : "시리즈 삭제 실패" });
    }
  };

  // 필터 적용
  const filtered = (() => {
    if (filter === "remaining") return remaining;
    if (filter === "matched") return matched;
    if (filter === "all") return userScopedTopics;
    return userScopedTopics.filter((t) => t.status === filter);
  })();
  const highlightedTopicIds = new Set(savedSeriesSummary?.topicIds ?? []);
  const visibleTopics = [...filtered].sort((left, right) => {
    const leftHighlighted = highlightedTopicIds.has(left.topicId);
    const rightHighlighted = highlightedTopicIds.has(right.topicId);
    if (leftHighlighted && !rightHighlighted) return -1;
    if (!leftHighlighted && rightHighlighted) return 1;
    return 0;
  });

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">글목록</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            총 {planningTopics.length}개 · 남은 항목 {remaining.length}개 · 발행완료 {matched.length}개
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setNotice(null); }}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 개별 추가
        </button>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
        <label htmlFor="topic-user-filter" className="text-xs font-semibold text-zinc-600">
          사용자별 보기
        </label>
        <select
          id="topic-user-filter"
          value={userFilter}
          onChange={(event) => setUserFilter(event.target.value)}
          className="min-w-56 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="담당자별 글목록 보기"
        >
          <option value="all">전체 글목록 ({planningTopics.length})</option>
          <option value="unassigned">
            미지정 ({planningTopics.filter((topic) => !topic.assignedUserId).length})
          </option>
          {userOptions.map((user) => (
            <option key={user} value={user}>
              {user} ({planningTopics.filter((topic) => topic.assignedUserId?.trim().toLowerCase() === user).length})
            </option>
          ))}
        </select>
      </div>

      {notice && (
        <p className={`text-sm mb-4 ${notice.type === "ok" ? "text-emerald-600" : "text-red-500"}`}>
          {notice.msg}
        </p>
      )}

      {savedSeriesSummary && (
        <div ref={savedSeriesSummaryRef} className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <p className="text-sm font-semibold text-emerald-800">시리즈 저장 완료</p>
              <p className="text-xs text-emerald-700">
                {savedSeriesSummary.mainKeyword} · {savedSeriesSummary.titles.length}개 토픽이 저장되었습니다.
              </p>
            </div>
            <button
              onClick={() => setSavedSeriesSummary(null)}
              className="text-xs text-emerald-700 hover:text-emerald-900"
            >
              닫기
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {savedSeriesSummary.titles.map((title) => (
              <span
                key={title}
                className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-[11px] text-emerald-800"
              >
                {title}
              </span>
            ))}
          </div>
          {savedSeriesSummary.replacementTopicText && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2">
              <p className="text-[11px] font-semibold text-emerald-800 mb-1">포스팅 목록 반영용 전체 교체 텍스트</p>
              <pre className="whitespace-pre-wrap break-all text-[11px] text-zinc-700 font-mono">
                {savedSeriesSummary.replacementTopicText}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── 글목록 불러오기 ─────────────────────────────── */}
      <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-zinc-800 mb-0.5">글목록 불러오기</h2>
        <p className="text-xs text-zinc-400 mb-4">
          한 줄에 글제목 하나. &quot;A 블로그&quot; 같은 섹션 헤더는 자동으로 제외됩니다.
          저장하면 대기 상태 목록이 새 목록으로 교체됩니다 (진행 중/발행된 항목은 유지).
        </p>

        <div className="flex gap-1.5 mb-4">
          {(["text", "file"] as const).map((tab) => (
            <button key={tab} onClick={() => setImportTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${importTab === tab ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>
              {tab === "text" ? "텍스트 붙여넣기" : "파일 업로드"}
            </button>
          ))}
        </div>

        {importTab === "text" ? (
          <textarea
            value={pasteText}
            onChange={(e) => applyText(e.target.value)}
            placeholder={"서울 카페 베스트 10\n제주 여행 코스 추천\nA 블로그  ← 이런 줄은 자동 제외됩니다\n한강 공원 피크닉 가이드"}
            rows={7}
            className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
          />
        ) : (
          <div onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-zinc-200 rounded-lg p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
            <p className="text-sm text-zinc-500">TXT 파일 클릭하여 선택</p>
            <p className="text-xs text-zinc-400 mt-1">한 줄에 글제목 하나 · 인코딩 자동 감지 (UTF-8 / EUC-KR)</p>
            {pasteText && <p className="text-xs text-emerald-600 mt-2">파일 로드됨 — 유효 제목 {parsedCount}개</p>}
            <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={handleFile} />
          </div>
        )}

        {preview.length > 0 && (
          <div className="mt-3 bg-zinc-50 border border-zinc-100 rounded-lg p-3">
            <div className="flex items-center gap-3 mb-2">
              <p className="text-xs font-medium text-zinc-600">미리보기</p>
              <span className="text-xs text-emerald-600">파싱 {parsedCount}건</span>
              {duplicateCount > 0 && <span className="text-xs text-amber-600">중복 {duplicateCount}건</span>}
              {failedCount > 0 && <span className="text-xs text-red-500">실패 {failedCount}건</span>}
            </div>
            <div className="max-h-44 overflow-y-auto space-y-1">
              {preview.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 w-6 text-right shrink-0">{i + 1}</span>
                  {item.blog && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${BLOG_BADGE_COLORS[item.blog] ?? "bg-zinc-100 text-zinc-600"}`}>
                      {item.blog}
                    </span>
                  )}
                  <span className="text-sm text-zinc-700">{item.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={handleSave} disabled={preview.length === 0 || saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? "저장 중..." : preview.length > 0 ? `기존 목록 교체 저장 (${parsedCount}개)` : "기존 목록 교체 저장"}
          </button>
        </div>
      </div>

      {/* ── AI 새 글목록 생성 ───────────────────────────── */}
      <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-sm font-semibold text-zinc-800">{panelCopy.title}</h2>
          <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">{panelCopy.badge}</span>
        </div>
        <p className="text-xs text-zinc-400 mb-4">{panelCopy.description}</p>
        <div className="flex gap-1.5 mb-4">
            {([
              { value: "topics", label: "AI 글목록 생성" },
              { value: "preposting-series", label: "선행 포스팅 설계" },
              { value: "series-workflow", label: "시리즈물 선행포스팅 설계" },
              { value: "series-detail", label: "시리즈 상세 설계" },
            ] as const).map((mode) => (
            <button
              key={mode.value}
              onClick={() => {
                setGenerateMode(mode.value);
                setGenerateResult(null);
                setSeriesDetailResult(null);
                setSeriesWorkflowResult(null);
                setSelectedGenerated(new Set());
                setSelectedSeriesDetails(new Set());
                setNotice(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                generateMode === mode.value ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mb-2">
          <input
            value={generateUserId}
            onChange={(e) => setGenerateUserId(e.target.value)}
            placeholder={
              generateMode === "topics"
                ? "사용자 ID (예: user-a)"
                : generateMode === "preposting-series"
                  ? "시리즈를 만들 사용자 ID"
                  : generateMode === "series-workflow"
                    ? "시리즈 워크플로우를 설계할 사용자 ID"
                    : "상세 설계를 저장할 사용자 ID"
            }
            className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {(generateMode === "preposting-series" || generateMode === "series-detail") && (
            <>
              <input
                value={seriesMainKeyword}
                onChange={(e) => setSeriesMainKeyword(e.target.value)}
                placeholder={generateMode === "preposting-series" ? "시리즈 메인 키워드" : "상세 설계를 불러올 메인 키워드"}
                className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {generateMode === "preposting-series" && (
                <select
                  value={seriesPreludeCount}
                  onChange={(e) => setSeriesPreludeCount(Number(e.target.value))}
                  className="w-28 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label="선행 포스팅 개수"
                >
                  <option value={2}>선행 2개</option>
                  <option value={3}>선행 3개</option>
                </select>
              )}
            </>
          )}
          <button
            onClick={handleGenerate}
            disabled={
              generating ||
              !generateUserId.trim() ||
              ((generateMode === "preposting-series" || generateMode === "series-detail") && !seriesMainKeyword.trim()) ||
              (generateMode === "series-workflow" && !seriesMainKeyword.trim())
            }
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {generating ? "생성 중..." : panelCopy.actionLabel}
          </button>
        </div>
        {generateMode === "series-workflow" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
            <input
              value={seriesTargetTopic}
              onChange={(e) => setSeriesTargetTopic(e.target.value)}
              placeholder="본편 목표 주제"
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={seriesMainKeyword}
              onChange={(e) => setSeriesMainKeyword(e.target.value)}
              placeholder="본편 목표 키워드"
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={seriesRegion}
              onChange={(e) => setSeriesRegion(e.target.value)}
              placeholder="지역 키워드 (선택)"
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={seriesProductGroup}
              onChange={(e) => setSeriesProductGroup(e.target.value)}
              placeholder="제품군 (선택)"
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={seriesTargetUser}
              onChange={(e) => setSeriesTargetUser(e.target.value)}
              placeholder="타깃 사용자 (선택)"
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={seriesPreferredBlog}
              onChange={(e) => setSeriesPreferredBlog(e.target.value as "" | "A" | "B" | "C" | "D" | "E")}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="원하는 블로그"
            >
              <option value="">원하는 블로그 자동 추천</option>
              <option value="A">A 블로그 우선</option>
              <option value="B">B 블로그 우선</option>
              <option value="C">C 블로그 우선</option>
              <option value="D">D 블로그 우선</option>
              <option value="E">E 블로그 우선</option>
            </select>
          </div>
        )}
        <p className="text-[11px] text-zinc-400 mb-4">
          {generateMode === "topics"
            ? "사용자 ID만 입력하면 기존 발행 흐름을 바탕으로 새 글목록 후보를 생성합니다."
            : generateMode === "preposting-series"
              ? "메인 키워드와 선행 개수를 정하면 시리즈 토픽을 만들고, 저장 시 편별 상세 설계까지 자동으로 함께 저장합니다."
              : generateMode === "series-workflow"
                ? "본편 키워드를 예약한 뒤 예열글 3편, 본편 1편, 후속글 1편을 검색의도와 내부링크 흐름까지 포함해 설계합니다."
                : "이미 만든 시리즈 토픽을 기준으로 편별 목표, 키워드, 섹션, 내부링크 계획을 저장합니다."}
        </p>

        {generateResult && (
          <div className="space-y-3">
            <div className="text-xs text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2">
              <span className="font-medium">리서치 키워드:</span> {generateResult.researchKeyword} &nbsp;·&nbsp;
              {generateResult.competitionInfo}
            </div>
            {generateMode === "preposting-series" && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                저장 버튼을 누르면 시리즈 토픽 추가와 편별 상세 설계 저장까지 한 번에 진행됩니다.
              </div>
            )}
            <div className="space-y-2">
              {generateResult.generatedTopics.map((topic: GeneratedTopic, i: number) => (
                <div
                  key={i}
                  onClick={() => {
                    const next = new Set(selectedGenerated);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    setSelectedGenerated(next);
                  }}
                  className={`border rounded-lg px-4 py-3 cursor-pointer transition-colors ${
                    selectedGenerated.has(i)
                      ? "border-blue-400 bg-blue-50/50"
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                      selectedGenerated.has(i) ? "border-blue-500 bg-blue-500" : "border-zinc-300"
                    }`}>
                      {selectedGenerated.has(i) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900">{topic.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{topic.description}</p>
                      {topic.seriesId && (
                        <span className="inline-flex mt-1 mr-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          {topic.seriesRole === "main" ? "메인 글" : `선행 ${topic.sequenceOrder ?? ""}`}
                        </span>
                      )}
                      {topic.contentKind && (
                        <span className="inline-flex mt-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          {topic.contentKind === "hub" ? "허브글" : "리프글"}
                        </span>
                      )}
                      <p className="text-[10px] text-blue-500 mt-1 italic">{topic.rationale}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {topic.tags.map((tag: string) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-1">
              <p className="text-xs text-zinc-400">{selectedGenerated.size}개 선택됨</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setGenerateResult(null); setSelectedGenerated(new Set()); }}
                  className="px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveGenerated}
                  disabled={savingGenerated || selectedGenerated.size === 0}
                  className="px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingGenerated
                    ? "저장 중..."
                    : generateMode === "preposting-series"
                      ? `선택한 ${selectedGenerated.size}개 시리즈 저장`
                      : `선택한 ${selectedGenerated.size}개 추가`}
                </button>
              </div>
            </div>
          </div>
        )}

        {seriesWorkflowResult && (
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-blue-800">시리즈 요약</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  seriesWorkflowResult.keywordSafetyReport.cannibalizationRisk === "low"
                    ? "bg-emerald-100 text-emerald-700"
                    : seriesWorkflowResult.keywordSafetyReport.cannibalizationRisk === "medium"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"
                }`}>
                  키워드 충돌 위험 {RISK_LABELS[seriesWorkflowResult.keywordSafetyReport.cannibalizationRisk]}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  seriesWorkflowReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}>
                  {seriesWorkflowReady ? "확정 가능" : "재검토 필요"}
                </span>
              </div>
              <p className="text-sm font-medium text-zinc-900">{seriesWorkflowResult.targetTopic}</p>
              <p className="text-xs text-zinc-600 mt-1">
                예약된 본편 메인 키워드: <span className="font-medium">{seriesWorkflowResult.reservedMainKeyword}</span>
              </p>
              <p className="text-xs text-zinc-600 mt-1">{seriesWorkflowResult.seriesPurpose}</p>
              <p className="text-xs text-zinc-500 mt-1">내부링크 구조: {seriesWorkflowResult.internalLinkStructure}</p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold text-zinc-800 mb-2">키워드 충돌 리포트</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2">
                  <p className="text-zinc-500">본편 키워드</p>
                  <p className="font-medium text-zinc-900">{seriesWorkflowResult.keywordSafetyReport.reservedMainKeyword}</p>
                </div>
                <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2">
                  <p className="text-zinc-500">예열글 직접 사용</p>
                  <p className="font-medium text-zinc-900">{seriesWorkflowResult.keywordSafetyReport.exactMainKeywordUsedInPreheats}회</p>
                </div>
                <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2">
                  <p className="text-zinc-500">제목 시작 패턴 중복</p>
                  <p className="font-medium text-zinc-900">{seriesWorkflowResult.keywordSafetyReport.duplicateTitlePrefixCount}건</p>
                </div>
                <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2">
                  <p className="text-zinc-500">키워드 분산 점수</p>
                  <p className="font-medium text-zinc-900">{seriesWorkflowResult.keywordSafetyReport.keywordDistanceScore}점</p>
                </div>
              </div>
              {seriesWorkflowResult.keywordSafetyReport.recommendations.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-zinc-600 list-disc list-inside">
                  {seriesWorkflowResult.keywordSafetyReport.recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3">
              {seriesWorkflowResult.seriesPlans.map((plan, i) => {
                const isSelected = selectedGenerated.has(i);
                return (
                  <div
                    key={`${plan.role}-${plan.sequence}`}
                    onClick={() => {
                      const next = new Set(selectedGenerated);
                      if (next.has(i)) next.delete(i); else next.add(i);
                      setSelectedGenerated(next);
                    }}
                    className={`border rounded-xl px-4 py-4 cursor-pointer transition-colors ${
                      isSelected ? "border-blue-400 bg-blue-50/50" : "border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                        isSelected ? "border-blue-500 bg-blue-500" : "border-zinc-300"
                      }`}>
                        {isSelected && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white">
                            {plan.sequence}
                          </span>
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                            {SERIES_ROLE_LABELS[plan.role]}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            plan.hubLeafType === "hub" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"
                          }`}>
                            {plan.hubLeafType === "hub" ? "허브" : "리프"}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${BLOG_BADGE_COLORS[plan.recommendedBlog]}`}>
                            추천 블로그 {plan.recommendedBlog}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            plan.cannibalizationRisk === "low"
                              ? "bg-emerald-100 text-emerald-700"
                              : plan.cannibalizationRisk === "medium"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                          }`}>
                            충돌 위험 {RISK_LABELS[plan.cannibalizationRisk]}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">{plan.title}</p>
                          <p className="text-xs text-zinc-500 mt-1">{plan.purpose}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
                            <p className="text-zinc-500">메인 키워드</p>
                            <p className="font-medium text-zinc-900">{plan.mainKeyword}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
                            <p className="text-zinc-500">검색의도</p>
                            <p className="text-zinc-900">{plan.searchIntent}</p>
                          </div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                          <p className="text-zinc-500 mb-1">서브 키워드</p>
                          <div className="flex flex-wrap gap-1.5">
                            {plan.subKeywords.map((keyword) => (
                              <span key={keyword} className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                          <p className="text-zinc-500 mb-1">목차</p>
                          <ol className="space-y-1 list-decimal list-inside text-zinc-700">
                            {plan.outline.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ol>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
                            <p className="text-zinc-500">내부링크 방향</p>
                            <p className="text-zinc-900">{plan.internalLinkDirection}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
                            <p className="text-zinc-500">내부링크 문장</p>
                            <p className="text-zinc-900">{plan.internalLinkSentence}</p>
                          </div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                          <p className="text-zinc-500">위험 사유</p>
                          <p className="text-zinc-900">{plan.riskReason}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold text-zinc-800 mb-2">최종 검수 기준</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Object.entries(seriesWorkflowResult.validationChecklist).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-xs">
                    <span className="text-zinc-600">{CHECKLIST_LABELS[key as keyof SeriesValidationChecklist]}</span>
                    <span className={`font-medium ${value ? "text-emerald-600" : "text-red-500"}`}>
                      {value ? "통과" : "미통과"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold text-zinc-800 mb-1">포스팅 목록 반영 안내</p>
              <p className="text-xs text-zinc-600">
                이 시리즈 구성을 앞으로 작성될 글 목록에 반영할 수 있습니다. 저장 후에는 아래 전체 교체용 최신본 텍스트를 사용해 목록 파일을 교체하는 흐름을 기준으로 운영합니다.
              </p>
              <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-700 font-mono">
                {seriesWorkflowResult.replacementTopicText}
              </pre>
            </div>

            <div className="flex justify-between items-center pt-1">
              <p className="text-xs text-zinc-400">{selectedGenerated.size}개 선택됨</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setSeriesWorkflowResult(null); setSelectedGenerated(new Set()); }}
                  className="px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveGenerated}
                  disabled={savingGenerated || selectedGenerated.size === 0 || !seriesWorkflowReady}
                  className="px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingGenerated ? "저장 중..." : `선택한 ${selectedGenerated.size}개 시리즈 저장`}
                </button>
              </div>
            </div>
          </div>
        )}

        {seriesDetailResult && (
          <div className="space-y-3">
            <div className="text-xs text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2">
              <span className="font-medium">메인 키워드:</span> {seriesDetailResult.mainKeyword} &nbsp;·&nbsp;
              <span className="font-medium">시리즈:</span> {seriesDetailResult.seriesId}
            </div>
            <div className="space-y-2">
              {seriesDetailResult.plannedTopics.map((item, i) => (
                <div
                  key={item.topicId}
                  onClick={() => {
                    const next = new Set(selectedSeriesDetails);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    setSelectedSeriesDetails(next);
                  }}
                  className={`border rounded-lg px-4 py-3 cursor-pointer transition-colors ${
                    selectedSeriesDetails.has(i)
                      ? "border-amber-400 bg-amber-50/50"
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                      selectedSeriesDetails.has(i) ? "border-amber-500 bg-amber-500" : "border-zinc-300"
                    }`}>
                      {selectedSeriesDetails.has(i) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900">{item.title}</p>
                      <p className="text-[10px] text-amber-700 mt-0.5">
                        {item.seriesRole === "main" ? "메인 글" : `선행 ${item.sequenceOrder}`} · {item.detailPlan.searchIntent}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">{item.detailPlan.articleGoal}</p>
                      <p className="text-xs text-zinc-500 mt-1">질문: {item.detailPlan.readerQuestion}</p>
                      <p className="text-xs text-zinc-500 mt-1">섹션: {item.detailPlan.recommendedSections.join(" / ")}</p>
                      <p className="text-xs text-zinc-500 mt-1">내부링크: {item.detailPlan.internalLinkTitles.join(" / ") || "없음"}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-1">
              <p className="text-xs text-zinc-400">{selectedSeriesDetails.size}개 선택됨</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setSeriesDetailResult(null); setSelectedSeriesDetails(new Set()); }}
                  className="px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveSeriesDetails}
                  disabled={savingGenerated || selectedSeriesDetails.size === 0}
                  className="px-4 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingGenerated ? "저장 중..." : `선택한 ${selectedSeriesDetails.size}개 상세 설계 저장`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 필터 ─────────────────────────────────────── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          { value: "all", label: `전체 (${planningTopics.length})` },
          { value: "remaining", label: `남은 항목 (${remaining.length})` },
          { value: "matched", label: `발행완료 (${matched.length})` },
          { value: "in-progress", label: `진행 중 (${planningTopics.filter((t) => t.status === "in-progress").length})` },
        ] as const).map(({ value, label }) => (
          <button key={value} onClick={() => setFilter(value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${filter === value ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-zinc-400 text-sm">로딩 중...</p>
      ) : visibleTopics.length === 0 ? (
        <div className="text-center py-14 text-zinc-400">
          <p className="text-sm">글목록이 없습니다.</p>
          <p className="text-xs mt-1">위에서 글목록을 붙여넣거나 파일을 업로드해 주세요.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleTopics.map((topic, idx) => (
            <div key={topic.topicId}>
              {editing?.topicId === topic.topicId ? (
                <div className="bg-white border-2 border-blue-300 rounded-xl p-4 space-y-4">
                  {/* ── 기본 정보 ── */}
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">글제목</label>
                      <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                        className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">담당자 ID</label>
                        <input value={editing.assignedUserId}
                          onChange={(e) => setEditing({ ...editing, assignedUserId: e.target.value })}
                          placeholder="없음"
                          className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">상태</label>
                        <select value={editing.status}
                          onChange={(e) => setEditing({ ...editing, status: e.target.value as Topic["status"] })}
                          className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                          {Object.entries(STATUS_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* ── 시리즈 상세 설계 ── */}
                  {editing.hasSeries && editing.seriesDetailPlan && (() => {
                    const dp = editing.seriesDetailPlan;
                    const setDp = (patch: Partial<EditSeriesDetailState>) =>
                      setEditing({ ...editing, seriesDetailPlan: { ...dp, ...patch } });
                    return (
                      <div className="border-t border-zinc-100 pt-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-amber-700">시리즈 상세 설계</p>
                          <button
                            type="button"
                            onClick={handleRegenerateSeriesDetail}
                            disabled={regenerating || !dp.primaryKeyword.trim()}
                            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {regenerating ? (
                              <>
                                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                                생성 중...
                              </>
                            ) : "핵심·보조 키워드 기준으로 나머지 AI 재생성"}
                          </button>
                        </div>
                        <p className="text-[10px] text-zinc-400">핵심 키워드와 보조 키워드를 먼저 입력한 뒤 재생성하면 검색의도·섹션구조 등 나머지 항목을 자동으로 채웁니다.</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-zinc-500 mb-1">핵심 키워드</label>
                            <input value={dp.primaryKeyword} onChange={(e) => setDp({ primaryKeyword: e.target.value })}
                              placeholder="예: 전자담배 입문"
                              className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-500 mb-1">보조 키워드 (쉼표 구분)</label>
                            <input value={dp.secondaryKeywords} onChange={(e) => setDp({ secondaryKeywords: e.target.value })}
                              placeholder="예: 입호흡, 액상형, 초보"
                              className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">검색 의도</label>
                          <input value={dp.searchIntent} onChange={(e) => setDp({ searchIntent: e.target.value })}
                            placeholder="예: how-to"
                            className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">글 목표</label>
                          <input value={dp.articleGoal} onChange={(e) => setDp({ articleGoal: e.target.value })}
                            placeholder="이 글이 독자에게 달성해야 할 목표"
                            className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">독자 질문</label>
                          <input value={dp.readerQuestion} onChange={(e) => setDp({ readerQuestion: e.target.value })}
                            placeholder="독자가 검색창에 실제로 떠올리는 질문"
                            className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">섹션 구조 (한 줄 = 섹션 1개)</label>
                          <textarea value={dp.recommendedSections} onChange={(e) => setDp({ recommendedSections: e.target.value })}
                            rows={3} placeholder={"섹션 1\n섹션 2\n섹션 3"}
                            className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">키워드 배치 규칙 (한 줄 = 규칙 1개)</label>
                          <textarea value={dp.keywordPlacementRules} onChange={(e) => setDp({ keywordPlacementRules: e.target.value })}
                            rows={2} placeholder={"도입부 1문단 내 메인 키워드 1회\n소제목에 보조 키워드 포함"}
                            className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">내부링크 대상 글제목 (한 줄 = 1개)</label>
                          <textarea value={dp.internalLinkTitles} onChange={(e) => setDp({ internalLinkTitles: e.target.value })}
                            rows={2} placeholder={"2025 입호흡 전자담배 추천 TOP5\n전자담배 액상 고르는 법"}
                            className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">작성 각도 (draftAngle)</label>
                          <input value={dp.draftAngle} onChange={(e) => setDp({ draftAngle: e.target.value })}
                            placeholder="예: 처음 전자담배를 접하는 독자 관점에서 쉽게 설명"
                            className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">CTA (callToAction)</label>
                          <input value={dp.callToAction} onChange={(e) => setDp({ callToAction: e.target.value })}
                            placeholder="예: 다음 글에서 구체적인 기기를 비교해드릴게요"
                            className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex gap-2 justify-end pt-1">
                    <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900">취소</button>
                    <button onClick={handleSaveEdit} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">저장</button>
                  </div>
                </div>
              ) : (
                <div className={`bg-white border rounded-lg px-4 py-3 flex items-center gap-3 ${
                  highlightedTopicIds.has(topic.topicId)
                    ? "border-emerald-300 ring-2 ring-emerald-100"
                    : "border-zinc-200"
                }`}>
                  <span className="text-xs text-zinc-400 w-6 text-right shrink-0">{idx + 1}</span>
                  {(() => {
                    const code = resolveTopicBadgeCode(topic);
                    return code ? (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${BLOG_BADGE_COLORS[code] ?? "bg-zinc-100 text-zinc-600"}`}>
                        {code}
                      </span>
                    ) : null;
                  })()}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${remainingIds.has(topic.topicId) ? "text-zinc-900" : "text-zinc-400"}`}>
                      {topic.title}
                    </p>
                    {topic.assignedUserId && (
                      <p className="text-xs text-zinc-400 mt-0.5">담당: {topic.assignedUserId}</p>
                    )}
                    {topic.contentKind && (
                      <p className="text-xs text-blue-500 mt-0.5">
                        {topic.contentKind === "hub" ? "허브글" : "리프글"}
                      </p>
                    )}
                    {topic.seriesId && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        선행 설계 · {topic.seriesRole === "main" ? "메인 글" : `선행 ${topic.sequenceOrder ?? ""}`} · {topic.targetMainKeyword}
                      </p>
                    )}
                    {topic.seriesDetailPlan && (
                      <p className="text-xs text-emerald-600 mt-0.5">
                        상세 설계 완료 · {topic.seriesDetailPlan.searchIntent} · 핵심키워드 {topic.seriesDetailPlan.primaryKeyword}
                      </p>
                    )}
                    {!topic.contentKind && (
                      <p className="text-xs text-zinc-400 mt-0.5">미분류</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* 교차체크 뱃지 */}
                    {remainingIds.has(topic.topicId) ? (
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-sky-100 text-sky-700">대기</span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700">발행완료</span>
                    )}
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[topic.status]}`}>
                      {STATUS_LABELS[topic.status]}
                    </span>
                    {topic.seriesId && (
                      <button
                        onClick={() => handleDeleteSeries(topic.seriesId!, topic.targetMainKeyword ?? topic.title)}
                        className="text-xs text-zinc-400 hover:text-red-500 px-1"
                        disabled={topic.status === "in-progress" || topic.status === "published"}
                      >
                        시리즈 삭제
                      </button>
                    )}
                    <button onClick={() => { startEdit(topic); setNotice(null); }}
                      className="text-xs text-zinc-400 hover:text-zinc-700 px-1">수정</button>
                    <button onClick={() => handleDelete(topic.topicId, topic.title)}
                      className="text-xs text-zinc-400 hover:text-red-500 px-1"
                      disabled={topic.status === "in-progress"}>삭제</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 단일 추가 모달 ──────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-zinc-900 mb-4">글제목 추가</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">글제목 *</label>
                <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)}
                  placeholder="글제목을 입력하세요"
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">담당자 ID</label>
                <input value={addUserId} onChange={(e) => setAddUserId(e.target.value)}
                  placeholder="없으면 비워두세요"
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => { setShowAdd(false); setAddTitle(""); setAddUserId(""); }}
                className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900">취소</button>
              <button onClick={handleAdd} disabled={!addTitle.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
