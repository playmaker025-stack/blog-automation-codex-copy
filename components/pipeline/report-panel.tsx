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

function issueTone(severity: DraftReviewIssue["severity"]): string {
  if (severity === "blocker") return "text-red-500";
  if (severity === "warning") return "text-amber-500";
  return "text-zinc-400";
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

function KeywordRiskReport({
  report,
  keywordStatusTone,
}: {
  report: KeywordUsageReport;
  keywordStatusTone: (status: KeywordUsageReport["items"][number]["status"]) => string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
      {report.mainKeyword && (
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
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
          <p className="mt-1 text-xs text-zinc-700">{report.mainKeyword.recommendation}</p>
        </div>
      )}

      {report.subKeywords.length > 0 && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-white px-3 py-3">
          <p className="text-xs font-semibold text-zinc-500">서브 키워드</p>
          {report.subKeywords.map((item) => (
            <div
              key={`sub-${item.keyword}`}
              className="flex items-start justify-between gap-3 border-b border-zinc-100 py-2 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-800">{item.keyword}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  적정 범위 {item.targetMin}~{item.targetMax}회
                </p>
                <p className="mt-1 text-xs text-zinc-700">{item.recommendation}</p>
              </div>
              <p className={`shrink-0 text-xs font-semibold ${keywordStatusTone(item.status)}`}>
                본문 {item.count}회 / {keywordStatusLabel(item.status)}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
        <p className="text-xs font-semibold text-zinc-500">전체 반복 위험도</p>
        <p className="mt-2 text-sm font-semibold text-zinc-900">{overallRiskLabel(report.overallRisk)}</p>
        <p className="mt-1 text-xs text-zinc-600">{report.overallRiskSummary}</p>
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
  if ((report.tokenItems?.length ?? 0) === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-zinc-600">실제 본문 핵심 단어 분포</p>
        <p className="mt-1 text-[11px] leading-5 text-zinc-500">
          선택된 포커스 구문만이 아니라, 본문에서 반복된 핵심 단어 축까지 함께 확인합니다.
        </p>
      </div>
      <div className="grid gap-2">
        {report.tokenItems.slice(0, 10).map((item) => (
          <div
            key={`${idPrefix}-token-${item.token}`}
            className="rounded-lg border border-zinc-100 bg-white px-3 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-800">{item.token}</p>
              <p className={`text-xs font-semibold ${tokenTone(item.count)}`}>실제 발생 {item.count}회</p>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">연결 구문: {item.sourceKeywords.join(" / ")}</p>
            <p className="mt-2 text-xs text-zinc-700">{item.note}</p>
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
  if ((seoEvaluation.keywordMetrics?.length ?? 0) === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-zinc-600">키워드 배치 품질 지표</p>
        <p className="mt-1 text-[11px] leading-5 text-zinc-500">
          제목, 도입부, 소제목, 결론부 기준으로 메인과 서브 키워드의 배치 완성도를 보여줍니다.
        </p>
      </div>
      {seoEvaluation.keywordMetrics.map((metric) => (
        <div
          key={`${contentTab}-metric-${metric.keyword}`}
          className="rounded-lg border border-zinc-100 bg-white px-3 py-3"
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
            <div className="rounded-md bg-zinc-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-zinc-500">완성도</p>
              <p className={`mt-1 text-sm font-semibold ${scoreTone(metric.completenessScore)}`}>
                {metric.completenessScore}점
              </p>
            </div>
            <div className="rounded-md bg-zinc-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-zinc-500">노출 잠재력</p>
              <p className={`mt-1 text-sm font-semibold ${scoreTone(metric.exposurePotentialScore)}`}>
                {metric.exposurePotentialScore}점
              </p>
            </div>
          </div>

          <p className="mt-3 text-xs text-zinc-600">{metric.summary}</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            제목 {metric.titleIncluded ? "포함" : "미포함"} / 도입부 {metric.introIncluded ? "포함" : "미포함"} /
            적정 범위 {metric.targetMin}~{metric.targetMax}회 / 본문 {metric.count}회
          </p>
        </div>
      ))}
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
  if (notes.length === 0) {
    return null;
  }

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
    contentTab === "revision"
      ? reviewResult?.keywordReport ?? null
      : result?.seoEvaluation?.keywordReport ?? null;
  const activeSeoNotes =
    contentTab === "revision"
      ? reviewResult?.seoNotes ?? []
      : [...(result?.seoEvaluation?.evidence ?? []), ...(result?.seoEvaluation?.improvements ?? [])].slice(0, 6);
  const activeNaverNotes =
    contentTab === "revision"
      ? reviewResult?.naverLogicNotes ?? []
      : [
          ...(result?.naverLogicEvaluation?.evidence ?? []),
          ...(result?.naverLogicEvaluation?.improvements ?? []),
        ].slice(0, 6);
  const showVersionedDraftReports = contentTab === "draft" && draftVersionReports.length > 0;

  return (
    <aside className="min-w-0 space-y-4 xl:sticky xl:top-8">
      {approval}

      {result ? (
        <>
          <div
            className={`rounded-xl border p-5 ${
              result.pass ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={`text-sm font-semibold ${result.pass ? "text-emerald-700" : "text-amber-700"}`}>
                  {result.pass ? "초안 평가 통과" : "초안 평가 보완 필요"}
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
                <p className="mt-1 text-sm font-semibold text-zinc-900">{result.pass ? "통과" : "보완"}</p>
              </div>
            </div>
          </div>

          {showVersionedDraftReports ? (
            <div className="space-y-3">
              {draftVersionReports.map((report) => (
                <div
                  key={`draft-report-${report.label}`}
                  className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-zinc-600">{report.label}</p>
                      <p className="mt-1 text-sm font-semibold text-zinc-900">버전별 키워드 / SEO 분석</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        각 초안 버전의 본문만 기준으로 메인, 서브, 반복 위험도를 다시 계산합니다.
                      </p>
                    </div>
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-right">
                      <p className="text-[11px] font-semibold text-emerald-600">SEO 점수</p>
                      <p className="text-lg font-bold text-emerald-700">{report.seoEvaluation.score}점</p>
                    </div>
                  </div>

                  <KeywordRiskReport report={report.keywordReport} keywordStatusTone={keywordStatusTone} />
                  <KeywordTokenPanel report={report.keywordReport} idPrefix={report.label} />
                </div>
              ))}
            </div>
          ) : activeSeoEvaluation && activeKeywordReport ? (
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-600">SEO 분석</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                    {contentTab === "revision" ? "수정본 기준 SEO 분석" : "초안 기준 SEO 분석"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {contentTab === "revision"
                      ? "수정된 실제 본문 기준으로 키워드와 배치 품질을 다시 점검합니다."
                      : "생성된 초안 본문 기준으로 키워드와 배치 품질을 점검합니다."}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-right">
                  <p className="text-[11px] font-semibold text-emerald-600">SEO 점수</p>
                  <p className="text-lg font-bold text-emerald-700">{activeSeoEvaluation.score}점</p>
                </div>
              </div>

              <KeywordRiskReport report={activeKeywordReport} keywordStatusTone={keywordStatusTone} />
              <KeywordTokenPanel report={activeKeywordReport} idPrefix={contentTab} />
              <SeoMetricPanel seoEvaluation={activeSeoEvaluation} contentTab={contentTab} />
            </div>
          ) : null}

          {result.naverLogicEvaluation && (
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-600">네이버 로직 평가</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">{result.naverLogicEvaluation.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">{result.naverLogicEvaluation.reason}</p>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-right">
                  <p className="text-[11px] font-semibold text-blue-600">완성도</p>
                  <p className="text-lg font-bold text-blue-700">
                    {result.naverLogicEvaluation.completenessScore}점
                  </p>
                </div>
              </div>

              {activeNaverNotes.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-zinc-600">근거와 보완 포인트</p>
                  <ul className="space-y-1">
                    {activeNaverNotes.map((item, index) => (
                      <li key={`naver-${index}`} className="flex gap-2 text-sm text-zinc-700">
                        <span className="text-zinc-400">-</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {contentTab === "revision" && reviewResult && (
            <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div>
                <p className="text-xs font-semibold text-blue-700">수정본 추가 검토</p>
                <p className="mt-1 text-xs text-blue-600">
                  수정 후 실제 본문을 기준으로 키워드 반복과 배치 품질을 다시 점검합니다.
                </p>
              </div>

              {reviewResult.keywordReport.items.length > 0 && (
                <KeywordRiskReport report={reviewResult.keywordReport} keywordStatusTone={keywordStatusTone} />
              )}
            </div>
          )}

          <SimpleNotePanel title="SEO 근거" notes={activeSeoNotes} />
          <SimpleNotePanel title="추가 권장 사항" notes={result.recommendations} />

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
              <p className="mb-2 text-xs font-semibold text-zinc-600">사진 파일명 예시</p>
              <ul className="space-y-1">
                {result.imageFileNames?.map((name) => (
                  <li
                    key={name}
                    className="rounded border border-zinc-100 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
            <div>
              <p className="text-xs font-semibold text-zinc-600">실제 발행 URL 반영</p>
              {!reviewApplied && (
                <p className="mt-1 text-xs text-amber-600">
                  수정본 실제 반영을 끝낸 뒤에만 발행 URL을 입력해 인덱스에 반영해야 합니다.
                </p>
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
              {publishingToIndex ? "발행 URL 반영 중..." : "실제 발행 URL을 인덱스에 반영"}
            </button>
            {publishNotice && (
              <p className={`text-xs ${publishNotice.type === "ok" ? "text-emerald-600" : "text-red-500"}`}>
                {publishNotice.msg}
              </p>
            )}
          </div>

          {reviewIssues.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <p className="mb-2 text-xs font-semibold text-zinc-600">검토 이슈</p>
              <ul className="space-y-1">
                {reviewIssues.map((issue, index) => (
                  <li key={`${issue.message}-${index}`} className="flex gap-2 text-sm text-zinc-700">
                    <span className={issueTone(issue.severity)}>-</span>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6">
          <p className="text-sm font-semibold text-zinc-700">평가 / 보고서 안내</p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            초안 생성과 평가가 끝나면 이곳에 SEO, 네이버 로직, 해시태그, 사진 파일명, 키워드 반복 위험도
            보고서가 정리됩니다.
          </p>
        </div>
      )}
    </aside>
  );
}
