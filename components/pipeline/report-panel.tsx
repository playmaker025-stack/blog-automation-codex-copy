"use client";

import type { ReactNode } from "react";
import type { DraftReviewIssue, DraftReviewResult } from "@/lib/agents/draft-review";
import type { KeywordUsageReport, NaverLogicEvaluation, SeoEvaluation } from "@/lib/agents/types";

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
  contentTab: "draft" | "revision";
  approval: ReactNode;
  result: ResultData | null;
  reviewResult: DraftReviewResult | null;
  reviewIssues: DraftReviewIssue[];
  reviewApplied: boolean;
  draftVersionReports: Array<{
    label: string;
    body: string;
    seoEvaluation: SeoEvaluation;
    keywordReport: KeywordUsageReport;
  }>;
  publishUrl: string;
  publishingToIndex: boolean;
  publishNotice: { type: "ok" | "err"; msg: string } | null;
  onPublishUrlChange: (value: string) => void;
  onPublishToIndex: () => void;
  keywordStatusTone: (status: KeywordUsageReport["items"][number]["status"]) => string;
}

function scoreTone(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 65) return "text-amber-600";
  return "text-red-500";
}

function tokenTone(count: number): string {
  if (count >= 20) return "text-red-500";
  if (count >= 10) return "text-amber-600";
  if (count >= 4) return "text-zinc-700";
  return "text-blue-600";
}

function keywordStatusLabel(status: KeywordUsageReport["items"][number]["status"]): string {
  if (status === "ok") return "적정";
  if (status === "caution") return "주의";
  if (status === "danger") return "위험";
  return "부족";
}

function overallRiskLabel(risk: KeywordUsageReport["overallRisk"]): string {
  if (risk === "low") return "낮음";
  if (risk === "medium") return "보통";
  return "높음";
}

