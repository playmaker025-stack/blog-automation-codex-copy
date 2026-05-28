"use client";

import type { DraftReviewChange, DraftReviewIssue, DraftReviewResult } from "@/lib/agents/draft-review";
import type { KeywordUsageReport, SeoEvaluation } from "@/lib/agents/types";
import { KeywordReportSections } from "@/components/pipeline/keyword-report-sections";
import { getDraftVersionReportForIndex } from "@/components/pipeline/keyword-report-utils";

interface Props {
  contentTab: "draft" | "revision";
  setContentTab: (tab: "draft" | "revision") => void;
  runningTitle: string | null;
  events: unknown[];
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
  reviewResult: DraftReviewResult | null;
  reviewIssues: DraftReviewIssue[];
  draftVersionReports: Array<{
    label: string;
    body: string;
    seoEvaluation: SeoEvaluation;
    keywordReport: KeywordUsageReport;
  } | null>;
  onOpenReviewModal: () => void;
  onOpenPublishModal: () => void;
}

interface DraftColumn {
  label: string;
  badge: string;
  body: string;
}

const AUTO_DRAFT_MARKER_2 = "\n\n---\n\n[2차 초안]\n";
const AUTO_DRAFT_MARKER_3 = "\n\n---\n\n[3차 초안]\n";

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
  const thirdBody = thirdMarkerIndex >= 0 ? normalized.slice(thirdMarkerIndex + AUTO_DRAFT_MARKER_3.length).trim() : "";

  return [
    { label: "1차 초안", badge: "1차", body: firstBody },
    { label: "2차 보강 초안", badge: "2차", body: secondBody },
    { label: "3차 보강 초안", badge: "3차", body: thirdBody },
  ];
}

function columnStatusText(column: DraftColumn, hasAnyDraft: boolean): string {
  if (column.body) return "작성 완료";
  return hasAnyDraft ? "생성 대기" : "초안 생성 대기";
}

function findKeywordSummary(reviewResult: DraftReviewResult | null): string[] {
  if (!reviewResult) return [];

  const lines: string[] = [];
  const main = reviewResult.keywordReport.mainKeyword;
  if (main) {
    lines.push(`메인 키워드 '${main.keyword}' 본문 ${main.count}회`);
  }
  for (const item of reviewResult.keywordReport.subKeywords.slice(0, 5)) {
    lines.push(`서브 키워드 '${item.keyword}' 본문 ${item.count}회`);
  }
  return lines;
}

function buildSuggestionLines(reviewResult: DraftReviewResult | null): string[] {
  if (!reviewResult) return [];
  if (reviewResult.changeDetails.length > 0) {
    return reviewResult.changeDetails.slice(0, 5).map((change) => change.reason);
  }
  return reviewResult.changes.slice(0, 5);
}

function lineChanged(sourceLine: string | undefined, revisedLine: string): boolean {
  const left = (sourceLine ?? "").trim();
  const right = revisedLine.trim();
  return Boolean(right) && left !== right;
}

