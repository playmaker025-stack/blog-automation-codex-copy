"use client";

import type { ReactNode } from "react";
import type { DraftReviewIssue, DraftReviewResult } from "@/lib/agents/draft-review";
import type { NaverLogicEvaluation, SeoEvaluation, KeywordUsageReport } from "@/lib/agents/types";

interface ResultData {
  title: string;
  wordCount: number;
  evalScore: number;
  pass: boolean;
  recommendations: string[];
  hashtags?: string[];
  imageFileNames?: string[];
  seoEvaluation?: SeoEvaluation;
  naverLogicEvaluation?: NaverLogicEvaluation;
}

interface Props {
  approval: ReactNode;
  result: ResultData | null;
  reviewResult: DraftReviewResult | null;
  reviewIssues: DraftReviewIssue[];
  reviewApplied: boolean;
  publishUrl: string;
  publishingToIndex: boolean;
  publishNotice: { type: "ok" | "err"; msg: string } | null;
  onPublishUrlChange: (value: string) => void;
  onPublishToIndex: () => void;
  keywordStatusTone: (status: KeywordUsageReport["items"][number]["status"]) => string;
}

export function PipelineReportPanel({
  approval,
  result,
  reviewResult,
  reviewIssues,
  reviewApplied,
  publishUrl,
  publishingToIndex,
  publishNotice,
  onPublishUrlChange,
  onPublishToIndex,
  keywordStatusTone,
}: Props) {
  return (
    <aside className="min-w-0 space-y-4 xl:sticky xl:top-8">
      {approval}

      {result ? (
        <>
          <div className={`rounded-xl border p-5 ${result.pass ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={`text-sm font-semibold ${result.pass ? "text-emerald-700" : "text-amber-700"}`}>
                  {result.pass ? "글쓰기 완료" : "초안 저장 완료 · 개선 권고"}
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{result.title}</p>
                <p className="mt-1 text-xs text-zinc-500">{result.wordCount.toLocaleString()}자</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold text-zinc-500">최종 점수</p>
                <p className="text-2xl font-bold text-zinc-900">{result.evalScore}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-white/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-zinc-500">SEO</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{result.seoEvaluation?.score ?? "-"}</p>
              </div>
              <div className="rounded-lg bg-white/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-zinc-500">네이버 로직</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{result.naverLogicEvaluation?.completenessScore ?? "-"}</p>
              </div>
              <div className="rounded-lg bg-white/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-zinc-500">상태</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{result.pass ? "통과" : "미달"}</p>
              </div>
            </div>
          </div>

          {result.naverLogicEvaluation && (
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-600">네이버 로직</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">{result.naverLogicEvaluation.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">{result.naverLogicEvaluation.reason}</p>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-right">
                  <p className="text-[11px] font-semibold text-blue-600">완성도</p>
                  <p className="text-lg font-bold text-blue-700">{result.naverLogicEvaluation.completenessScore}점</p>
                </div>
              </div>
              {result.naverLogicEvaluation.evidence.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-zinc-600">반영 근거</p>
                  <ul className="space-y-1">
                    {result.naverLogicEvaluation.evidence.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex gap-2 text-sm text-zinc-700">
                        <span className="text-zinc-400">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.naverLogicEvaluation.improvements.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-zinc-600">보강 포인트</p>
                  <ul className="space-y-1">
                    {result.naverLogicEvaluation.improvements.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex gap-2 text-sm text-zinc-700">
                        <span className="text-amber-500">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {result.seoEvaluation && (
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-600">SEO 분석</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">키워드 반복과 검색 의도 반영</p>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-right">
                  <p className="text-[11px] font-semibold text-emerald-600">SEO 점수</p>
                  <p className="text-lg font-bold text-emerald-700">{result.seoEvaluation.score}점</p>
                </div>
              </div>
              <div className="space-y-2">
                {result.seoEvaluation.keywordReport.items.map((item) => (
                  <div key={item.keyword} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-zinc-800">{item.keyword}</p>
                      <p className={`text-xs font-semibold ${keywordStatusTone(item.status)}`}>
                        {item.count}회 · {item.status}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500">권장 {item.targetMin}~{item.targetMax}회</p>
                    <p className="mt-1 text-xs text-zinc-600">{item.recommendation}</p>
                  </div>
                ))}
              </div>
              {result.seoEvaluation.improvements.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-zinc-600">SEO 보강 포인트</p>
                  <ul className="space-y-1">
                    {result.seoEvaluation.improvements.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex gap-2 text-sm text-zinc-700">
                        <span className="text-amber-500">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {reviewResult && (
            <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div>
                <p className="text-xs font-semibold text-blue-700">수정본 검토 리포트</p>
                <p className="mt-1 text-xs text-blue-600">수정본 탭에서 편집 중인 본문에 대한 검토 근거야.</p>
              </div>
              {reviewResult.keywordReport.items.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-blue-700">주요 키워드 반복 횟수</p>
                  {reviewResult.keywordReport.items.map((item) => (
                    <div key={`review-${item.keyword}`} className="rounded-md border border-blue-100 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-zinc-800">{item.keyword}</p>
                        <p className={`text-[11px] font-semibold ${keywordStatusTone(item.status)}`}>
                          {item.count}회 · {item.status}
                        </p>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500">권장 {item.targetMin}~{item.targetMax}회</p>
                      <p className="mt-1 text-xs text-zinc-700">{item.recommendation}</p>
                    </div>
                  ))}
                </div>
              )}
              {reviewResult.seoNotes.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-blue-700">SEO 검수</p>
                  <ul className="space-y-1">
                    {reviewResult.seoNotes.map((item, index) => (
                      <li key={`seo-${index}`} className="text-xs text-zinc-700">• {item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {reviewResult.naverLogicNotes.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-blue-700">네이버 로직 검수</p>
                  <ul className="space-y-1">
                    {reviewResult.naverLogicNotes.map((item, index) => (
                      <li key={`naver-${index}`} className="text-xs text-zinc-700">• {item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {result.recommendations.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-2 text-xs font-semibold text-zinc-600">개선 권고사항</p>
              <ul className="space-y-1">
                {result.recommendations.map((recommendation, index) => (
                  <li key={`${recommendation}-${index}`} className="flex gap-2 text-sm text-zinc-700">
                    <span className="text-zinc-400">•</span>
                    <span>{recommendation}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(result.hashtags?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-2 text-xs font-semibold text-zinc-600">추천 해시태그</p>
              <div className="flex flex-wrap gap-2">
                {result.hashtags?.map((tag) => (
                  <span key={tag} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(result.imageFileNames?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-2 text-xs font-semibold text-zinc-600">추천 파일명</p>
              <ul className="space-y-1">
                {result.imageFileNames?.map((name) => (
                  <li key={name} className="rounded border border-zinc-100 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
            <div>
              <p className="text-xs font-semibold text-zinc-600">발행 완료 후 인덱스 추가</p>
              {!reviewApplied && (
                <p className="mt-1 text-xs text-amber-600">먼저 수정본을 저장본에 반영한 뒤에만 인덱스에 추가할 수 있어.</p>
              )}
            </div>
            <input
              value={publishUrl}
              onChange={(event) => onPublishUrlChange(event.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="https://blog.naver.com/..."
            />
            <button
              type="button"
              onClick={onPublishToIndex}
              disabled={publishingToIndex || !reviewApplied || !publishUrl.trim()}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
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
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-2 text-xs font-semibold text-zinc-600">검토 결과</p>
              <ul className="space-y-1">
                {reviewIssues.map((issue, index) => (
                  <li key={`${issue.message}-${index}`} className="flex gap-2 text-sm text-zinc-700">
                    <span
                      className={
                        issue.severity === "blocker"
                          ? "text-red-500"
                          : issue.severity === "warning"
                            ? "text-amber-500"
                            : "text-zinc-400"
                      }
                    >
                      •
                    </span>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6">
          <p className="text-sm font-semibold text-zinc-700">평가 / 보고서</p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            초안 생성과 평가가 끝나면 이쪽에 SEO, 네이버 로직, 해시태그, 추천 파일명이 정리돼.
          </p>
        </div>
      )}
    </aside>
  );
}