function issueTone(severity: DraftReviewIssue["severity"]): string {
  if (severity === "blocker") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function looksBroken(value: string | null | undefined): boolean {
  if (!value) return false;
  return /[ÃÂæðïìë¿]/.test(value) && !/[가-힣]/.test(value);
}

function keywordRecommendation(item: KeywordUsageReport["items"][number], role: "main" | "sub"): string {
  if (role === "main") {
    if (item.status === "under") return `메인 키워드 '${item.keyword}'가 부족합니다. 본문 기준 ${item.targetMin}~${item.targetMax}회 안으로 보강해 주세요.`;
    if (item.status === "caution") return `메인 키워드 '${item.keyword}'가 다소 많습니다. 같은 문단 반복을 줄여 주세요.`;
    if (item.status === "danger") return `메인 키워드 '${item.keyword}'가 과하게 반복됩니다. 일부를 기준, 상황, 예시 표현으로 분산해 주세요.`;
    return `메인 키워드 '${item.keyword}' 반복도는 현재 적정 범위입니다.`;
  }

  if (item.status === "under") return `서브 키워드 '${item.keyword}'가 부족합니다. 본문에 1~3회 안으로 자연스럽게 반영해 주세요.`;
  if (item.status === "caution") return `서브 키워드 '${item.keyword}'가 조금 많은 편입니다. 같은 표현을 한 문단에 몰지 마세요.`;
  if (item.status === "danger") return `서브 키워드 '${item.keyword}'가 과하게 반복됩니다. 설명형 문장으로 바꿔 주세요.`;
  return `서브 키워드 '${item.keyword}' 반복도는 현재 적정 범위입니다.`;
}

function overallRiskSummary(report: KeywordUsageReport): string {
  const warningCount = report.paragraphWarnings.length;
  if (report.overallRisk === "high") {
    return warningCount > 0
      ? `과반복 위험이 높고 문단 내 반복 경고가 ${warningCount}건 있습니다.`
      : "과반복 위험이 높습니다. 메인/서브 키워드 반복을 줄여 주세요.";
  }
  if (report.overallRisk === "medium") {
    return warningCount > 0
      ? `반복도는 보통 수준이지만 문단 내 반복 경고가 ${warningCount}건 있습니다.`
      : "일부 키워드가 부족하거나 다소 많습니다. 문맥을 보며 조정해 주세요.";
  }
  return "반복 위험은 비교적 안정적입니다.";
}

function tokenNote(item: KeywordUsageReport["tokenItems"][number]): string {
  if (item.count >= 20) return "반복이 매우 많은 편입니다. 다른 표현이나 구체 기준으로 일부 치환하는 편이 좋습니다.";
  if (item.count >= 10) return "반복이 많은 편입니다. 문단마다 같은 단어가 이어지지 않는지 확인해 주세요.";
  if (item.count >= 4) return "핵심 축으로 자주 등장하는 단어입니다. 다른 핵심 단어와의 균형도 같이 보세요.";
  return "실제 본문에서 확인된 핵심 단어 축입니다.";
}

function metricSummary(metric: SeoEvaluation["keywordMetrics"][number]): string {
  const parts = [
    metric.titleIncluded ? "제목 포함" : "제목 누락",
    metric.introIncluded ? "도입부 포함" : "도입부 누락",
    `본문 ${metric.count}회`,
  ];
  return parts.join(" / ");
}

function metricAction(metric: SeoEvaluation["keywordMetrics"][number]): string {
  if (!metric.titleIncluded) return `제목 쪽에 '${metric.keyword}'를 더 직접적으로 드러내 주세요.`;
  if (!metric.introIncluded) return `첫 1~2문단 안에서 '${metric.keyword}'를 더 또렷하게 연결해 주세요.`;
  if (metric.count < metric.targetMin) return `본문에서 '${metric.keyword}'가 부족합니다. ${metric.targetMin}회 이상은 연결해 주세요.`;
  if (metric.count > metric.targetMax) return `본문에서 '${metric.keyword}'가 많습니다. 일부는 다른 설명 문장으로 바꿔 주세요.`;
  return `'${metric.keyword}' 배치는 현재 비교적 안정적입니다.`;
}

function sanitizeNotes(notes: string[]): string[] {
  return notes.filter((note) => note.trim() && !looksBroken(note));
}

function KeywordRiskReport({
  report,
  keywordStatusTone,
}: {
  report: KeywordUsageReport;
  keywordStatusTone: (status: KeywordUsageReport["items"][number]["status"]) => string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      {report.mainKeyword && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
          <p className="text-xs font-semibold text-zinc-500">메인 키워드</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-900">{report.mainKeyword.keyword}</p>
            <p className={`text-xs font-semibold ${keywordStatusTone(report.mainKeyword.status)}`}>
              본문 {report.mainKeyword.count}회 / {keywordStatusLabel(report.mainKeyword.status)}
            </p>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            적정 범위 {report.mainKeyword.targetMin}~{report.mainKeyword.targetMax}회
          </p>
          <p className="mt-1 text-xs text-zinc-700">{keywordRecommendation(report.mainKeyword, "main")}</p>
        </div>
      )}

      {report.subKeywords.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
          <p className="text-xs font-semibold text-zinc-500">서브 키워드</p>
          <div className="mt-2 space-y-2">
            {report.subKeywords.map((item) => (
              <div
                key={`sub-${item.keyword}`}
                className="rounded-md border border-zinc-200 bg-white px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-800">{item.keyword}</p>
                  <p className={`text-xs font-semibold ${keywordStatusTone(item.status)}`}>
                    본문 {item.count}회 / {keywordStatusLabel(item.status)}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  적정 범위 {item.targetMin}~{item.targetMax}회
                </p>
                <p className="mt-1 text-xs text-zinc-700">{keywordRecommendation(item, "sub")}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
        <p className="text-xs font-semibold text-zinc-500">전체 반복 위험도</p>
        <p className="mt-2 text-sm font-semibold text-zinc-900">{overallRiskLabel(report.overallRisk)}</p>
        <p className="mt-1 text-xs text-zinc-600">{overallRiskSummary(report)}</p>
      </div>

      {report.paragraphWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-xs font-semibold text-amber-700">문단 내 반복 경고</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-800">
            {report.paragraphWarnings.map((warning) => (
              <li key={`${warning.keyword}-${warning.paragraphIndex}`}>- {warning.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function KeywordTokenPanel({
  report,
  idPrefix,
}: {
  report: KeywordUsageReport;
  idPrefix: string;
}) {
  if ((report.tokenItems?.length ?? 0) === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-semibold text-zinc-600">실제 본문 핵심 단어 분포</p>
      <p className="mt-1 text-[11px] leading-5 text-zinc-500">
        선택된 포커스 키워드뿐 아니라, 본문 안에서 실제로 자주 반복된 핵심 단어 축도 함께 확인합니다.
      </p>
      <div className="mt-3 grid gap-2">
        {report.tokenItems.slice(0, 10).map((item) => (
          <div
            key={`${idPrefix}-token-${item.token}`}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-800">{item.token}</p>
              <p className={`text-xs font-semibold ${tokenTone(item.count)}`}>본문 {item.count}회</p>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">연결 구문: {item.sourceKeywords.join(" / ")}</p>
            <p className="mt-2 text-xs text-zinc-700">{tokenNote(item)}</p>
          </div>
        ))}
      </div>
    </div>
  );
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
        제목, 도입부, 소제목, 결론부를 기준으로 메인/서브 키워드 배치 완성도를 확인합니다.
      </p>
      <div className="mt-3 space-y-3">
        {seoEvaluation.keywordMetrics.map((metric) => (
          <div
            key={`${contentTab}-metric-${metric.keyword}`}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3"
          >
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
                <p className="text-[11px] font-semibold text-zinc-500">노출 잠재력</p>
                <p className={`mt-1 text-sm font-semibold ${scoreTone(metric.exposurePotentialScore)}`}>
                  {metric.exposurePotentialScore}점
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-zinc-600">{metricSummary(metric)}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              제목 {metric.titleIncluded ? "포함" : "누락"} / 도입부 {metric.introIncluded ? "포함" : "누락"} /
              적정 범위 {metric.targetMin}~{metric.targetMax}회 / 본문 {metric.count}회
            </p>
            <p className="mt-2 text-xs text-zinc-700">{metricAction(metric)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimpleNotePanel({
  title,
  notes,
}: {
  title: string;
  notes: string[];
}) {
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
  draftVersionReports,
  publishUrl,
  publishingToIndex,
  publishNotice,
  onPublishUrlChange,
  onPublishToIndex,
  keywordStatusTone,
}: Props) {
  const activeSeoEvaluation =
    contentTab === "revision" ? reviewResult?.seoEvaluation ?? null : result?.seoEvaluation ?? null;
  const activeKeywordReport =
    contentTab === "revision" ? reviewResult?.keywordReport ?? null : result?.seoEvaluation?.keywordReport ?? null;
  const activeSeoNotes = sanitizeNotes(
    contentTab === "revision" ? reviewResult?.seoNotes ?? [] : result?.seoEvaluation?.improvements ?? []
  );
  const activeNaverNotes = sanitizeNotes(
    contentTab === "revision" ? reviewResult?.naverLogicNotes ?? [] : result?.naverLogicEvaluation?.improvements ?? []
  );
  const showVersionedDraftReports = contentTab === "draft" && draftVersionReports.length > 0;

  return (
    <aside className="space-y-4">
      {approval}

      {!result && !reviewResult && draftVersionReports.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm font-semibold text-zinc-900">평가 / 보고서</p>
          <p className="mt-3 text-sm leading-7 text-zinc-500">
            초안 생성과 평가가 끝나면 이곳에 SEO, 네이버 로직, 해시태그, 추천 파일명이 정리됩니다.
          </p>
        </div>
      ) : null}

      {result && (
        <div
          className={`rounded-xl border p-4 ${
            result.pass ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={`text-sm font-semibold ${result.pass ? "text-emerald-700" : "text-amber-700"}`}>
                {result.pass ? "초안 평가 완료" : "초안 평가 보완 필요"}
              </p>
              <p className="mt-1 text-sm font-semibold text-zinc-900">{result.title}</p>
              <p className="mt-1 text-xs text-zinc-500">{result.wordCount.toLocaleString()}자</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold text-zinc-500">종합 점수</p>
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
                {result.pass ? "통과" : "보완"}
              </p>
            </div>
          </div>
        </div>
      )}

      {showVersionedDraftReports && (
        <div className="space-y-4">
          {draftVersionReports.map((report) => (
            <div key={report.label} className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{report.label} 키워드 / SEO 분석</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    각 초안 버전의 본문만 기준으로 메인/서브 키워드 반복도를 다시 계산합니다.
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
                  <p className="text-[11px] font-semibold text-emerald-700">SEO 점수</p>
                  <p className="text-lg font-bold text-emerald-700">{report.seoEvaluation.score}점</p>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <KeywordRiskReport report={report.keywordReport} keywordStatusTone={keywordStatusTone} />
                <KeywordTokenPanel report={report.keywordReport} idPrefix={report.label} />
              </div>
            </div>
          ))}
        </div>
      )}

      {activeKeywordReport && <KeywordRiskReport report={activeKeywordReport} keywordStatusTone={keywordStatusTone} />}
      {activeKeywordReport && <KeywordTokenPanel report={activeKeywordReport} idPrefix={contentTab} />}
      {activeSeoEvaluation && <SeoMetricPanel seoEvaluation={activeSeoEvaluation} contentTab={contentTab} />}

      {result?.naverLogicEvaluation && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-zinc-600">네이버 로직 평가</p>
              <p className="mt-1 text-sm font-semibold text-zinc-900">{result.naverLogicEvaluation.label}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {looksBroken(result.naverLogicEvaluation.reason)
                  ? "이 글이 네이버 검색 의도와 실제 선택 기준을 얼마나 충실하게 다루는지 평가한 결과입니다."
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
            <SimpleNotePanel title="근거" notes={sanitizeNotes(result.naverLogicEvaluation.evidence)} />
          )}
        </div>
      )}

      <SimpleNotePanel title="SEO 보완 포인트" notes={activeSeoNotes} />
      <SimpleNotePanel title="네이버 로직 보완 포인트" notes={activeNaverNotes} />

      {reviewIssues.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="mb-3 text-xs font-semibold text-zinc-600">수정본 검토 이슈</p>
          <div className="space-y-2">
            {reviewIssues.map((issue) => (
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
              수정본을 정리한 뒤 실제 네이버 블로그 발행 URL을 입력하면 발행 인덱스 반영까지 이어집니다.
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
              검토 결과가 편집기에 반영되어 있습니다. 마지막 본문과 제목을 한 번 더 확인해 주세요.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
