"use client";

import type { BodyRepetitionItem, KeywordUsageReport, SeoKeywordItem } from "@/lib/agents/types";
import {
  DEFAULT_STAGE1_VISIBLE_COUNT,
  DEFAULT_STAGE2_VISIBLE_COUNT,
  getOverflowItems,
  getPrimaryItems,
  getVisibleBodyRepetitionItems,
  getVisibleSeoKeywordItems,
} from "@/components/pipeline/keyword-report-utils";

interface Props {
  report: KeywordUsageReport;
  title?: string;
  compact?: boolean;
}

function keywordRiskLabel(risk: SeoKeywordItem["risk"]): string {
  if (risk === "ok") return "적정";
  if (risk === "caution") return "주의";
  if (risk === "danger") return "위험";
  return "부족";
}

function keywordRiskTone(risk: SeoKeywordItem["risk"]): string {
  if (risk === "ok") return "text-emerald-600";
  if (risk === "caution") return "text-amber-600";
  if (risk === "danger") return "text-red-600";
  return "text-blue-600";
}

function keywordRoleLabel(role: SeoKeywordItem["role"]): string {
  return role === "main" ? "메인 키워드" : "서브 키워드";
}

function repetitionCategoryLabel(category: BodyRepetitionItem["category"]): string {
  return category === "category_word" ? "카테고리어" : "일반 명사";
}

function repetitionSeverityLabel(severity: BodyRepetitionItem["severity"]): string {
  return severity === "caution" ? "주의" : "안내";
}

function repetitionTone(severity: BodyRepetitionItem["severity"]): string {
  return severity === "caution" ? "text-amber-700" : "text-zinc-600";
}

function SeoKeywordCard({ item }: { item: SeoKeywordItem }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">{item.keyword}</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {keywordRoleLabel(item.role)} · 사용 {item.effectiveCount}회
          </p>
        </div>
        <p className={`shrink-0 text-xs font-semibold ${keywordRiskTone(item.risk)}`}>{keywordRiskLabel(item.risk)}</p>
      </div>

      <details className="mt-2 rounded-md bg-white px-2.5 py-2 text-[11px] text-zinc-600">
        <summary className="cursor-pointer font-medium text-zinc-500">상세 보기</summary>
        <div className="mt-2 space-y-1">
          <p>정확일치 {item.exactCount}회</p>
          <p>포함형 {item.includedCount}회</p>
          <p>{item.note}</p>
        </div>
      </details>
    </div>
  );
}

function BodyRepetitionCard({ item }: { item: BodyRepetitionItem }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">{item.token}</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {repetitionCategoryLabel(item.category)} · {item.count}회 · {repetitionSeverityLabel(item.severity)}
          </p>
        </div>
        <p className={`shrink-0 text-xs font-semibold ${repetitionTone(item.severity)}`}>
          {repetitionSeverityLabel(item.severity)}
        </p>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-zinc-600">{item.message}</p>
      <p className="mt-1 text-[11px] text-zinc-500">{item.suggestion}</p>
    </div>
  );
}

export function KeywordReportSections({ report, title, compact = false }: Props) {
  const sectionPadding = compact ? "p-3" : "p-4";
  const titleClass = compact ? "text-[11px]" : "text-xs";

  const seoItems = getVisibleSeoKeywordItems(report);
  const repetitionItems = getVisibleBodyRepetitionItems(report);

  const primarySeoItems = getPrimaryItems(seoItems, DEFAULT_STAGE1_VISIBLE_COUNT);
  const overflowSeoItems = getOverflowItems(seoItems, DEFAULT_STAGE1_VISIBLE_COUNT);
  const primaryRepetitionItems = getPrimaryItems(repetitionItems, DEFAULT_STAGE2_VISIBLE_COUNT);
  const overflowRepetitionItems = getOverflowItems(repetitionItems, DEFAULT_STAGE2_VISIBLE_COUNT);

  return (
    <div className="space-y-3">
      {title ? <p className="text-sm font-semibold text-zinc-900">{title}</p> : null}

      <section className={`rounded-xl border border-zinc-200 bg-white ${sectionPadding}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-semibold text-zinc-700 ${titleClass}`}>Stage 1. SEO 키워드 사용량</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              확정된 메인 키워드와 서브 키워드만 표시합니다.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
            {report.contractApplied ? "계약서 기준" : "확정 키워드 기준"}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {primarySeoItems.length === 0 ? (
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3 text-[11px] text-zinc-500">
              표시 가능한 SEO 키워드가 없습니다.
            </div>
          ) : (
            primarySeoItems.map((item) => <SeoKeywordCard key={`seo-${item.role}-${item.keyword}`} item={item} />)
          )}

          {overflowSeoItems.length > 0 ? (
            <details className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
              <summary className="cursor-pointer text-[11px] font-semibold text-zinc-600">
                자세히 보기 ({overflowSeoItems.length}개)
              </summary>
              <div className="mt-3 space-y-2">
                {overflowSeoItems.map((item) => (
                  <SeoKeywordCard key={`seo-overflow-${item.role}-${item.keyword}`} item={item} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </section>

      <section className={`rounded-xl border border-zinc-200 bg-white ${sectionPadding}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-semibold text-zinc-700 ${titleClass}`}>Stage 2. 본문 반복 점검</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">
              이 영역은 SEO 위험이 아니라 문장 리듬과 단어 반복 점검입니다.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">반복 점검</span>
        </div>

        <div className="mt-3 space-y-2">
          {primaryRepetitionItems.length === 0 ? (
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3 text-[11px] text-zinc-500">
              기본 표시 기준에 맞는 반복 항목이 없습니다.
            </div>
          ) : (
            primaryRepetitionItems.map((item) => (
              <BodyRepetitionCard key={`repeat-${item.category}-${item.token}`} item={item} />
            ))
          )}

          {overflowRepetitionItems.length > 0 ? (
            <details className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
              <summary className="cursor-pointer text-[11px] font-semibold text-zinc-600">
                자세히 보기 ({overflowRepetitionItems.length}개)
              </summary>
              <div className="mt-3 space-y-2">
                {overflowRepetitionItems.map((item) => (
                  <BodyRepetitionCard key={`repeat-overflow-${item.category}-${item.token}`} item={item} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </section>
    </div>
  );
}
