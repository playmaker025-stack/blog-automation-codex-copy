import type { Topic } from "@/lib/types/github-data";
import type { ArticlePlan, DuplicateMode, StrategyPlanResult, TopicIntentResolution } from "./types";

function normalize(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

const GENERIC_KEYWORDS = new Set([
  "비교",
  "추천",
  "기기",
  "제품",
  "기준",
  "사용자",
  "액상",
  "관리",
  "선택",
  "이유",
  "방법",
  "체크포인트",
  "체크리스트",
  "가이드",
  "정리",
]);

function isGenericKeyword(value: string): boolean {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return true;
  if (GENERIC_KEYWORDS.has(normalized)) return true;
  const tokens = normalized.split(/\s+/);
  return tokens.length > 0 && tokens.every((token) => GENERIC_KEYWORDS.has(token));
}

function isEntityLike(value: string): boolean {
  const normalized = normalize(value);
  if (!normalized || isGenericKeyword(normalized)) return false;
  if (normalized.length <= 1) return false;
  if (normalized.split(/\s+/).length >= 4) return false;
  if (/^[가-힣]{2,4}$/.test(normalized)) return false;
  if (/[0-9A-Za-z]/.test(normalized)) return true;
  if (/[A-Z]/.test(normalized)) return true;
  if (normalized.split(/\s+/).length >= 2) return true;
  return false;
}

function buildProductSections(requiredEntities: string[]): string[] {
  return requiredEntities.map((entity) => `${entity} 추천 이유와 추천 대상`);
}

export function buildArticlePlan(params: {
  topic: Topic;
  plan: StrategyPlanResult;
  topicIntentResolution: TopicIntentResolution;
  duplicateMode?: DuplicateMode;
}): ArticlePlan {
  const mainKeyword = normalize(
    params.plan.keywordContract?.mainKeyword ||
      params.topic.targetKeyword ||
      params.topic.targetMainKeyword ||
      params.plan.targetMainKeyword ||
      params.plan.keywords[0]
  );

  const subKeywords = uniq(
    (params.plan.keywordContract?.subKeywords ?? params.topic.subKeywords ?? params.plan.keywords.slice(1))
      .map((keyword) => normalize(keyword))
      .filter((keyword) => keyword && !isGenericKeyword(keyword) && keyword.toLowerCase() !== mainKeyword.toLowerCase())
  ).slice(0, 8);

  const requiredEntities = uniq([
    ...(params.plan.keywordContract?.productCandidates ?? []),
    ...(params.topicIntentResolution.productCandidates ?? []),
    ...(params.topic.subKeywords ?? []).filter(isEntityLike),
  ]).filter((value) => value.toLowerCase() !== mainKeyword.toLowerCase());

  const productListRequirements = requiredEntities.length > 0
    ? [
        `본문에 추천 대상 ${requiredEntities.length}개를 모두 포함한다.`,
        "각 대상을 H2 또는 H3 소제목으로 분리한다.",
        "각 대상마다 추천 이유를 작성한다.",
        "각 대상마다 추천 대상을 작성한다.",
        "기준 설명형 글로만 작성하지 않는다.",
        "대상명 없는 일반론 글로 작성하지 않는다.",
      ]
    : [];

  const requiredSections = requiredEntities.length > 0
    ? uniq([
        `${mainKeyword} 선택 기준`,
        ...buildProductSections(requiredEntities),
        "사용자 유형별 최종 선택 기준",
      ])
    : uniq((params.plan.articleContract?.mustResolve ?? []).slice(0, 6));

  return {
    title: normalize(params.plan.title || params.topic.title),
    mainKeyword,
    subKeywords,
    searchIntent: normalize(
      params.plan.keywordContract?.searchIntent ||
        params.topicIntentResolution.searchIntent ||
        params.plan.articleContract?.mainIntent ||
        params.topic.description
    ),
    requiredEntities,
    lockedRequirements: productListRequirements,
    requiredSections,
    duplicateMode: params.duplicateMode ?? "different_angle",
    planVersion: 1,
    updatedAt: new Date().toISOString(),
  };
}

function splitModificationLines(modifications: string): string[] {
  return modifications
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\-\*\d\.\)\s]+/, "").trim())
    .filter(Boolean);
}

function extractExplicitEntities(modifications: string, existingCandidates: string[]): string[] {
  const lines = splitModificationLines(modifications);
  const fromExisting = existingCandidates.filter((candidate) => normalize(modifications).includes(normalize(candidate)));
  const fromLines = lines.filter((line) => {
    const normalized = normalize(line);
    if (!normalized || normalized.length > 40) return false;
    if (/(포함|작성|추천|대상|이유|본문|소제목|섹션|제목|기준)/u.test(normalized)) return false;
    return isEntityLike(normalized);
  });
  return uniq([...fromExisting, ...fromLines]);
}

