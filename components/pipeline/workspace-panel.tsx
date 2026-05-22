"use client";

import type { SSEEvent } from "@/lib/agents/types";
import type { DraftReviewIssue, DraftReviewResult } from "@/lib/agents/draft-review";
import type { KeywordUsageReport, SeoEvaluation } from "@/lib/agents/types";

interface Props {
  contentTab: "draft" | "revision";
  setContentTab: (tab: "draft" | "revision") => void;
  runningTitle: string | null;
  events: SSEEvent[];
  streamingBody: string;
  result: {
    title: string;
    wordCount: number;
  } | null;
  reviewTitle: string;
  reviewBody: string;
  revisionRequest: string;
  reviewedTitle: string;
  reviewedBody: string;
  reviewSaving: boolean;
  reviewApplied: boolean;
  reviewResult: DraftReviewResult | null;
  reviewIssues: DraftReviewIssue[];
  draftVersionReports: Array<{
    label: string;
    body: string;
    seoEvaluation: SeoEvaluation;
    keywordReport: KeywordUsageReport;
  }>;
  onReviewTitleChange: (value: string) => void;
  onReviewBodyChange: (value: string) => void;
  onRevisionRequestChange: (value: string) => void;
  onReviewedTitleChange: (value: string) => void;
  onReviewedBodyChange: (value: string) => void;
  onRunDraftReview: () => void;
  onRunDraftPolish: () => void;
  onApplyReviewedDraft: () => void;
}

interface DraftColumn {
  label: string;
  badge: string;
  body: string;
}

const AUTO_DRAFT_MARKER_2 = "\n\n---\n\n[2차 초안]\n";
const AUTO_DRAFT_MARKER_3 = "\n\n---\n\n[3차 초안]\n";

function keywordStatusTone(status: KeywordUsageReport["items"][number]["status"]): string {
  if (status === "ok") return "text-emerald-600";
  if (status === "caution") return "text-amber-600";
  if (status === "danger") return "text-red-500";
  return "text-blue-600";
}

function statusLabel(status: KeywordUsageReport["items"][number]["status"]): string {
  if (status === "ok") return "적정";
  if (status === "caution") return "주의";
  if (status === "danger") return "위험";
  return "부족";
}

function buildRevisionGuides(reviewResult: DraftReviewResult | null, reviewIssues: DraftReviewIssue[]): string[] {
  const guides: string[] = [];

  for (const issue of reviewIssues) guides.push(issue.message);
  for (const item of reviewResult?.keywordReport.items ?? []) {
    if (item.status !== "ok") guides.push(`${item.keyword}: ${item.recommendation}`);
  }
  for (const note of reviewResult?.seoNotes ?? []) guides.push(`SEO: ${note}`);
  for (const note of reviewResult?.naverLogicNotes ?? []) guides.push(`\uB124\uC774\uBC84 \uB85C\uC9C1: ${note}`);

  return Array.from(new Set(guides)).slice(0, 10);
}

function parseDraftColumns(streamingBody: string): DraftColumn[] {
  const normalized = streamingBody.replace(/\r\n/g, "\n");
  const secondMarkerIndex = normalized.indexOf(AUTO_DRAFT_MARKER_2);
  const thirdMarkerIndex = normalized.indexOf(AUTO_DRAFT_MARKER_3);

  const firstBody = (secondMarkerIndex >= 0 ? normalized.slice(0, secondMarkerIndex) : normalized).trim();
  const secondBody =
    secondMarkerIndex >= 0
      ? normalized
          .slice(secondMarkerIndex + AUTO_DRAFT_MARKER_2.length, thirdMarkerIndex >= 0 ? thirdMarkerIndex : undefined)
          .trim()
      : "";
  const thirdBody =
    thirdMarkerIndex >= 0 ? normalized.slice(thirdMarkerIndex + AUTO_DRAFT_MARKER_3.length).trim() : "";

  return [
    { label: "1차 초안", badge: "1차", body: firstBody },
    { label: "2차 초안", badge: "2차", body: secondBody },
    { label: "3차 초안", badge: "3차", body: thirdBody },
  ];
}

function columnStatusText(column: DraftColumn, hasAnyDraft: boolean): string {
  if (column.body) return "작성 완료";
  return hasAnyDraft ? "생성 대기" : "초안 생성 대기";
}

function summarizeKeywordRow(keywordReport: KeywordUsageReport): string {
  return keywordReport.items
    .filter((item) => item.role !== "forbidden" || item.count > 0)
    .slice(0, 4)
    .map((item) => `${item.keyword} 본문 ${item.count}회`)
    .join(" · ");
}

