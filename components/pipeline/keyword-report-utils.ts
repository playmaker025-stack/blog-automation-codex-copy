import type { BodyRepetitionItem, KeywordUsageReport, SeoKeywordItem } from "@/lib/agents/types";

const HEADING_LIKE_TERMS = [
  "체크포인트",
  "체크리스트",
  "기준",
  "이유",
  "정리",
  "가이드",
  "포인트",
];
const SENTENCE_LIKE_PATTERN = /(?:합니다|입니다|됩니다|보세요|하세요|주세요|입니다만|있습니다)$/u;

export function isDisplayableSeoKeywordPhrase(keyword: string, role: SeoKeywordItem["role"], contractApplied?: boolean): boolean {
  const normalized = keyword.trim();
  if (!normalized) return false;
  if (role === "main") return true;
  if (contractApplied) return true;
  if (normalized.length > 24) return false;
  if (normalized.includes("?") || normalized.includes("!")) return false;
  if (SENTENCE_LIKE_PATTERN.test(normalized)) return false;
  if (HEADING_LIKE_TERMS.some((term) => normalized.includes(term))) return false;
  return true;
}

export function getVisibleSeoKeywordItems(report: KeywordUsageReport): SeoKeywordItem[] {
  return report.seoKeywordItems.filter((item) =>
    isDisplayableSeoKeywordPhrase(item.keyword, item.role, report.contractApplied)
  );
}

export function getVisibleBodyRepetitionItems(report: KeywordUsageReport): BodyRepetitionItem[] {
  return report.bodyRepetitionItems.filter((item) => {
    if (item.category === "sentence_ending" || item.category === "verb_stem") return false;
    if (item.category === "category_word") return item.count >= 12;
    if (item.category === "noun") return item.count >= 8;
    return false;
  });
}

export function getDraftVersionReportForIndex<T>(reports: T[] | undefined, index: number): T | null {
  if (!reports || index < 0 || index >= reports.length) return null;
  return reports[index] ?? null;
}
