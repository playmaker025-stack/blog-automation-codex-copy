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
  "팁",
  "후기",
  "전",
  "전에",
  "다음",
  "관련",
  "선행포스팅",
  "키워드빌드업",
]);

const REGION_KEYWORDS = [
  "부평",
  "만수동",
  "인천",
  "부천",
  "상동",
  "청라",
  "구월동",
  "송도",
  "주안",
  "만수",
] as const;

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

function sanitizeFilenamePart(value: string): string {
  const cleaned = value
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "미정";
}

function pickRegion(strategy: StrategyPlanResult, title: string, topicCategory?: string): string {
  const source = [title, topicCategory ?? "", ...strategy.keywords, strategy.targetMainKeyword ?? ""].join(" ");
  const matched = REGION_KEYWORDS.find((region) => source.includes(region));
  return matched ? `${matched}전자담배` : "지역미정";
}

function pickMainKeyword(strategy: StrategyPlanResult, title: string): string {
  return normalizePhrase(
    strategy.targetMainKeyword ??
      strategy.targetSearchCombinations?.find((item) => item.role === "main")?.phrase ??
      strategy.keywords[0] ??
      title
  );
}

function pickCategory(strategy: StrategyPlanResult, topicCategory?: string): string {
  return normalizePhrase(
    topicCategory ??
      strategy.targetSearchCombinations?.find((item) => item.role === "support")?.phrase ??
      strategy.keywords.find((keyword) => normalizePhrase(keyword) !== normalizePhrase(strategy.targetMainKeyword ?? "")) ??
      "카테고리미정"
  );
}

function pickBrand(strategy: StrategyPlanResult): string {
  return normalizePhrase(
    strategy.targetSearchCombinations?.find((item) => item.role === "brand")?.phrase ?? "브랜드미정"
  );
}

function pickIntent(strategy: StrategyPlanResult, title: string): string {
  const source = [title, strategy.rationale, ...strategy.keyPoints].join(" ");
  if (/해결|해결방법|해결법/u.test(source)) return "해결방법";
  if (/비교|차이|구분/u.test(source)) return "비교";
  if (/추천|픽|TOP|top/u.test(source)) return "추천";
  if (/고르는|고르기|선택|기준/u.test(source)) return "선택기준";
  if (/관리|교체|점검/u.test(source)) return "관리";
  return "정보정리";
}

function filterUsefulTagValues(values: string[]): string[] {
  return values.filter((value) => {
    const normalized = normalizePhrase(value).toLowerCase();
    if (!normalized || normalized.length < 2) return false;
    if (HASHTAG_STOPWORDS.has(normalized)) return false;
    if (/^\d+$/u.test(normalized)) return false;
    return true;
  });
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

  const imageFileNames = Array.from({ length: Math.max(1, Math.min(12, imageCount)) }, (_, index) =>
    [
      sanitizeFilenamePart(region),
      sanitizeFilenamePart(mainKeyword),
      sanitizeFilenamePart(category),
      sanitizeFilenamePart(brand),
      sanitizeFilenamePart(intent),
      String(index + 1).padStart(2, "0"),
    ].join("_")
  );

  return { hashtags, imageFileNames };
}
