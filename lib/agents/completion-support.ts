import type { StrategyPlanResult } from "./types";

const HASHTAG_STOPWORDS = new Set([
  "보는",
  "많이",
  "고르기",
  "선택",
  "이유",
  "정리",
  "가이드",
  "체크",
  "체크포인트",
  "방법",
  "처음",
  "후기",
  "전",
  "전에",
  "다음",
  "관리",
  "선행포스팅",
  "키워드빌드업",
]);

const REGION_ALIASES: Record<string, string> = {
  부평: "bupyeong",
  만수동: "mansu",
  만수: "mansu",
  인천: "incheon",
  부천: "bucheon",
  상동: "sangdong",
  계양: "gyeyang",
  계산동: "gyesandong",
  남동구: "namdong",
  주안: "juan",
  구월동: "guwoldong",
};

const TOKEN_ALIASES: Record<string, string> = {
  전자담배: "vape",
  전담: "vape",
  입호흡: "mtl",
  폐호흡: "dtl",
  액상: "liquid",
  팟: "pod",
  코일: "coil",
  기기: "device",
  추천: "recommend",
  비교: "compare",
  후기: "review",
  사용처: "usage",
  지원금: "support",
  결제: "payment",
  입문자: "starter",
  초보자: "starter",
  브랜드: "brand",
  관리: "care",
};

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizePhrase(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function makeHashtagText(value: string): string {
  return `#${value.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, "")}`;
}

function romanizeToken(token: string): string {
  const normalized = normalizePhrase(token);
  if (!normalized) return "";

  const directRegion = REGION_ALIASES[normalized];
  if (directRegion) return directRegion;

  const directToken = TOKEN_ALIASES[normalized];
  if (directToken) return directToken;

  const ascii = normalized
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .trim()
    .replace(/\s+/g, "_");
  if (ascii) return ascii;

  const mapped = normalized
    .split(/\s+/)
    .map((part) => REGION_ALIASES[part] || TOKEN_ALIASES[part] || "")
    .filter(Boolean)
    .join("_");
  return mapped;
}

function sanitizeFilenamePart(value: string): string {
  return romanizeToken(value)
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function pickRegion(strategy: StrategyPlanResult, title: string, topicCategory?: string): string {
  const source = [title, topicCategory ?? "", ...strategy.keywords, strategy.targetMainKeyword ?? ""].join(" ");
  return Object.keys(REGION_ALIASES).find((region) => source.includes(region)) ?? "";
}

function pickMainKeyword(strategy: StrategyPlanResult, title: string): string {
  return normalizePhrase(
    strategy.targetMainKeyword ??
      strategy.targetSearchCombinations?.find((item) => item.role === "main")?.phrase ??
      strategy.keywordContract?.mainKeyword ??
      strategy.keywords[0] ??
      title
  );
}

function pickCategory(strategy: StrategyPlanResult, topicCategory?: string): string {
  return normalizePhrase(
    topicCategory ??
      strategy.targetSearchCombinations?.find((item) => item.role === "support")?.phrase ??
      strategy.keywordContract?.subKeywords?.[0] ??
      strategy.keywords.find((keyword) => normalizePhrase(keyword) !== normalizePhrase(strategy.targetMainKeyword ?? "")) ??
      ""
  );
}

function pickBrand(strategy: StrategyPlanResult): string {
  return normalizePhrase(
    strategy.targetSearchCombinations?.find((item) => item.role === "brand")?.phrase ?? ""
  );
}

function pickIntent(strategy: StrategyPlanResult, title: string): string {
  const source = [title, strategy.rationale, ...strategy.keyPoints].join(" ");
  if (/(해결|해결방법|원인)/u.test(source)) return "해결";
  if (/(비교|차이|구분)/u.test(source)) return "비교";
  if (/(추천|top|TOP)/u.test(source)) return "추천";
  if (/(고르는|고르기|선택|기준)/u.test(source)) return "선택기준";
  if (/(관리|교체|점검)/u.test(source)) return "관리";
  return "안내";
}

function filterUsefulTagValues(values: string[]): string[] {
  return values.filter((value) => {
    const normalized = normalizePhrase(value).toLowerCase();
    if (!normalized || normalized.length < 2) return false;
    if (HASHTAG_STOPWORDS.has(normalized)) return false;
    if (/^\d+$/u.test(normalized)) return false;
    if (/미정/u.test(normalized)) return false;
    return true;
  });
}

function buildFilenameParts(parts: string[]): string[] {
  return parts
    .map(sanitizeFilenamePart)
    .filter(Boolean);
}

export function buildCompletionSupportFromRules(
  strategy: StrategyPlanResult,
  title: string,
  topicCategory?: string,
  imageCount = 5
): {
  hashtags: string[];
  imageFileNames: string[];
} {
  const mainKeyword = pickMainKeyword(strategy, title);
  const region = pickRegion(strategy, title, topicCategory);
  const category = pickCategory(strategy, topicCategory);
  const brand = pickBrand(strategy);
  const intent = pickIntent(strategy, title);
  const supportPhrases = uniq([
    ...(strategy.keywordContract?.subKeywords ?? []),
    ...strategy.keywords,
    ...(strategy.targetSearchCombinations ?? [])
      .filter((item) => item.priority === "core" || item.role === "brand" || item.role === "local")
      .map((item) => item.phrase),
  ]).filter((keyword) => normalizePhrase(keyword) !== mainKeyword);

  const hashtags = uniq(
    filterUsefulTagValues([
      mainKeyword,
      region,
      category,
      brand,
      intent,
      ...supportPhrases.slice(0, 4),
    ]).map(makeHashtagText)
  ).slice(0, 10);

  const filenameBase = buildFilenameParts([region, mainKeyword, category, brand, intent]);
  const safeBase = filenameBase.length > 0 ? filenameBase : buildFilenameParts([mainKeyword, category, intent]);

  const imageFileNames = Array.from({ length: Math.max(1, Math.min(12, imageCount)) }, (_, index) =>
    [...safeBase, String(index + 1).padStart(2, "0")].join("_")
  );

  return { hashtags, imageFileNames };
}
