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

const AUTO_DRAFT_MARKER_2 = "\n\n---\n\n[자동 보강본 2차]\n";
const AUTO_DRAFT_MARKER_3 = "\n\n---\n\n[자동 보강본 3차]\n";

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
  for (const note of reviewResult?.naverLogicNotes ?? []) guides.push(`네이버 로직: ${note}`);

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
    { label: "자동 보강본 2차", badge: "2차", body: secondBody },
    { label: "자동 보강본 3차", badge: "3차", body: thirdBody },
  ];
}

function columnStatusText(column: DraftColumn, hasAnyDraft: boolean): string {
  if (column.body) return "작성 완료";
  return hasAnyDraft ? "생성 대기" : "초안 생성 대기";
}

function summarizeKeywordRow(keywordReport: KeywordUsageReport): string {
  return keywordReport.items
    .slice(0, 4)
    .map((item) => `${item.keyword} ${item.count}회`)
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
              초안과 수정본을 한 화면에서 비교하면서 실제로 다듬는 작업 공간입니다.
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
            <p className="text-sm font-semibold text-zinc-700">본문이 여기에 표시됩니다</p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              글쓰기를 시작하면 1차 초안이 먼저 나오고, 실제로 점수가 낮거나 키워드 반복 위험이 높을 때만
              자동 보강본이 이어집니다. 보강본은 이전 초안의 문제를 줄이는 방향으로만 작성됩니다.
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
                    각 버전은 본문, 키워드 반복, SEO 점수를 따로 계산해 보여줍니다. 2차와 3차는 무조건 쓰는 게
                    아니라 실제 개선이 있을 때만 이어집니다.
                  </p>
                </div>

                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
                                {hasAnyDraft
                                  ? "이 버전은 아직 생성되지 않았습니다."
                                  : "초안 생성을 시작하면 버전별 본문이 여기에 표시됩니다."}
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
                              {versionReport.keywordReport.items.map((item) => (
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
                      키워드 과다, 문단 길이, 구조 보완처럼 바로 수정하고 싶은 점이 있다면 적어 주세요.
                      자동 보강본이 다시 작성될 때 이 요청을 우선 반영합니다.
                    </p>
                    <div className="mt-3 space-y-3">
                      <textarea
                        value={revisionRequest}
                        onChange={(event) => onRevisionRequestChange(event.target.value)}
                        className="min-h-28 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="예: 메인 키워드 반복을 줄이고, 선택 기준 문단을 더 구체적으로 써 주세요."
                      />
                      <button
                        type="button"
                        onClick={onRunDraftPolish}
                        disabled={reviewSaving || !revisionRequest.trim()}
                        className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {reviewSaving ? "보강 반영 중" : "보강 요청 반영 후 계속"}
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
                    초안 본문은 아직 스트리밍 영역에 남아 있지 않습니다. 다시 글쓰기를 실행하면 이곳에 1차 초안과
                    자동 보강본이 버전별로 표시됩니다.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-h-[34rem] rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
                <p className="text-sm text-zinc-500">초안 생성을 시작하면 1차 초안과 보강본이 이곳에 표시됩니다.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold text-zinc-500">수정본 편집기</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                실제 발행할 제목과 본문을 기준으로 다시 검토합니다. 아래에서 직접 수정하거나 자동 검토 결과를 반영할 수 있습니다.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">실제 제목</label>
                <input
                  value={reviewTitle}
                  onChange={(event) => onReviewTitleChange(event.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="최종 발행 제목"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600">실제 본문</label>
                <textarea
                  value={reviewBody}
                  onChange={(event) => onReviewBodyChange(event.target.value)}
                  className="min-h-[18rem] w-full rounded-lg border border-zinc-200 px-3 py-3 text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="실제 발행 본문"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={onRunDraftReview}
                  disabled={reviewSaving || !reviewBody.trim()}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {reviewSaving ? "검토 중" : "수정본 검토 실행"}
                </button>
                <button
                  type="button"
                  onClick={onApplyReviewedDraft}
                  disabled={!reviewEditorBody.trim()}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40"
                >
                  검토 반영본을 편집기에 적용
                </button>
              </div>
            </div>

            {revisionGuides.length > 0 && (
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="mb-3 text-xs font-semibold text-zinc-600">검토 반영 가이드</p>
                <ul className="space-y-1 text-sm text-zinc-700">
                  {revisionGuides.map((guide) => (
                    <li key={guide} className="flex gap-2">
                      <span className="text-zinc-400">-</span>
                      <span>{guide}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(reviewEditorTitle || reviewEditorBody) && (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold text-zinc-600">검토 반영 초안</p>
                <input
                  value={reviewEditorTitle}
                  onChange={(event) => onReviewedTitleChange(event.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="검토 반영 제목"
                />
                <textarea
                  value={reviewEditorBody}
                  onChange={(event) => onReviewedBodyChange(event.target.value)}
                  className="min-h-[20rem] w-full rounded-lg border border-zinc-200 px-3 py-3 text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="검토 반영 본문"
                />
                {reviewApplied && (
                  <p className="text-xs text-emerald-600">검토 결과가 편집기에 반영되었습니다.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