function appendLockedRequirements(
  existing: string[],
  modifications: string,
  requiredEntities: string[]
): string[] {
  const base = [...existing];
  const normalized = normalize(modifications);
  if (!normalized) return uniq(base);

  const appendIfMatched = (pattern: RegExp, requirement: string) => {
    if (pattern.test(normalized)) base.push(requirement);
  };

  appendIfMatched(/모두 포함|전부 포함|빠짐없이 포함/u, `본문에 추천 대상 ${requiredEntities.length || "필수"}개를 모두 포함한다.`);
  appendIfMatched(/소제목|h2|h3/ui, "각 대상을 H2 또는 H3 소제목으로 분리한다.");
  appendIfMatched(/추천 이유|왜 추천/u, "각 대상마다 추천 이유를 작성한다.");
  appendIfMatched(/추천 대상|누구에게 맞|어떤 분/u, "각 대상마다 추천 대상을 작성한다.");
  appendIfMatched(/기준 설명형 글로만 작성하지 않|일반론 글로 작성하지 않/u, "기준 설명형 글로만 작성하지 않는다.");
  appendIfMatched(/대상명 없는 일반론 글로 작성하지 않|제품명 없는 일반론 글로 작성하지 않/u, "대상명 없는 일반론 글로 작성하지 않는다.");

  if (normalized) {
    base.push(`사용자 수정사항 반영: ${normalized}`);
  }

  return uniq(base);
}

export function patchArticlePlan(plan: ArticlePlan | undefined, params: {
  modifications?: string;
  requestedTitle?: string | null;
  duplicateMode?: DuplicateMode;
  fallbackRequiredEntities?: string[];
}): ArticlePlan | undefined {
  if (!plan) return undefined;
  const modifications = normalize(params.modifications);
  if (!modifications && !params.requestedTitle && !params.duplicateMode) return plan;

  const existingCandidates = [...plan.requiredEntities, ...(params.fallbackRequiredEntities ?? [])];
  const explicitEntities = modifications ? extractExplicitEntities(modifications, existingCandidates) : [];
  const requiredEntities = uniq([
    ...explicitEntities,
    ...existingCandidates,
  ]);

  const requiredSections = requiredEntities.length > 0
    ? uniq([...plan.requiredSections.filter(Boolean), ...buildProductSections(requiredEntities)])
    : plan.requiredSections;

  return {
    ...plan,
    title: normalize(params.requestedTitle) || plan.title,
    requiredEntities,
    requiredSections,
    lockedRequirements: modifications
      ? appendLockedRequirements(plan.lockedRequirements, modifications, requiredEntities)
      : plan.lockedRequirements,
    duplicateMode: params.duplicateMode ?? plan.duplicateMode,
    planVersion: plan.planVersion + (modifications || params.requestedTitle || params.duplicateMode ? 1 : 0),
    updatedAt: new Date().toISOString(),
  };
}

export function formatArticlePlan(plan: ArticlePlan | undefined): string {
  if (!plan) return "Article plan is unavailable.";
  return [
    "[Article Plan]",
    `Title: ${plan.title}`,
    `Main keyword: ${plan.mainKeyword}`,
    `Sub keywords: ${plan.subKeywords.join(", ") || "none"}`,
    `Search intent: ${plan.searchIntent}`,
    `Required entities: ${plan.requiredEntities.join(", ") || "none"}`,
    `Locked requirements: ${plan.lockedRequirements.join(" / ") || "none"}`,
    `Required sections: ${plan.requiredSections.join(" / ") || "none"}`,
    `Duplicate mode: ${plan.duplicateMode ?? "different_angle"}`,
    `Plan version: ${plan.planVersion}`,
  ].join("\n");
}

export function buildDuplicateModeWriterGuidance(plan: ArticlePlan | undefined): string[] {
  if (!plan) return [];
  if (plan.duplicateMode === "force_duplicate") {
    return [
      "- Duplicate mode is 'force_duplicate'. Do not twist the article into a different angle just to avoid overlap warnings.",
      "- Keep the current title direction, search intent, and reader need intact even if similar posts exist.",
      "- You may vary the intro, conclusion, CTA, and examples, but do not dodge the requested topic itself.",
    ];
  }

  return [
    "- Duplicate mode is 'different_angle'. Keep the main topic, but differentiate the intro, body emphasis, and CTA from similar existing posts.",
  ];
}
