"use client";

import type { BodyRepetitionItem, KeywordUsageReport, SeoKeywordItem } from "@/lib/agents/types";

interface Props {
  report: KeywordUsageReport;
  title?: string;
  compact?: boolean;
}

function riskTone(risk: SeoKeywordItem["risk"]): string {
  if (risk === "ok") return "text-emerald-600";
  if (risk === "caution") return "text-amber-600";
  if (risk === "danger") return "text-red-600";
  return "text-blue-600";
}

function riskLabel(risk: SeoKeywordItem["risk"]): string {
  if (risk === "ok") return "적정";
  if (risk === "caution") return "주의";
  if (risk === "danger") return "위험";
  return "부족";
}

function roleLabel(role: SeoKeywordItem["role"]): string {
  return role === "main" ? "메인 키워드" : "서브 키워드";
}

function repetitionTone(severity: BodyRepetitionItem["severity"]): string {
  return severity === "caution" ? "text-amber-700" : "text-zinc-600";
}

function repetitionLabel(severity: BodyRepetitionItem["severity"]): string {
  return severity === "caution" ? "주의" : "안내";
}

export function KeywordReportSections({ report, title, compact = false }: Props) {
  const stageTitleClass = compact ? "text-[11px]" : "text-xs";
  const bodyClass = compact ? "text-[11px]" : "text-sm";
  const cardPadding = compact ? "p-3" : "p-4";

  return (
    <div className="space-y-3">
      {title ? <p className="text-sm font-semibold text-zinc-900">{title}</p> : null}

      <section className={`rounded-xl border border-zinc-200 bg-white ${cardPadding}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-semibold text-zinc-700 ${stageTitleClass}`}>Stage 1. SEO 키워드 사용량</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              계획된 메인/서브 키워드만 검사합니다. 정확일치와 긴 계획 키워드 포함형을 분리해 표시합니다.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
            {report.contractApplied ? "계약서 기준" : "추적 기준"}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {report.seoKeywordItems.map((item) => (
            <div key={`seo-${item.role}-${item.keyword}`} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`${bodyClass} font-semibold text-zinc-900`}>{item.keyword}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">{roleLabel(item.role)}</p>
                </div>
                <p className={`text-xs font-semibold ${riskTone(item.risk)}`}>
                  총 {item.effectiveCount}회 · {riskLabel(item.risk)}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-600">
                <div className="rounded-md bg-white px-2.5 py-2">exact {item.exactCount}회</div>
                <div className="rounded-md bg-white px-2.5 py-2">included {item.includedCount}회</div>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-zinc-500">{item.note}</p>
              <p className="mt-1 text-[11px] text-zinc-400">
                계획 키워드 제외 기준 적용: {item.exactPhraseExclusionApplied ? "예" : "아니오"}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className={`rounded-xl border border-zinc-200 bg-white ${cardPadding}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-semibold text-zinc-700 ${stageTitleClass}`}>Stage 2. 본문 반복 점검</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              본문에서 자주 반복된 단어와 문장 습관을 따로 점검합니다. 이 영역은 SEO 위험으로 계산하지 않습니다.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">SEO 위험 분리</span>
        </div>

        {report.bodyRepetitionItems.length === 0 ? (
          <div className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3 text-[11px] text-zinc-500">
            눈에 띄는 본문 반복 패턴이 없습니다.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {report.bodyRepetitionItems.map((item) => (
              <div key={`repeat-${item.category}-${item.token}`} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`${bodyClass} font-semibold text-zinc-900`}>{item.token}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {item.category} · {item.count}회 · isSeoRisk false
                    </p>
                  </div>
                  <p className={`text-xs font-semibold ${repetitionTone(item.severity)}`}>{repetitionLabel(item.severity)}</p>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-zinc-600">{item.message}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{item.suggestion}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
