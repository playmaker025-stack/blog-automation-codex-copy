"use client";

import { PipelineStream } from "@/components/pipeline/pipeline-stream";
import type { DraftReviewResult } from "@/lib/agents/draft-review";
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
  reviewedTitle: string;
  reviewedBody: string;
  reviewSaving: boolean;
  reviewApplied: boolean;
  reviewResult: DraftReviewResult | null;
  onReviewTitleChange: (value: string) => void;
  onReviewBodyChange: (value: string) => void;
  onReviewedTitleChange: (value: string) => void;
  onReviewedBodyChange: (value: string) => void;
  onRunDraftReview: () => void;
  onApplyReviewedDraft: () => void;
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
  reviewedTitle,
  reviewedBody,
  reviewSaving,
  reviewApplied,
  reviewResult,
  onReviewTitleChange,
  onReviewBodyChange,
  onReviewedTitleChange,
  onReviewedBodyChange,
  onRunDraftReview,
  onApplyReviewedDraft,
}: Props) {
  const hasCenterContent = Boolean(streamingBody || result || reviewResult || events.length);
  const draftPreviewBody = streamingBody.trim();
  const reviewEditorTitle = reviewedTitle || reviewTitle;
  const reviewEditorBody = reviewedBody || reviewBody;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900">본문 작업 영역</p>
            <p className="mt-1 text-xs text-zinc-500">초안과 수정본을 같은 자리에서 오가면서 확인하고 다듬습니다.</p>
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
            <p className="text-sm font-semibold text-zinc-700">본문이 여기에 표시돼</p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              글쓰기를 시작하면 초안이 가운데에 쌓이고, 수정본 탭에서는 실제 작성본과 수정본을 한 자리에서 다룰 수 있어.
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

            {draftPreviewBody ? (
              <PipelineStream events={events} streamingBody={streamingBody} showLogs={false} />
            ) : result ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="text-xs font-semibold text-zinc-500">생성된 초안 제목</p>
                  <p className="mt-1 text-base font-semibold text-zinc-900">{result.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{result.wordCount.toLocaleString()}자 저장 완료</p>
                </div>
                <div className="min-h-[34rem] rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-6">
                  <p className="text-sm leading-6 text-zinc-500">
                    초안 저장은 끝났어. 이제 수정본 탭에서 실제 작성본을 붙여 넣고 검토를 이어가면 돼.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-h-[34rem] rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
                <p className="text-sm text-zinc-500">초안 생성이 시작되면 이 영역에 본문이 실시간으로 표시돼.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-semibold text-zinc-600">실제 작성본 입력</p>
              <p className="mt-1 text-xs text-zinc-500">
                발행 전에 다듬은 제목과 본문을 넣으면, 수정본 작성과 검토를 바로 이어서 볼 수 있어.
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
                placeholder="실제로 작성한 본문을 붙여 넣으면 수정본과 검토 리포트가 함께 생성됩니다."
              />
            </div>

            <button
              type="button"
              onClick={onRunDraftReview}
              disabled={reviewSaving || !reviewTitle.trim()}
              className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {reviewSaving ? "OpenAI 수정본 작성 중" : "검토 후 수정본 작성"}
            </button>

            {reviewResult ? (
              <div className="space-y-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-blue-700">수정본 편집</p>
                    <p className="mt-1 text-xs text-blue-600">검토 결과를 반영한 수정본이야. 필요한 부분은 여기서 바로 고치면 돼.</p>
                  </div>
                  {reviewApplied && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      저장본 반영 완료
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

                <div className="rounded-lg border border-blue-100 bg-white/80 p-3">
                  <p className="text-xs font-semibold text-blue-700">검토 요약</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {reviewResult.checks?.map((check) => (
                      <div key={check.label} className="rounded-md border border-zinc-100 bg-white px-3 py-2">
                        <p className={`text-xs font-semibold ${check.passed ? "text-emerald-600" : "text-amber-600"}`}>
                          {check.passed ? "통과" : "확인"} · {check.label}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-500">{check.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onApplyReviewedDraft}
                  disabled={reviewSaving || !reviewEditorTitle.trim() || !reviewEditorBody.trim()}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {reviewSaving ? "수정본 반영 중" : "수정본 저장본에 반영"}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
                <p className="text-sm text-zinc-500">검토를 실행하면 수정본 편집기와 검토 요약이 이 영역에 함께 열려.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