function RevisedBodyDiff({
  originalBody,
  revisedBody,
}: {
  originalBody: string;
  revisedBody: string;
}) {
  const originalLines = originalBody.replace(/\r\n/g, "\n").split("\n");
  const revisedLines = revisedBody.replace(/\r\n/g, "\n").split("\n");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-sm font-semibold text-zinc-900">수정 제안 본문</p>
      <p className="mt-1 text-xs text-zinc-500">변경된 줄은 빨간색, 유지된 줄은 검정색으로 표시합니다.</p>
      <div className="mt-3 max-h-[30rem] overflow-y-auto rounded-lg bg-zinc-50 px-4 py-4">
        {revisedLines.map((line, index) => {
          const changed = lineChanged(originalLines[index], line);
          return (
            <p
              key={`${index}-${line}`}
              className={`whitespace-pre-wrap break-words text-sm leading-7 ${changed ? "text-red-600" : "text-zinc-900"}`}
            >
              {line || " "}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function ReviewIssueList({ issues }: { issues: DraftReviewIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-sm font-semibold text-zinc-900">오탈자 / 띄어쓰기 / 검토 이슈</p>
      <div className="mt-3 space-y-2">
        {issues.map((issue) => (
          <div
            key={`${issue.severity}-${issue.message}`}
            className={`rounded-lg border px-3 py-2 text-sm ${
              issue.severity === "blocker"
                ? "border-red-200 bg-red-50 text-red-700"
                : issue.severity === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700"
            }`}
          >
            {issue.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangeDetailList({ changes }: { changes: DraftReviewChange[] }) {
  if (changes.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-sm font-semibold text-zinc-900">더 자연스러운 문장 제안</p>
      <div className="mt-3 space-y-3">
        {changes.slice(0, 5).map((change, index) => (
          <div key={`${index}-${change.before}-${change.after}`} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
            <p className="text-xs font-semibold text-zinc-500">변경 전</p>
            <p className="mt-1 text-sm text-zinc-700">{change.before}</p>
            <p className="mt-3 text-xs font-semibold text-zinc-500">변경 후</p>
            <p className="mt-1 text-sm text-red-600">{change.after}</p>
            <p className="mt-3 text-xs text-zinc-500">{change.reason}</p>
          </div>
        ))}
      </div>
    </div>
  );
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
  reviewResult,
  reviewIssues,
  draftVersionReports,
  onOpenReviewModal,
  onOpenPublishModal,
}: Props) {
  const hasCenterContent = Boolean(streamingBody || result || reviewResult || events.length);
  const draftColumns = parseDraftColumns(streamingBody);
  const hasAnyDraft = draftColumns.some((column) => column.body);
  const lastCompletedIndex = Math.max(...draftColumns.map((column, index) => (column.body ? index : -1)));
  const keywordSummary = findKeywordSummary(reviewResult);
  const suggestionLines = buildSuggestionLines(reviewResult);

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900">본문 작업 영역</p>
            <p className="mt-1 text-xs text-zinc-500">
              초안 버전 비교, 수정본 검토 결과, 실제 발행 전 정리를 한 화면에서 이어갑니다.
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
              글쓰기를 시작하면 1차 초안이 먼저 생성되고, 문제가 있는 경우에만 2차·3차 보강 초안이 추가됩니다.
            </p>
          </div>
        ) : contentTab === "draft" ? (
          <div className="space-y-4">
            {runningTitle ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="text-xs font-semibold text-zinc-500">현재 작업 제목</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{runningTitle}</p>
              </div>
            ) : null}

            {hasAnyDraft ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <p className="text-xs font-semibold text-blue-700">초안 비교 보기</p>
                  <p className="mt-1 text-xs leading-5 text-blue-600">
                    2차·3차 초안은 문제가 있을 때만 생성됩니다. 각 초안 아래에서 키워드 사용량과 반복 점검을 바로 비교할 수 있습니다.
                  </p>
                </div>

                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.05fr)_minmax(0,1.05fr)]">
                  {draftColumns.map((column, index) => {
                    const isLatest = index === lastCompletedIndex && Boolean(column.body);
                    const versionReport = getDraftVersionReportForIndex(draftVersionReports, index);

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
                                {hasAnyDraft ? "이 단계 초안은 아직 생성되지 않았습니다." : "초안 생성을 시작하면 본문이 표시됩니다."}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="border-t border-zinc-100 bg-white px-4 py-4">
                          <p className="mb-3 text-sm font-semibold text-zinc-900">초안별 키워드 사용량</p>
                          {versionReport ? (
                            <KeywordReportSections report={versionReport.keywordReport} compact />
                          ) : (
                            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3 text-[11px] text-zinc-500">
                              키워드 분석 대기 중
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
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
                    초안 본문이 아직 스트리밍 영역에 표시되지 않았습니다. 다시 글쓰기를 실행하면 본문과 보강 초안이 단계별로 표시됩니다.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-h-[34rem] rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
                <p className="text-sm text-zinc-500">초안 생성을 시작하면 1차 초안부터 이 영역에 표시됩니다.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold text-zinc-500">수정본 검토 결과</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                사용자가 직접 작성한 제목과 본문을 검토한 결과를 이곳에서 확인합니다.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={onOpenReviewModal}
                disabled={reviewSaving}
                className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40"
              >
                수정본 검토
              </button>
              <button
                type="button"
                onClick={onOpenPublishModal}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                실제 발행본 진행
              </button>
            </div>

            {reviewResult ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-semibold text-zinc-900">검토 대상 제목</p>
                  <p className="mt-1 text-sm text-zinc-700">{reviewTitle}</p>
                  {reviewedTitle && reviewedTitle !== reviewTitle ? (
                    <>
                      <p className="mt-4 text-sm font-semibold text-zinc-900">수정 제안 제목</p>
                      <p className="mt-1 text-sm text-red-600">{reviewedTitle}</p>
                    </>
                  ) : null}
                </div>

                {keywordSummary.length > 0 ? (
                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    <p className="text-sm font-semibold text-zinc-900">키워드 검토 결과</p>
                    <ul className="mt-3 space-y-1 text-sm text-zinc-700">
                      {keywordSummary.map((line) => (
                        <li key={line} className="flex gap-2">
                          <span className="text-zinc-400">-</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <ReviewIssueList issues={reviewIssues} />

                {suggestionLines.length > 0 ? (
                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                    <p className="text-sm font-semibold text-zinc-900">더 자연스러운 문장 제안</p>
                    <ul className="mt-3 space-y-1 text-sm text-zinc-700">
                      {suggestionLines.map((line) => (
                        <li key={line} className="flex gap-2">
                          <span className="text-zinc-400">-</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <ChangeDetailList changes={reviewResult.changeDetails} />

                <RevisedBodyDiff originalBody={reviewBody} revisedBody={reviewedBody || reviewResult.revisedBody} />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6">
                <p className="text-sm text-zinc-500">아직 수정본 검토 결과가 없습니다. “수정본 검토”를 눌러 진행해 주세요.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
