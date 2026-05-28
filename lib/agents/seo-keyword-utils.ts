import type { SeoKeywordItem } from "./types";

const BLOCKED_KEYWORD_PARTS = [
  "체크포인트",
  "체크리스트",
  "기준",
  "먼저",
  "시작 전에",
  "놓치는",
  "알아야 할",
  "확인해야 할",
  "정리",
  "이유",
  "방법",
  "포인트",
];

const SENTENCE_ENDING_PATTERN =
  /(합니다|입니다|됩니다|있습니다|주세요|보세요|하세요|합니다만|됩니다만)$/u;

function normalizeKeyword(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function isValidSeoKeyword(keyword: string): boolean {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return false;
  if (normalized.length > 24) return false;
  if (normalized.includes("?") || normalized.includes("!")) return false;
  if (SENTENCE_ENDING_PATTERN.test(normalized)) return false;
  if (BLOCKED_KEYWORD_PARTS.some((term) => normalized.includes(term))) return false;

  const wordCount = normalized.split(/\s+/).length;
  if (wordCount >= 5) return false;

  return true;
}

export function filterValidSeoKeywordItems(items: SeoKeywordItem[]): SeoKeywordItem[] {
  return items.filter((item) => (item.role === "main" || item.role === "sub") && isValidSeoKeyword(item.keyword));
}
