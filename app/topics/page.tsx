"use client";

import { useEffect, useRef, useState } from "react";
import type { Topic, PostingRecord } from "@/lib/types/github-data";
import { parseTopicText, readFileAutoEncoding } from "@/lib/skills/import-parser";
import { resolveRemainingTopics } from "@/lib/skills/remaining-topic-resolver";
import { blogCode, userIdToBlogCode } from "@/lib/utils/blog-code";
import type { GeneratedTopic, TopicGeneratorOutput } from "@/lib/agents/topic-generator";

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

interface EditTopicState {
  topicId: string;
  title: string;
  assignedUserId: string;
  status: Topic["status"];
}

function resolveTopicBadgeCode(topic: Topic): string | null {
  return blogCode(topic.category) ?? (topic.assignedUserId ? userIdToBlogCode(topic.assignedUserId) : null);
}

function getGeneratePanelCopy(mode: "topics" | "preposting-series" | "series-detail"): {
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

  // 단일 추가
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addUserId, setAddUserId] = useState("");

  // AI 글목록 생성
  const [generateMode, setGenerateMode] = useState<"topics" | "preposting-series" | "series-detail">("topics");
  const [generateUserId, setGenerateUserId] = useState("");
  const [seriesMainKeyword, setSeriesMainKeyword] = useState("");
  const [seriesPreludeCount, setSeriesPreludeCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<TopicGeneratorOutput | null>(null);
  const [seriesDetailResult, setSeriesDetailResult] = useState<SeriesDetailPreviewResult | null>(null);
  const [selectedGenerated, setSelectedGenerated] = useState<Set<number>>(new Set());
  const [selectedSeriesDetails, setSelectedSeriesDetails] = useState<Set<number>>(new Set());
  const [savingGenerated, setSavingGenerated] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const panelCopy = getGeneratePanelCopy(generateMode);

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
  const startEdit = (t: Topic) =>
    setEditing({ topicId: t.topicId, title: t.title, assignedUserId: t.assignedUserId ?? "", status: t.status });

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      const res = await fetch("/api/github/topics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: editing.topicId,
          title: editing.title,
          assignedUserId: editing.assignedUserId.trim().toLowerCase() || null,
          status: editing.status,
        }),
      });
      if (!res.ok) throw new Error();
      setEditing(null);
      setNotice({ type: "ok", msg: "수정되었습니다." });
      loadTopics();
    } catch {
      setNotice({ type: "err", msg: "수정 실패" });
    }
  };

  // ── AI 글목록 생성 ─────────────────────────────────────
  const handleGenerate = async () => {
    if (!generateUserId.trim()) return;
    if (generateMode !== "topics" && !seriesMainKeyword.trim()) return;
    setGenerating(true);
    setGenerateResult(null);
    setSeriesDetailResult(null);
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
  }) => {
    const res = await fetch("/api/topics/series-detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: params.userId,
        mainKeyword: params.mainKeyword,
        seriesId: params.seriesId,
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
    if (!generateResult || selectedGenerated.size === 0) return;
    setSavingGenerated(true);
    setNotice(null);
    let savedCount = 0;
    try {
      const selected = generateResult.generatedTopics.filter((_, i) => selectedGenerated.has(i));
      for (const topic of selected) {
        await fetch("/api/github/topics", {
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
        savedCount += 1;
      }

      if (generateMode === "preposting-series") {
        const seriesId = selected.find((topic) => topic.seriesId)?.seriesId;
        const detailResult = await saveSeriesDetailsForSeries({
          userId: generateUserId.trim(),
          mainKeyword: seriesMainKeyword.trim(),
          seriesId,
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
      } else {
        setNotice({ type: "ok", msg: `${selected.length}개 토픽이 추가되었습니다.` });
        setSavedSeriesSummary(null);
      }
      setGenerateResult(null);
      setSeriesDetailResult(null);
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
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
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
            ] as const).map((mode) => (
            <button
              key={mode.value}
              onClick={() => {
                setGenerateMode(mode.value);
                setGenerateResult(null);
                setSeriesDetailResult(null);
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
                  : "상세 설계를 저장할 사용자 ID"
            }
            className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {generateMode !== "topics" && (
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
            disabled={generating || !generateUserId.trim() || (generateMode !== "topics" && !seriesMainKeyword.trim())}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {generating ? "생성 중..." : panelCopy.actionLabel}
          </button>
        </div>
        <p className="text-[11px] text-zinc-400 mb-4">
          {generateMode === "topics"
            ? "사용자 ID만 입력하면 기존 발행 흐름을 바탕으로 새 글목록 후보를 생성합니다."
            : generateMode === "preposting-series"
              ? "메인 키워드와 선행 개수를 정하면 시리즈 토픽을 만들고, 저장 시 편별 상세 설계까지 자동으로 함께 저장합니다."
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
                <div className="bg-white border-2 border-blue-300 rounded-xl p-4">
                  <div className="grid grid-cols-1 gap-3 mb-3">
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
                  <div className="flex gap-2 justify-end">
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