export function PipelineWorkspacePanel({
  contentTab,
  setContentTab,
  runningTitle,
  events,
  streamingBody,
  result,
  reviewTitle,
  reviewBody,
  revisionRequest,
  reviewedTitle,
  reviewedBody,
  reviewSaving,
  reviewApplied,
  reviewResult,
  reviewIssues,
  draftVersionReports,
  onReviewTitleChange,
  onReviewBodyChange,
  onRevisionRequestChange,
  onReviewedTitleChange,
  onReviewedBodyChange,
  onRunDraftReview,
  onRunDraftPolish,
  onApplyReviewedDraft,
}: Props) {
  const hasCenterContent = Boolean(streamingBody || result || reviewResult || events.length);
  const draftColumns = parseDraftColumns(streamingBody);
  const hasAnyDraft = draftColumns.some((column) => column.body);
  const lastCompletedIndex = Math.max(...draftColumns.map((column, index) => (column.body ? index : -1)));
  const reviewEditorTitle = reviewedTitle || reviewTitle;
  const reviewEditorBody = reviewedBody || reviewBody;
  const revisionGuides = buildRevisionGuides(reviewResult, reviewIssues);
  const hasDraftToPolish = Boolean(result?.title && hasAnyDraft);

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900">본문 작업 영역</p>
            <p className="mt-1 text-xs text-zinc-500">
              초안 단계와 수정본을 같은 화면에서 비교하며 이어서 작업합니다.
            </p>
          </div>
          <div className="inline-flex rounded-lg bg-zinc-100 p-1">
            <button
              type="button"
              onClick={() => setContentTab("draft")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                contentTab === "draft" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
              }`}
            >
              초안
            </button>
            <button
              type="button"
              onClick={() => setContentTab("revision")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                contentTab === "revision" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
              }`}
            >
              수정본
            </button>
          </div>
        </div>
      </div>

      <div className="p-5">
        {!hasCenterContent ? (
          <div className="flex min-h-[42rem] flex-col justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10">
            <p className="text-sm font-semibold text-zinc-700">본문이 여기에 표시됩니다.</p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              글쓰기를 시작하면 1차 초안이 표시되고, 평가 결과상 보강이 필요할 때만 2차와 3차 초안이 추가됩니다.
            </p>
          </div>
        ) : contentTab === "draft" ? (
          <div className="space-y-4">
            {runningTitle && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="text-xs font-semibold text-zinc-500">현재 작업 제목</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{runningTitle}</p>
              </div>
            )}

            {hasAnyDraft ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <p className="text-xs font-semibold text-blue-700">초안 비교 보기</p>
                  <p className="mt-1 text-xs leading-5 text-blue-600">
                    보강 초안은 이전 평가에서 실제 문제가 있을 때만 생성됩니다. 각 초안 아래에서 해당 본문 기준 키워드 수와 SEO 점수를 확인할 수 있습니다.
                  </p>
                </div>

                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.05fr)_minmax(0,1.05fr)]">
                  {draftColumns.map((column, index) => {
                    const isLatest = index === lastCompletedIndex && Boolean(column.body);
                    const versionReport = draftVersionReports.find((item) => item.label === column.label);

                    return (
                      <section
                        key={column.label}
                        className={`min-w-0 overflow-hidden rounded-xl border ${
                          isLatest ? "border-blue-300 bg-blue-50/40" : "border-zinc-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  isLatest ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"
                                }`}
                              >
                                {column.badge}
                              </span>
                              <p className="truncate text-sm font-semibold text-zinc-900">{column.label}</p>
                            </div>
                            <p className="mt-1 text-[11px] text-zinc-500">{columnStatusText(column, hasAnyDraft)}</p>
                          </div>
                          <span className="shrink-0 text-[11px] text-zinc-400">{column.body.length.toLocaleString()}자</span>
                        </div>

                        <div className="min-h-[38rem] max-h-[calc(100vh-12rem)] overflow-y-auto bg-zinc-950 px-5 py-4">
                          {column.body ? (
                            <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.95] text-white">
                              {column.body}
                            </pre>
                          ) : (
                            <div className="flex min-h-[32rem] items-center justify-center text-center">
                              <p className="max-w-xs text-sm leading-6 text-zinc-400">
                                {hasAnyDraft ? "이 단계의 초안은 아직 생성되지 않았습니다." : "초안 생성을 시작하면 본문이 표시됩니다."}
                              </p>
                            </div>
                          )}
                        </div>

                        {versionReport && (
                          <div className="space-y-3 border-t border-zinc-100 bg-white px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-semibold text-zinc-700">{column.label} 키워드 요약</p>
                              <p className="text-[11px] text-zinc-500">SEO {versionReport.seoEvaluation.score}점</p>
                            </div>
                            <p className="text-[11px] leading-5 text-zinc-500">
                              {summarizeKeywordRow(versionReport.keywordReport)}
                            </p>
                            <div className="space-y-2">
                              {versionReport.keywordReport.items
                                .filter((item) => item.role !== "forbidden" || item.count > 0)
                                .map((item) => (
                                <div
                                  key={`${column.label}-${item.keyword}`}
                                  className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-semibold text-zinc-800">{item.keyword}</p>
                                    <p className={`text-[11px] font-semibold ${keywordStatusTone(item.status)}`}>
                                      본문 {item.count}회 · {statusLabel(item.status)}
                                    </p>
                                  </div>
                                  <p className="mt-1 text-[11px] text-zinc-500">
                                    적정 범위 {item.targetMin}~{item.targetMax}회
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>

                {hasDraftToPolish && (
                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    <p className="text-sm font-semibold text-zinc-900">보강 방향 직접 요청</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      키워드 반복, 정보 충실도, 구조 보강처럼 바로 수정하고 싶은 점이 있으면 적어 주세요.
                    </p>
                    <div className="mt-3 space-y-3">
                      <textarea
                        value={revisionRequest}
                        onChange={(event) => onRevisionRequestChange(event.target.value)}
                        className="min-h-28 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="예: 메인 키워드 반복을 줄이고, 비교 기준 문단을 더 짧고 선명하게 정리해 주세요."
                      />
                      <button
                        type="button"
                        onClick={onRunDraftPolish}
                        disabled={reviewSaving || !revisionRequest.trim()}
                        className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {reviewSaving ? "보강본 작성 중..." : "요청 반영 보강본 작성"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : result ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-xs font-semibold text-zinc-500">완료된 초안 제목</p>
                  <p className="mt-1 text-base font-semibold text-zinc-900">{result.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{result.wordCount.toLocaleString()}자</p>
                </div>
                <div className="min-h-[34rem] rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-6">
                  <p className="text-sm leading-6 text-zinc-500">
                    초안 본문은 아직 스트리밍 영역에 표시되지 않았습니다. 다시 글쓰기 화면을 열면 본문과 보강본이 함께 표시됩니다.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-h-[34rem] rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
                <p className="text-sm text-zinc-500">초안 생성이 시작되면 1차 초안과 보강본이 표시됩니다.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold text-zinc-500">수정본 검토</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                실제 작성한 제목과 본문을 넣으면 본문 기준 키워드 수, SEO, 네이버 로직을 다시 검토합니다.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">실제 제목</label>
                <input
                  value={reviewTitle}
                  onChange={(event) => onReviewTitleChange(event.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="최종 작성 제목"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">실제 본문</label>
                <textarea
                  value={reviewBody}
                  onChange={(event) => onReviewBodyChange(event.target.value)}
                  className="min-h-[18rem] w-full rounded-lg border border-zinc-200 px-3 py-3 text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="실제 작성한 본문"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={onRunDraftReview}
                  disabled={reviewSaving || !reviewTitle.trim() || !reviewBody.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {reviewSaving ? "검토 중..." : "수정본 검토"}
                </button>
                <button
                  type="button"
                  onClick={onApplyReviewedDraft}
                  disabled={!reviewedTitle.trim() || !reviewedBody.trim()}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {reviewApplied ? "실제 본문 반영됨" : "실제 본문으로 반영"}
                </button>
              </div>
            </div>

            {revisionGuides.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">검토 결과 보강 필요</p>
                <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-800">
                  {revisionGuides.map((guide) => (
                    <li key={guide}>- {guide}</li>
                  ))}
                </ul>
              </div>
            )}

            {reviewedBody && (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600">검토 후 제목</label>
                  <input
                    value={reviewEditorTitle}
                    onChange={(event) => onReviewedTitleChange(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600">검토 후 본문</label>
                  <textarea
                    value={reviewEditorBody}
                    onChange={(event) => onReviewedBodyChange(event.target.value)}
                    className="min-h-[24rem] w-full rounded-lg border border-zinc-200 px-3 py-3 text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
