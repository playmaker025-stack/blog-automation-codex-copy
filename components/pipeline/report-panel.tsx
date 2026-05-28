"use client";

import type { ReactNode } from "react";
import type { DraftReviewIssue, DraftReviewResult } from "@/lib/agents/draft-review";
import type { FinalDraftCheck, NaverLogicEvaluation, SeoEvaluation } from "@/lib/agents/types";

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
  finalDraftCheck?: FinalDraftCheck;
}

interface Props {
  contentTab: "draft" | "revision";
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
}

function scoreTone(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 65) return "text-amber-600";
  return "text-red-500";
}

function issueTone(severity: DraftReviewIssue["severity"]): string {
  if (severity === "blocker") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function looksBroken(value: string | null | undefined): boolean {
  if (!value) return false;
  return /[\uFFFD]|\u00C3|\u00C2|[\u00EC\u00ED\u00EF][\S\s]{0,3}[\u00EB\u00EA]|[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/.test(value);
}

function cleanNotes(notes: string[]): string[] {
  return notes.filter((note) => note.trim() && !looksBroken(note));
}

function metricSummary(metric: SeoEvaluation["keywordMetrics"][number]): string {
  const parts = [
    metric.titleIncluded ? "제목 포함" : "제목 미포함",
    metric.introIncluded ? "도입부 포함" : "도입부 미포함",
    `본문 ${metric.count}회`,
  ];
  return parts.join(" / ");
}

function metricAction(metric: SeoEvaluation["keywordMetrics"][number]): string {
  if (!metric.titleIncluded) return `제목에 '${metric.keyword}'를 자연스럽게 반영하는 편이 좋습니다.`;
  if (!metric.introIncluded) return `첫 1~2문단 안에 '${metric.keyword}'를 자연스럽게 넣어 주세요.`;
  if (metric.count < metric.targetMin) {
    return `본문 기준 '${metric.keyword}'가 부족합니다. ${metric.targetMin}회 이상 자연스럽게 보강하세요.`;
  }
  if (metric.count > metric.targetMax) {
    return `본문 기준 '${metric.keyword}'가 많습니다. 중복 문장이나 불필요한 재언급을 줄이세요.`;
  }
  return `'${metric.keyword}' 배치는 적정 범위입니다.`;
}

function SeoMetricPanel({
  seoEvaluation,
  contentTab,
}: {
  seoEvaluation: SeoEvaluation;
  contentTab: "draft" | "revision";
}) {
  if ((seoEvaluation.keywordMetrics?.length ?? 0) === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-semibold text-zinc-600">키워드 배치 / SEO 분석</p>
      <p className="mt-1 text-[11px] leading-5 text-zinc-500">
        제목, 도입부, 본문 반복 수를 기준으로 메인/서브 키워드 배치 상태를 계산합니다.
      </p>
      <div className="mt-3 space-y-3">
        {seoEvaluation.keywordMetrics.map((metric) => (
          <div key={`${contentTab}-metric-${metric.keyword}`} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-800">{metric.keyword}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{metric.label}</p>
              </div>
              <p className={`text-xs font-semibold ${metric.role === "main" ? "text-blue-600" : "text-zinc-500"}`}>
                {metric.role === "main" ? "메인 축" : "서브 축"}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-white px-3 py-2">
                <p className="text-[11px] font-semibold text-zinc-500">완성도</p>
                <p className={`mt-1 text-sm font-semibold ${scoreTone(metric.completenessScore)}`}>
                  {metric.completenessScore}점
                </p>
              </div>
              <div className="rounded-md bg-white px-3 py-2">
                <p className="text-[11px] font-semibold text-zinc-500">노출 가능성</p>
                <p className={`mt-1 text-sm font-semibold ${scoreTone(metric.exposurePotentialScore)}`}>
                  {metric.exposurePotentialScore}점
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-zinc-600">{metricSummary(metric)}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              제목 {metric.titleIncluded ? "포함" : "미포함"} / 도입부 {metric.introIncluded ? "포함" : "미포함"} /
              적정 범위 {metric.targetMin}~{metric.targetMax}회 / 본문 {metric.count}회
            </p>
            <p className="mt-2 text-xs text-zinc-700">{metricAction(metric)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimpleNotePanel({ title, notes }: { title: string; notes: string[] }) {
  if (notes.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold text-zinc-600">{title}</p>
      <ul className="space-y-1">
        {notes.map((note, index) => (
          <li key={`${title}-${index}-${note}`} className="flex gap-2 text-sm text-zinc-700">
            <span className="text-zinc-400">-</span>
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PipelineReportPanel({
  contentTab,
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
}: Props) {
  const activeSeoEvaluation =
    contentTab === "revision" ? reviewResult?.seoEvaluation ?? null : result?.seoEvaluation ?? null;
  const activeSeoNotes = cleanNotes(
    contentTab === "revision" ? reviewResult?.seoNotes ?? [] : result?.seoEvaluation?.improvements ?? []
  );
  const activeNaverNotes = cleanNotes(
    contentTab === "revision" ? reviewResult?.naverLogicNotes ?? [] : result?.naverLogicEvaluation?.improvements ?? []
  );
  const visibleReviewIssues = reviewIssues.filter((issue) => !looksBroken(issue.message));

  return (
    <aside className="space-y-4">
      {approval}

      {!result && !reviewResult ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm font-semibold text-zinc-900">평가 / 보고서</p>
          <p className="mt-3 text-sm leading-7 text-zinc-500">
            초안 생성과 평가가 끝나면 이곳에 SEO, 네이버 로직, 해시태그, 추천 파일명이 정리됩니다.
          </p>
        </div>
      ) : null}

      {result && (
        <div className={`rounded-xl border p-4 ${result.pass ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={`text-sm font-semibold ${result.pass ? "text-emerald-700" : "text-amber-700"}`}>
                {result.pass ? "초안 평가 통과" : "초안 평가 보강 필요"}
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
              <p className="mt-1 text-sm font-semibold text-zinc-900">
                {result.naverLogicEvaluation?.completenessScore ?? "-"}
              </p>
            </div>
            <div className="rounded-lg bg-white/70 px-3 py-2">
              <p className="text-[11px] font-semibold text-zinc-500">상태</p>
              <p className={`mt-1 text-sm font-semibold ${result.pass ? "text-emerald-700" : "text-amber-700"}`}>
                {result.pass ? "통과" : "보강"}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeSeoEvaluation && <SeoMetricPanel seoEvaluation={activeSeoEvaluation} contentTab={contentTab} />}

      {result?.naverLogicEvaluation && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-zinc-600">네이버 로직 평가</p>
              <p className="mt-1 text-sm font-semibold text-zinc-900">{result.naverLogicEvaluation.label}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {looksBroken(result.naverLogicEvaluation.reason)
                  ? "제목과 본문 구조, 키워드 분산, 정보 충실도를 기준으로 평가했습니다."
                  : result.naverLogicEvaluation.reason}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold text-zinc-500">완성도</p>
              <p className={`mt-1 text-lg font-bold ${scoreTone(result.naverLogicEvaluation.completenessScore)}`}>
                {result.naverLogicEvaluation.completenessScore}점
              </p>
            </div>
          </div>
          {result.naverLogicEvaluation.evidence.length > 0 && (
            <SimpleNotePanel title="근거" notes={cleanNotes(result.naverLogicEvaluation.evidence)} />
          )}
        </div>
      )}

      <SimpleNotePanel title="SEO 보강 사항" notes={activeSeoNotes} />
      <SimpleNotePanel title="네이버 로직 보강 사항" notes={activeNaverNotes} />

      {visibleReviewIssues.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="mb-3 text-xs font-semibold text-zinc-600">수정본 검토 이슈</p>
          <div className="space-y-2">
            {visibleReviewIssues.map((issue) => (
              <div
                key={`${issue.severity}-${issue.message}`}
                className={`rounded-lg border px-3 py-2 text-sm ${issueTone(issue.severity)}`}
              >
                {issue.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {contentTab === "revision" && result && (
        <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
          <div>
            <p className="text-xs font-semibold text-zinc-600">실제 발행 URL 입력</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              수정본을 네이버에 반영한 뒤 실제 발행 URL을 입력하면 발행 인덱스와 사용자 학습 데이터에 반영됩니다.
            </p>
          </div>

          <input
            value={publishUrl}
            onChange={(event) => onPublishUrlChange(event.target.value)}
            placeholder="https://blog.naver.com/..."
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />

          <button
            type="button"
            onClick={onPublishToIndex}
            disabled={publishingToIndex || !publishUrl.trim()}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {publishingToIndex ? "발행 인덱스 반영 중" : "발행 인덱스에 반영"}
          </button>

          {publishNotice && (
            <div
              className={`rounded-lg px-3 py-3 text-sm ${
                publishNotice.type === "ok"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {publishNotice.msg}
            </div>
          )}

          {reviewApplied && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-700">
              수정본을 저장본에 반영했습니다. 네이버에 실제 발행한 뒤 URL을 입력해 인덱스에 추가하세요.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
