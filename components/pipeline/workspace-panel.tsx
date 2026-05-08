"use client";

import type { DraftReviewIssue, DraftReviewResult } from "@/lib/agents/draft-review";
import type { SSEEvent } from "@/lib/agents/types";

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

const AUTO_DRAFT_MARKER_2 = "\n\n---\n\n[자동 보강본]\n";
const AUTO_DRAFT_MARKER_3 = "\n\n---\n\n[자동 보강본 2차]\n";

function issueTone(severity: DraftReviewIssue["severity"]): string {
  if (severity === "blocker") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function buildRevisionGuides(reviewResult: DraftReviewResult | null, reviewIssues: DraftReviewIssue[]): string[] {
  const guides: string[] = [];

  for (const issue of reviewIssues) {
    guides.push(issue.message);
  }

  for (const item of reviewResult?.keywordReport.items ?? []) {
    if (item.status !== "적정") {
      guides.push(`${item.keyword}: ${item.recommendation}`);
    }
  }

  for (const note of reviewResult?.seoNotes ?? []) {
    guides.push(`SEO: ${note}`);
  }

  for (const note of reviewResult?.naverLogicNotes ?? []) {
    guides.push(`네이버 로직: ${note}`);
  }

  return Array.from(new Set(guides)).slice(0, 10);
}

function parseDraftColumns(streamingBody: string): DraftColumn[] {
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
    { label: "1차 초안", badge: "1차", body: firstBody },
    { label: "자동 보강본 2차", badge: "2차", body: secondBody },
    { label: "자동 보강본 3차", badge: "3차", body: thirdBody },
  ];
}

