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

function repetitionCategoryLabel(category: BodyRepetitionItem["category"]): string {
  if (category === "category_word") return "카테고리어";
  if (category === "noun") return "일반 명사";
  if (category === "verb_stem") return "동사 어간";
  return "문장 어미";
}

function repetitionSeverityLabel(severity: BodyRepetitionItem["severity"]): string {
  return severity === "caution" ? "주의" : "안내";
}

function repetitionTone(severity: BodyRepetitionItem["severity"]): string {
  return severity === "caution" ? "text-amber-700" : "text-zinc-600";
}

function shouldShowRepetitionItem(item: BodyRepetitionItem): boolean {
  if (item.category === "sentence_ending" || item.category === "verb_stem") return false;
  if (item.category === "category_word") return item.count >= 12;
  if (item.category === "noun") return item.count >= 8;
  return false;
}

export function KeywordReportSections({ report, title, compact = false }: Props) {
  const stageTitleClass = compact ? "text-[11px]" : "text-xs";
  const bodyClass = compact ? "text-[11px]" : "text-sm";
  const cardPadding = compact ? "p-3" : "p-4";
  const visibleRepetitionItems = report.bodyRepetitionItems.filter(shouldShowRepetitionItem);

  return (
    <div className="space-y-3">
      {title ? <p className="text-sm font-semibold text-zinc-900">{title}</p> : null}

      <section className={`rounded-xl border border-zinc-200 bg-white ${cardPadding}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-semibold text-zinc-700 ${stageTitleClass}`}>Stage 1. SEO 키워드 사용량</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              메인 키워드와 서브 키워드만 집계합니다. 정확일치와 더 긴 계획 키워드에 포함된 횟수를 구분해 표시합니다.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
            {report.contractApplied ? "계획 키워드 기준" : "본문 추적 기준"}
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
                <p className={`text-xs font-semibold ${riskTone(item.risk)}`}>{riskLabel(item.risk)}</p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-600">
                <div className="rounded-md bg-white px-2.5 py-2">exact {item.exactCount}회</div>
                <div className="rounded-md bg-white px-2.5 py-2">included {item.includedCount}회</div>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-zinc-500">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={`rounded-xl border border-zinc-200 bg-white ${cardPadding}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-semibold text-zinc-700 ${stageTitleClass}`}>Stage 2. 본문 반복 점검</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              이 영역은 SEO 위험이 아니라 문장 리듬과 단어 반복 점검입니다.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">리듬 점검</span>
        </div>

        {visibleRepetitionItems.length === 0 ? (
          <div className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3 text-[11px] text-zinc-500">
            기본 표시 기준을 넘는 반복 항목이 없습니다.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {visibleRepetitionItems.map((item) => (
              <div key={`repeat-${item.category}-${item.token}`} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`${bodyClass} font-semibold text-zinc-900`}>{item.token}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {repetitionCategoryLabel(item.category)} · {item.count}회 · {repetitionSeverityLabel(item.severity)}
                    </p>
                  </div>
                  <p className={`text-xs font-semibold ${repetitionTone(item.severity)}`}>
                    {repetitionSeverityLabel(item.severity)}
                  </p>
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
