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
  return /[\uFFFD]|\u00C3|\u00C2|[\u00EC\u00ED\u00EF][\S\s]{0,3}[\u00EB\u00EA]|[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/.test(value);
}

function cleanNotes(notes: string[]): string[] {
  return notes.filter((note) => note.trim() && !looksBroken(note));
}

function keywordRecommendation(item: KeywordUsageReport["items"][number], role: "main" | "sub"): string {
  const range = `${item.targetMin}~${item.targetMax}회`;

  if (role === "main") {
    if (item.status === "under") {
      return `메인 키워드 '${item.keyword}'의 본문 반영이 부족합니다. 본문 기준 ${range} 안에서 핵심 문단에 자연스럽게 보강하세요.`;
    }
    if (item.status === "caution") {
      return `메인 키워드 '${item.keyword}'가 다소 많습니다. 같은 문단 반복을 줄이고 일부 표현은 동의어나 설명형 문장으로 바꾸세요.`;
    }
    if (item.status === "danger") {
      return `메인 키워드 '${item.keyword}'가 과하게 반복됩니다. 초안 보강 전에 반복 문장, 중복 소제목, 불필요한 재언급을 먼저 줄여야 합니다.`;
    }
    return `메인 키워드 '${item.keyword}'의 반복 횟수는 적정 범위입니다.`;
  }

  if (item.status === "under") {
    return `서브 키워드 '${item.keyword}'가 본문에 충분히 반영되지 않았습니다. 실제 설명 문맥에 1~3회만 자연스럽게 넣으세요.`;
  }
  if (item.status === "caution") {
    return `서브 키워드 '${item.keyword}'가 조금 많습니다. 같은 표현을 반복하기보다 의미를 풀어서 설명하세요.`;
  }
  if (item.status === "danger") {
    return `서브 키워드 '${item.keyword}'가 과하게 반복됩니다. 일부 문장은 일반 설명으로 바꾸고 반복 문단을 정리하세요.`;
  }
  return `서브 키워드 '${item.keyword}'의 반복 횟수는 적정 범위입니다.`;
}

function keywordRoleLabel(role: KeywordUsageReport["items"][number]["role"]): string {
  if (role === "main") return "메인 키워드";
  if (role === "bridge") return "브릿지 키워드";
  if (role === "anchor") return "내부링크 앵커";
  if (role === "forbidden") return "본문 금지어";
  return "서브 키워드";
}

function KeywordItemCard({
  item,
  keywordStatusTone,
}: {
  item: KeywordUsageReport["items"][number];
  keywordStatusTone: (status: KeywordUsageReport["items"][number]["status"]) => string;
}) {
  const isForbidden = item.role === "forbidden";
  return (
    <div className={`rounded-md border px-3 py-2 ${isForbidden ? "border-red-100 bg-red-50" : "border-zinc-200 bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-800">{item.keyword}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">{keywordRoleLabel(item.role)}</p>
        </div>
        <p className={`text-xs font-semibold ${keywordStatusTone(item.status)}`}>
          본문 {item.count}회 / {keywordStatusLabel(item.status)}
        </p>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        허용 범위 {item.targetMin}~{item.targetMax}회
      </p>
      <p className="mt-1 text-xs text-zinc-700">
        {item.recommendation || keywordRecommendation(item, item.role === "main" ? "main" : "sub")}
      </p>
    </div>
  );
}

function overallRiskSummary(report: KeywordUsageReport): string {
  const warningCount = report.paragraphWarnings.length;
  if (report.overallRisk === "high") {
    return warningCount > 0
      ? `과반복 위험이 큽니다. 문단 내 반복 경고가 ${warningCount}건 있어 같은 키워드가 한 문단에 몰려 있습니다.`
      : "과반복 위험이 큽니다. 메인/서브 키워드 반복을 줄인 뒤 다시 검수해야 합니다.";
  }
  if (report.overallRisk === "medium") {
    return warningCount > 0
      ? `반복 위험도는 보통입니다. 문단 내 반복 경고 ${warningCount}건을 먼저 정리하세요.`
      : "일부 키워드가 부족하거나 다소 많습니다. 문맥을 해치지 않는 선에서 조정하세요.";
  }
  return "키워드 반복 위험도는 낮습니다.";
}

function paragraphWarningText(warning: KeywordUsageReport["paragraphWarnings"][number]): string {
  return `${warning.paragraphIndex + 1}번 문단에서 '${warning.keyword}'가 ${warning.count}회 반복됩니다. 같은 문단 안의 반복을 줄이거나 표현을 분산하세요.`;
}

function tokenNote(item: KeywordUsageReport["tokenItems"][number]): string {
  if (item.count >= 20) {
    return "본문 전체에서 매우 자주 반복되는 단어입니다. 브랜드명이나 핵심 키워드가 아니라면 일부 표현을 바꾸는 편이 좋습니다.";
  }
  if (item.count >= 10) {
    return "본문에서 반복이 많은 단어입니다. 문맥상 필요한 반복인지 확인하세요.";
  }
  if (item.count >= 4) {
    return "보조 축으로 반복되는 단어입니다. 같은 문단에 몰려 있지 않은지 확인하세요.";
  }
  return "현재 본문에서 가볍게 반복되는 단어입니다.";
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
          <p className="mt-1 text-xs text-zinc-700">
            {report.mainKeyword.recommendation || keywordRecommendation(report.mainKeyword, "main")}
          </p>
        </div>
      )}

      {report.subKeywords.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
          <p className="text-xs font-semibold text-zinc-500">서브 키워드</p>
          <div className="mt-2 space-y-2">
            {report.subKeywords.map((item) => (
              <KeywordItemCard key={`sub-${item.keyword}`} item={item} keywordStatusTone={keywordStatusTone} />
            ))}
          </div>
        </div>
      )}

      {(report.bridgeKeywords?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3">
          <p className="text-xs font-semibold text-blue-700">브릿지 키워드</p>
          <p className="mt-1 text-[11px] leading-5 text-blue-600">
            다음 글로 넘길 연결 키워드입니다. 본문을 이 주제로 바꾸지 않고 제한 횟수 안에서만 씁니다.
          </p>
          <div className="mt-2 space-y-2">
            {report.bridgeKeywords?.map((item) => (
              <KeywordItemCard key={`bridge-${item.keyword}`} item={item} keywordStatusTone={keywordStatusTone} />
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
              <li key={`${warning.keyword}-${warning.paragraphIndex}`}>- {paragraphWarningText(warning)}</li>
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
        선택된 포커스 키워드뿐 아니라, 본문 안에서 실제로 자주 반복된 핵심 단어를 함께 확인합니다.
      </p>
      <div className="mt-3 grid gap-2">
        {report.tokenItems.slice(0, 10).map((item) => (
          <div key={`${idPrefix}-token-${item.token}`} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
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
  const activeSeoNotes = cleanNotes(
    contentTab === "revision" ? reviewResult?.seoNotes ?? [] : result?.seoEvaluation?.improvements ?? []
  );
  const activeNaverNotes = cleanNotes(
    contentTab === "revision" ? reviewResult?.naverLogicNotes ?? [] : result?.naverLogicEvaluation?.improvements ?? []
  );
  const visibleReviewIssues = reviewIssues.filter((issue) => !looksBroken(issue.message));
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

      {showVersionedDraftReports && (
        <div className="space-y-4">
          {draftVersionReports.map((report) => (
            <div key={report.label} className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{report.label} 키워드 / SEO 분석</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    각 초안별 본문 기준 키워드 반복과 위험도를 따로 계산합니다.
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
