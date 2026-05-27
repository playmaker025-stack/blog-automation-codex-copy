import { sanitizeMainKeywordCandidate } from "./search-combination-utils.ts";

export interface DirectKeywordIntent {
  mainKeyword: string;
  subKeywords: string[];
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const GENERIC_KEYWORD_SET = new Set([
  "전자담배",
  "추천",
  "고르기",
  "고르는",
  "전에",
  "많이",
  "보는",
  "선택",
  "선택기준",
  "기준",
  "방법",
  "정리",
  "가이드",
  "선행포스팅",
  "키워드빌드업",
  "메인포스팅",
  "입문",
  "시작",
  "체크",
  "체크포인트",
  "체크리스트",
  "포인트",
  "팁",
  "방향",
  "초보자",
  "초보",
]);

function isGenericKeyword(value: string): boolean {
  const normalized = normalizeKeyword(value).toLowerCase();
  if (!normalized || normalized.length < 2) return true;
  if (GENERIC_KEYWORD_SET.has(normalized)) return true;
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length > 1 && tokens.every((token) => GENERIC_KEYWORD_SET.has(token))) return true;
  return false;
}

const SENTENCE_ADVERBS = new Set(["자주", "항상", "정말", "너무", "매우", "꼭", "바로", "모두", "항시", "늘"]);

function sanitizeAiKeyword(keyword: string): string | null {
  const normalized = normalizeKeyword(keyword);
  if (!normalized || normalized.length > 20) return null;
  const tokens = normalized.split(/\s+/);
  if (tokens.length >= 5) return null;
  if (tokens.some((token) => /[가이은는을를에서]$/.test(token))) return null;
  if (tokens.some((token) => /(하는|있는|없는|되는|놓치는|알아야|해야|하면|찾는법|하는법)$/.test(token))) return null;
  if (tokens.some((token) => SENTENCE_ADVERBS.has(token))) return null;
  if (/TOP\s?\d+|^\d+선$|^\d+가지$/.test(normalized)) return null;
  if (/픽$|만수르|인천\s*만수/.test(normalized)) return null;
  return normalized;
}

export function sanitizeDirectIntent(rawDirectIntent: DirectKeywordIntent | null): DirectKeywordIntent | null {
  if (!rawDirectIntent) return null;

  const mainKeyword = rawDirectIntent.mainKeyword
    ? sanitizeMainKeywordCandidate(rawDirectIntent.mainKeyword) ?? ""
    : "";
  const subKeywords = uniq(
    rawDirectIntent.subKeywords
      .map((keyword) => sanitizeAiKeyword(normalizeKeyword(keyword)))
      .filter((keyword): keyword is string => keyword !== null)
      .filter((keyword) => !isGenericKeyword(keyword))
      .filter((keyword) => keyword.toLowerCase() !== mainKeyword.toLowerCase())
  );

  if (!mainKeyword && subKeywords.length === 0) return null;
  return { mainKeyword, subKeywords };
}