function columnStatusText(column: DraftColumn, hasAnyDraft: boolean): string {
  if (column.body) return "작성 완료";
  return hasAnyDraft ? "생성 대기" : "대기";
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
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900">본문 작업 영역</p>
            <p className="mt-1 text-xs text-zinc-500">
              초안 3단계와 수정본을 같은 화면에서 비교하면서 이어서 작업합니다.
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
              글쓰기를 시작하면 1차 초안과 자동 보강본이 따로 쌓이고, 수정본 탭에서는 실제 작성 본문을 기준으로 다시 검토할 수 있습니다.
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
                    1차 초안과 자동 보강본을 아래에서 나란히 비교할 수 있습니다. 더 나은 버전을 고르거나 필요한 부분만 골라 수정본 탭으로 넘기면 됩니다.
                  </p>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  {draftColumns.map((column, index) => {
                    const isLatest = index === lastCompletedIndex && Boolean(column.body);
                    return (
                      <section
                        key={column.label}
                        className={`overflow-hidden rounded-xl border ${
                          isLatest ? "border-blue-300 bg-blue-50/40" : "border-zinc-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                isLatest ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"
                              }`}>
                                {column.badge}
                              </span>
                              <p className="truncate text-sm font-semibold text-zinc-900">{column.label}</p>
                            </div>
                            <p className="mt-1 text-[11px] text-zinc-500">{columnStatusText(column, hasAnyDraft)}</p>
                          </div>
                          <span className="shrink-0 text-[11px] text-zinc-400">
                            {column.body.length.toLocaleString()}자
                          </span>
                        </div>

                        <div className="min-h-[34rem] max-h-[calc(100vh-16rem)] overflow-y-auto bg-zinc-950 px-4 py-4">
                          {column.body ? (
                            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-white">
                              {column.body}
                            </pre>
                          ) : (
                            <div className="flex h-full min-h-[30rem] items-center justify-center text-center">
                              <p className="text-sm leading-6 text-zinc-500">
                                {hasAnyDraft
                                  ? `${column.label}이 아직 생성되지 않았습니다.`
                                  : "초안 생성을 시작하면 이 영역에 표시됩니다."}
                              </p>
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>

                {hasDraftToPolish && (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">내용 수정 및 보완 요청</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        초안 3단계를 비교한 뒤, 필요한 보완 방향을 적으면 그 요청을 반영해 초안을 다시 생성합니다.
                      </p>
                    </div>
                    <div className="mt-3 space-y-3">
                      <textarea
                        value={revisionRequest}
                        onChange={(event) => onRevisionRequestChange(event.target.value)}
                        className="min-h-28 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="예: 메인 키워드 반복을 조금 줄이고, 초보자가 바로 이해할 수 있게 실제 선택 기준을 더 또렷하게 넣어줘."
                      />
                      <button
                        type="button"
                        onClick={onRunDraftPolish}
                        disabled={reviewSaving || !revisionRequest.trim()}
                        className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {reviewSaving ? "초안 다시 생성 중..." : "요청 반영해서 초안 다시 생성"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : result ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-xs font-semibold text-zinc-500">생성된 초안 제목</p>
                  <p className="mt-1 text-base font-semibold text-zinc-900">{result.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{result.wordCount.toLocaleString()}자 분량</p>
                </div>
                <div className="min-h-[34rem] rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-6">
                  <p className="text-sm leading-6 text-zinc-500">
                    초안 본문은 저장되었지만 아직 비교할 본문이 보이지 않습니다. 다시 실행하면 초안 3단계가 이 영역에 나뉘어 표시됩니다.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-h-[34rem] rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
                <p className="text-sm text-zinc-500">초안 생성을 시작하면 1차 초안과 자동 보강본이 각각 따로 표시됩니다.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-semibold text-zinc-600">실제 작성 본문 입력</p>
              <p className="mt-1 text-xs text-zinc-500">
                아래에 실제로 수정한 제목과 본문을 넣으면, 우측 키워드 개수와 SEO 검토 결과가 이 본문 기준으로 다시 계산됩니다.
              </p>
            </div>

            <div>
              <label htmlFor="actual-title" className="mb-1 block text-xs font-semibold text-zinc-600">실제 발행 제목</label>
              <input
                id="actual-title"
                value={reviewTitle}
                onChange={(event) => onReviewTitleChange(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="실제 발행 제목"
              />
            </div>

            <div>
              <label htmlFor="actual-body" className="mb-1 block text-xs font-semibold text-zinc-600">실제 작성 본문</label>
              <textarea
                id="actual-body"
                value={reviewBody}
                onChange={(event) => onReviewBodyChange(event.target.value)}
                className="min-h-48 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="실제로 수정한 본문을 여기에 붙여 넣으면 검토 결과와 수정본 초안이 생성됩니다."
              />
            </div>

            <div>
              <label htmlFor="revision-request" className="mb-1 block text-xs font-semibold text-zinc-600">내용 수정 및 보완 요청</label>
              <textarea
                id="revision-request"
                value={revisionRequest}
                onChange={(event) => onRevisionRequestChange(event.target.value)}
                className="min-h-28 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="예: 메인 키워드 과다 부분만 조금 낮추고 비교 기준 문단을 더 분명하게 정리해줘."
              />
              <p className="mt-1 text-xs text-zinc-500">
                선택 사항입니다. 적어두면 그 요청까지 반영해서 수정본을 생성합니다.
              </p>
            </div>

            <button
              type="button"
              onClick={onRunDraftReview}
              disabled={reviewSaving || !reviewTitle.trim()}
              className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {reviewSaving ? "수정본 검토 중..." : "검토 후 수정본 생성"}
            </button>

            {reviewResult ? (
              <div className="space-y-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-blue-700">수정본 편집</p>
                    <p className="mt-1 text-xs text-blue-600">
                      실제 작성 본문 기준 검토 결과를 반영한 수정본입니다. 우측 패널의 키워드 수치도 지금 입력한 본문 기준으로 계산됩니다.
                    </p>
                  </div>
                  {reviewApplied && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      원본 반영 완료
                    </span>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-blue-700">수정본 제목</label>
                  <input
                    value={reviewEditorTitle}
                    onChange={(event) => onReviewedTitleChange(event.target.value)}
                    className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-blue-700">수정본 본문</label>
                  <textarea
                    value={reviewEditorBody}
                    onChange={(event) => onReviewedBodyChange(event.target.value)}
                    className="min-h-[24rem] w-full rounded-lg border border-blue-200 px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="space-y-3 rounded-lg border border-blue-100 bg-white/90 p-4">
                  <div>
                    <p className="text-xs font-semibold text-blue-700">수정본 검토 리포트</p>
                    <p className="mt-1 text-xs text-blue-600">아래 항목을 보면 무엇을 먼저 손봐야 하는지 바로 확인할 수 있습니다.</p>
                  </div>

                  {revisionGuides.length > 0 ? (
                    <div className="space-y-2">
                      {revisionGuides.map((guide, index) => {
                        const issue = reviewIssues.find((item) => item.message === guide);
                        return (
                          <div
                            key={`${guide}-${index}`}
                            className={`rounded-lg border px-3 py-2 text-sm ${issue ? issueTone(issue.severity) : "border-blue-100 bg-blue-50 text-zinc-700"}`}
                          >
                            {guide}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      지금 기준으로는 큰 수정 사인이 보이지 않습니다. 표현만 다듬고 바로 반영해도 됩니다.
                    </div>
                  )}

                  {reviewResult.checks?.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {reviewResult.checks.map((check) => (
                        <div key={check.label} className="rounded-md border border-zinc-100 bg-white px-3 py-2">
                          <p className={`text-xs font-semibold ${check.passed ? "text-emerald-600" : "text-amber-600"}`}>
                            {check.passed ? "통과" : "확인 필요"} | {check.label}
                          </p>
                          <p className="mt-1 text-[11px] text-zinc-500">{check.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={onApplyReviewedDraft}
                  disabled={reviewSaving || !reviewEditorTitle.trim() || !reviewEditorBody.trim()}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {reviewSaving ? "수정본 반영 중..." : "수정본을 원본에 반영"}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
                <p className="text-sm text-zinc-500">검토를 실행하면 수정본 편집기와 실제 본문 기준 키워드 리포트가 이 화면에 열립니다.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
