import type { BodyRepetitionItem, KeywordUsageReport, SeoKeywordItem } from "../../lib/agents/types";
import { filterValidSeoKeywordItems } from "../../lib/agents/seo-keyword-utils.ts";

export const DEFAULT_STAGE1_VISIBLE_COUNT = 4;
export const DEFAULT_STAGE2_VISIBLE_COUNT = 4;

export function getVisibleSeoKeywordItems(report: KeywordUsageReport): SeoKeywordItem[] {
  return filterValidSeoKeywordItems(report.seoKeywordItems ?? []);
}

export function getVisibleBodyRepetitionItems(report: KeywordUsageReport): BodyRepetitionItem[] {
  return (report.bodyRepetitionItems ?? []).filter((item) => {
    if (item.category === "sentence_ending" || item.category === "verb_stem") return false;
    if (item.category === "category_word") return item.count >= 12;
    if (item.category === "noun") return item.count >= 8;
    return false;
  });
}

export function getPrimaryItems<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

export function getOverflowItems<T>(items: T[], limit: number): T[] {
  return items.slice(limit);
}

export function getDraftVersionReportForIndex<T>(reports: T[] | undefined, index: number): T | null {
  if (!reports || index < 0 || index >= reports.length) return null;
  return reports[index] ?? null;
}
