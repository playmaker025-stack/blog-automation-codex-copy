import type {
  KeywordContract,
  KeywordFocusMetric,
  KeywordUsageItem,
  KeywordUsageReport,
  SearchCombinationMetric,
  SearchCombinationTarget,
  SeoEvaluation,
} from "./types";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function uniqueKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || normalized.length < 2 || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

const GENERIC_KEYWORD_TOKENS = new Set([
  "보는",
  "많이",
  "고르기",
  "고르는",
  "선택",
  "선택기준",
  "추천",
  "찾는",
  "이유",
  "실제",
  "시작",
  "전에",
  "고르기전",
  "고르기전에",
  "많이보는",
  "정리",
  "가이드",
  "기준",
  "체크포인트",
  "체크",
  "포인트",
  "체크리스트",
  "방법",
  "설명",
  "소개",
  "팁",
  "선행포스팅",
  "메인포스팅",
  "키워드빌드업",
  "키워드시리즈",
  "빌드업",
  "선행",
  "포스팅",
  "초안",
  "보강",
  "자동",
  "입문",
  "초보",
  "초보자",
  "방향",
  "핵심",
  "주의",
  "사항",
]);

const META_KEYWORD_PATTERNS = [
  /키워드\s*빌드업/u,
  /선행\s*포스팅/u,
  /메인\s*포스팅/u,
  /자동\s*보강/u,
  /초안/u,
  /보강본/u,
  /시리즈/u,
];

const LOCALITY_TOKEN_PATTERN = /^[가-힣]{2,}(역|동|구|시|군|읍|면|리)$/u;

function isMeaningfulKeywordToken(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (normalized.length < 2) return false;
  if (GENERIC_KEYWORD_TOKENS.has(normalized)) return false;
  if (/^\d+$/u.test(normalized)) return false;
  return true;
}

function isMetaKeywordPhrase(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return true;
  if (GENERIC_KEYWORD_TOKENS.has(normalized)) return true;
  return META_KEYWORD_PATTERNS.some((pattern) => pattern.test(normalized));
}

const SEO_SENTENCE_ADVERBS = new Set(["자주", "항상", "정말", "너무", "매우", "꼭", "바로", "모두", "항시", "늘"]);

function isNaturalLanguageSentence(value: string): boolean {
  const tokens = value.trim().split(/\s+/);
  // 토큰 5개 이상이면 문장
  if (tokens.length >= 5) return true;
  // 조사로 끝나는 토큰 (예: "초보자가", "전에", "찾는데")
  if (tokens.some((t) => /[가이은는을를에서]$/.test(t))) return true;
  // 동사형 어미 (예: "놓치는", "알아야", "되는", "있는", "하면")
  if (tokens.some((t) => /(하는|있는|없는|되는|놓치는|알아야|해야|하면|찾는법|하는법)$/.test(t))) return true;
  // 독립 부사 토큰
  if (tokens.some((t) => SEO_SENTENCE_ADVERBS.has(t))) return true;
  return false;
}

function isKeywordPhraseUseful(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2) return false;
  if (isMetaKeywordPhrase(normalized)) return false;
  if (isNaturalLanguageSentence(normalized)) return false;
  const tokens = splitCombinationTokens(normalized).filter((token) => !GENERIC_KEYWORD_TOKENS.has(token.toLowerCase()));
  return tokens.length > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function extractFirstSentence(body: string): string {
  const firstParagraph = splitParagraphs(body)[0]?.replace(/\s*\n\s*/g, " ").trim() ?? "";
  if (!firstParagraph) return "";
  const sentenceMatch = firstParagraph.match(/^[\s\S]*?(?:[.!?]|$)/u);
  return sentenceMatch?.[0]?.trim() ?? firstParagraph;
}

function extractConclusionText(body: string): string {
  const paragraphs = splitParagraphs(body);
  return paragraphs.slice(-2).join("\n\n");
}

function _getKeywordTargets(
  _bodyLength: number,
  index: number,
  options?: {
    seriesRole?: "prelude" | "main";
    targetMainKeyword?: string;
    keyword?: string;
  }
): { targetMin: number; targetMax: number } {
  const normalizedTargetMainKeyword = options?.targetMainKeyword?.trim().toLowerCase();
  const normalizedKeyword = options?.keyword?.trim().toLowerCase();
  const isPreludeTarget =
    options?.seriesRole === "prelude" &&
    !!normalizedTargetMainKeyword &&
    !!normalizedKeyword &&
    normalizedTargetMainKeyword === normalizedKeyword;

  if (isPreludeTarget) return { targetMin: 1, targetMax: 3 };
  if (index === 0) return { targetMin: 4, targetMax: 7 };
  return { targetMin: 1, targetMax: 3 };
}

function splitCombinationTokens(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeBodyForKeywordCounting(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function buildFlexibleKeywordPattern(keyword: string): RegExp {
  const normalizedKeyword = keyword
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((token) => escapeRegExp(token))
    .join("\\s+");
  return new RegExp(normalizedKeyword, "giu");
}

function includesKeyword(text: string, keyword: string): boolean {
  return countKeywordOccurrences(text, keyword) > 0;
}

function includesAllTokens(text: string, phrase: string): boolean {
  const normalized = text.toLowerCase();
  const tokens = splitCombinationTokens(phrase);
  return tokens.length > 0 && tokens.every((token) => normalized.includes(token.toLowerCase()));
}

function findHeadingLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#") || /^\d+[.)]\s+/.test(line) || /^\*\*.+\*\*$/.test(line));
}

function selectMainKeyword(title: string, keywords: string[] = [], targetMainKeyword?: string): string {
  const explicitMainKeyword = targetMainKeyword?.trim();
  if (explicitMainKeyword) return explicitMainKeyword;

  const normalizedKeywords = uniqueKeywords(keywords).filter(isKeywordPhraseUseful);
  if (normalizedKeywords.length > 0) {
    return normalizedKeywords[0];
  }

  return selectFocusKeywords(title, keywords, 1)[0] ?? "";
}

function extractLocalityTokens(text: string): string[] {
  return uniqueKeywords(
    text
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => LOCALITY_TOKEN_PATTERN.test(token))
  );
}

function buildTrackedKeywords(params: {
  title: string;
  body: string;
  mainKeyword: string;
  keywords: string[];
}): string[] {
  const keywordPool = collectKeywordPool(params.title, [params.mainKeyword, ...params.keywords]);
  const localityTokens = extractLocalityTokens(`${params.title}\n${params.body}`);
  const componentUnits = buildMeaningfulKeywordUnits(keywordPool)
    .filter((unit) => unit !== params.mainKeyword)
    .filter((unit) => countKeywordOccurrences(params.body, unit) > 0);

  return uniqueKeywords([
    params.mainKeyword,
    ...localityTokens,
    ...keywordPool.filter((keyword) => keyword !== params.mainKeyword),
    ...componentUnits,
  ])
    .filter(isKeywordPhraseUseful)
    .slice(0, 8);
}

function getMainKeywordStatus(count: number, isPreludeMainKeyword: boolean): KeywordUsageItem["status"] {
  if (isPreludeMainKeyword) {
    if (count <= 0) return "under";
    if (count <= 3) return "ok";
    if (count <= 5) return "caution";
    return "danger";
  }

  if (count <= 3) return "under";
  if (count <= 7) return "ok";
  if (count <= 10) return "caution";
  return "danger";
}

function getSubKeywordStatus(count: number): KeywordUsageItem["status"] {
  if (count <= 0) return "under";
  if (count <= 3) return "ok";
  if (count === 4) return "caution";
  return "danger";
}

function getLimitedKeywordStatus(count: number, min: number, max: number): KeywordUsageItem["status"] {
  if (count < min) return "under";
  if (count <= max) return "ok";
  if (count <= max + 3) return "caution";
  return "danger";
}

function buildContractKeywordRecommendation(
  keyword: string,
  role: KeywordUsageItem["role"],
  status: KeywordUsageItem["status"],
  min: number,
  max: number
): string {
  if (role === "forbidden") {
    return status === "ok"
      ? `'${keyword}'는 본문에 노출되지 않았습니다.`
      : `'${keyword}'는 작업용 표현이라 발행 본문에서 반드시 삭제해야 합니다.`;
  }
  const label = role === "main" ? "메인 키워드" : role === "bridge" ? "브릿지 키워드" : role === "anchor" ? "내부링크 앵커" : "서브 키워드";
  if (status === "under") return `${label} '${keyword}'는 본문 기준 ${min}~${max}회가 목표입니다. 필요한 문단에만 자연스럽게 보강해 주세요.`;
  if (status === "caution") return `${label} '${keyword}'가 주의 구간입니다. 반복 문장을 줄이고 같은 의미는 설명형 문장으로 바꿔 주세요.`;
  if (status === "danger") return `${label} '${keyword}'가 과도하게 반복됩니다. 직접 반복을 줄이고 이 글에서 다루지 않을 내용은 다음 글로 넘겨 주세요.`;
  return `${label} '${keyword}' 반복은 현재 적정합니다.`;
}

function buildKeywordRecommendation(
  keyword: string,
  role: "main" | "sub",
  status: KeywordUsageItem["status"],
  isPreludeMainKeyword: boolean
): string {
  if (role === "main") {
    if (status === "under") {
      return isPreludeMainKeyword
        ? `선행 글 본문에 '${keyword}'를 1~3회 자연스럽게 넣어 주세요.`
        : `메인 키워드 '${keyword}'는 본문 기준 4~7회가 적정입니다. 핵심 문단에 자연스럽게 보강해 주세요.`;
    }
    if (status === "caution") {
      return isPreludeMainKeyword
        ? `선행 글에서 '${keyword}' 반복이 조금 많습니다. 일부는 하위 의도 표현으로 풀어 주세요.`
        : `메인 키워드 '${keyword}' 반복이 주의 구간입니다. 같은 표현 일부를 구체 기준이나 사례 문장으로 바꿔 주세요.`;
    }
    if (status === "danger") {
      return `'${keyword}'가 과도하게 반복됩니다. 일부 문장은 동의어, 선택 기준, 실제 예시로 바꿔 주세요.`;
    }
    return `메인 키워드 '${keyword}' 반복은 현재 적정합니다.`;
  }

  if (status === "under") {
    return `서브 키워드 '${keyword}'는 본문 1~3회가 적정입니다. 관련 문단에 자연스럽게 보강해 주세요.`;
  }
  if (status === "caution") {
    return `서브 키워드 '${keyword}' 반복이 약간 많습니다. 일부는 설명형 문장으로 풀어 주세요.`;
  }
  if (status === "danger") {
    return `서브 키워드 '${keyword}'가 과도하게 반복됩니다. 직접 반복을 줄이고 의미만 남겨 주세요.`;
  }
  return `서브 키워드 '${keyword}' 반복은 현재 적정합니다.`;
}

function buildParagraphWarnings(paragraphs: string[], items: KeywordUsageItem[]): KeywordUsageReport["paragraphWarnings"] {
  const warnings: KeywordUsageReport["paragraphWarnings"] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    for (const item of items) {
      const count = countKeywordOccurrences(paragraph, item.keyword);
      if (count < 2) continue;
      warnings.push({
        keyword: item.keyword,
        paragraphIndex,
        count,
        message: `${paragraphIndex + 1}번 문단에서 '${item.keyword}'가 ${count}회 반복됩니다. 같은 문단 안 반복을 줄여 주세요.`,
      });
    }
  });

  return warnings;
}

function evaluateOverallRisk(
  mainKeyword: KeywordUsageItem | null,
  subKeywords: KeywordUsageItem[],
  paragraphWarnings: KeywordUsageReport["paragraphWarnings"]
): Pick<KeywordUsageReport, "overallRisk" | "overallRiskSummary"> {
  const items = [...(mainKeyword ? [mainKeyword] : []), ...subKeywords];
  const dangerCount = items.filter((item) => item.status === "danger").length;
  const cautionCount = items.filter((item) => item.status === "caution").length;
  const underCount = items.filter((item) => item.status === "under").length;

  if (dangerCount > 0 || paragraphWarnings.length >= 2) {
    return {
      overallRisk: "high",
      overallRiskSummary: "과반복 위험이 높습니다. 반복 경고가 있는 키워드를 먼저 줄여 주세요.",
    };
  }

  if (cautionCount > 0 || underCount > 0 || paragraphWarnings.length > 0) {
    return {
      overallRisk: "medium",
      overallRiskSummary: "일부 키워드 조정이 필요하지만, 문맥을 유지하며 보정할 수 있습니다.",
    };
  }

  return {
    overallRisk: "low",
    overallRiskSummary: "키워드 반복 위험도는 낮은 편입니다.",
  };
}

function buildKeywordFocusMetrics(params: {
  title: string;
  body: string;
  keywordReport: KeywordUsageReport;
  seriesRole?: "prelude" | "main";
  targetMainKeyword?: string;
}): KeywordFocusMetric[] {
  const paragraphs = splitParagraphs(params.body);
  const introText = paragraphs.slice(0, 2).join("\n\n");
  const earlyText = paragraphs.slice(0, 4).join("\n\n");
  const compactTitle = params.title.toLowerCase();
  const bodyLength = params.keywordReport.bodyLength;

  return params.keywordReport.items.filter((item) => item.role !== "forbidden" && item.role !== "anchor").map((item, index) => {
    const role: KeywordFocusMetric["role"] = item.role === "main" || index === 0 ? "main" : "sub";
    const isPreludeTarget =
      params.seriesRole === "prelude" &&
      item.keyword.trim().toLowerCase() === (params.targetMainKeyword?.trim().toLowerCase() ?? "");
    const titleIncluded = compactTitle.includes(item.keyword.toLowerCase());
    const titleFrontLoaded =
      titleIncluded && params.title.indexOf(item.keyword) >= 0 && params.title.indexOf(item.keyword) <= 12;
    const introIncluded = includesKeyword(introText, item.keyword);
    const earlyCoverage = includesKeyword(earlyText, item.keyword);
    const firstSentenceIncluded = includesKeyword(extractFirstSentence(params.body), item.keyword);
    const headingIncluded = includesKeyword(findHeadingLines(params.body).join("\n"), item.keyword);
    const conclusionIncluded = includesKeyword(extractConclusionText(params.body), item.keyword);

    let completenessScore = role === "main" ? 76 : 72;
    let exposurePotentialScore = role === "main" ? 74 : 70;

    if (!titleIncluded && !isPreludeTarget) {
      completenessScore -= 10;
      exposurePotentialScore -= 10;
    } else if (role === "main" && titleFrontLoaded) {
      completenessScore += 6;
      exposurePotentialScore += 7;
    } else if (titleIncluded) {
      completenessScore += 4;
      exposurePotentialScore += 4;
    }

    if (introIncluded) {
      completenessScore += 5;
      exposurePotentialScore += 5;
    } else {
      completenessScore -= isPreludeTarget ? 3 : 10;
      exposurePotentialScore -= isPreludeTarget ? 3 : 10;
    }

    if (!isPreludeTarget && firstSentenceIncluded) {
      completenessScore += 3;
    } else if (!isPreludeTarget) {
      completenessScore -= 7;
    }

    if (!isPreludeTarget && headingIncluded) {
      completenessScore += 3;
      exposurePotentialScore += 3;
    } else if (!isPreludeTarget) {
      completenessScore -= 6;
    }

    if (!isPreludeTarget && conclusionIncluded) {
      completenessScore += 2;
    } else if (!isPreludeTarget) {
      completenessScore -= 4;
    }

    if (item.status === "ok") {
      completenessScore += 10;
      exposurePotentialScore += 10;
    } else if (item.status === "under") {
      completenessScore -= role === "main" ? 10 : 7;
      exposurePotentialScore -= role === "main" ? 12 : 8;
    } else if (item.status === "caution") {
      completenessScore -= role === "main" ? 8 : 6;
      exposurePotentialScore -= role === "main" ? 10 : 7;
    } else {
      completenessScore -= role === "main" ? 10 : 7;
      exposurePotentialScore -= role === "main" ? 12 : 9;
    }

    if (bodyLength >= 1200) {
      completenessScore += 4;
      exposurePotentialScore += 5;
    } else {
      completenessScore -= 4;
      exposurePotentialScore -= 5;
    }

    const summaryParts: string[] = [];
    if (titleIncluded) {
      summaryParts.push(role === "main" && titleFrontLoaded ? "\uC81C\uBAA9 \uC55E\uBC30\uCE58" : "\uC81C\uBAA9 \uD3EC\uD568");
    } else {
      summaryParts.push("\uC81C\uBAA9 \uBBF8\uD3EC\uD568");
    }
    summaryParts.push(introIncluded ? "\uB3C4\uC785\uBD80 \uD3EC\uD568" : "\uB3C4\uC785\uBD80 \uBD80\uC871");
    summaryParts.push(`\uBCF8\uBB38 ${item.count}\uD68C`);

    let action = `\uB3C4\uC785\uBD80\uC5D0\uC11C \'${item.keyword}\' \uAC80\uC0C9 \uC758\uB3C4\uB97C \uB354 \uC9C1\uC811\uC801\uC73C\uB85C \uBC1B\uC544 \uC8FC\uC138\uC694.`;
    if (!titleIncluded && !isPreludeTarget) {
      action = `\'${item.keyword}\'\uB97C \uC81C\uBAA9\uC774\uB098 \uD575\uC2EC \uC18C\uC81C\uBAA9\uC5D0 \uB354 \uBD84\uBA85\uD558\uAC8C \uBC30\uCE58\uD574 \uC8FC\uC138\uC694.`;
    } else if (!introIncluded) {
      action = `\uB3C4\uC785\uBD80\uC5D0\uC11C \'${item.keyword}\' \uAC80\uC0C9 \uC758\uB3C4\uB97C \uB354 \uC9C1\uC811\uC801\uC73C\uB85C \uBC1B\uC544 \uC8FC\uC138\uC694.`;
    } else if (item.status !== "ok") {
      action = item.recommendation;
    } else if (bodyLength < 1200) {
      action = "\uBCF8\uBB38 \uBD84\uB7C9\uC744 \uC870\uAE08 \uB298\uB9AC\uACE0, \uC2E4\uC81C \uC120\uD0DD \uAE30\uC900\uC774\uB098 \uC0AC\uB840 \uBB38\uB2E8\uC744 \uBCF4\uAC15\uD574 \uC8FC\uC138\uC694.";
    }

    return {
      keyword: item.keyword,
      role,
      label: role === "main" ? "\uBA54\uC778 \uD0A4\uC6CC\uB4DC" : item.role === "bridge" ? "브릿지 키워드" : `\uC11C\uBE0C \uD0A4\uC6CC\uB4DC ${index}`,
      completenessScore: clampScore(completenessScore),
      exposurePotentialScore: clampScore(exposurePotentialScore),
      count: item.count,
      targetMin: item.targetMin,
      targetMax: item.targetMax,
      titleIncluded,
      titleFrontLoaded,
      introIncluded,
      earlyCoverage,
      summary: summaryParts.join(" / "),
      action,
    };
  });
}

function buildFallbackSearchCombinations(keywords: string[]): SearchCombinationTarget[] {
  const mainKeyword = keywords[0]?.trim();
  if (!mainKeyword) return [];

  const combinations: SearchCombinationTarget[] = [
    {
      phrase: mainKeyword,
      role: "main",
      priority: "core",
      rationale: "메인 키워드 자체의 검색 의도입니다.",
      suggestedPlacement: "제목, 도입부, 결론",
    },
  ];

  for (const keyword of keywords.slice(1, 4)) {
    const phrase = uniqueKeywords([`${keyword} ${mainKeyword}`])[0];
    if (!phrase) continue;
    combinations.push({
      phrase,
      role: "support",
      priority: "support",
      rationale: "서브 키워드를 메인 키워드와 연결한 기본 조합입니다.",
      suggestedPlacement: "중간 문단",
    });
  }

  return combinations;
}

function buildSearchCombinationMetrics(params: {
  title: string;
  body: string;
  combinations: SearchCombinationTarget[];
}): SearchCombinationMetric[] {
  const paragraphs = splitParagraphs(params.body);
  const introText = paragraphs.slice(0, 2).join("\n\n");
  const earlyText = paragraphs.slice(0, 4).join("\n\n");
  const headingText = findHeadingLines(params.body).join("\n");

  return params.combinations.map((combination) => {
    const tokens = splitCombinationTokens(combination.phrase);
    const exactMatches = countKeywordOccurrences(params.body, combination.phrase);
    const titleIncluded = includesAllTokens(params.title, combination.phrase);
    const headingIncluded = includesAllTokens(headingText, combination.phrase);
    const introIncluded = includesAllTokens(introText, combination.phrase);
    const earlyCoverage = includesAllTokens(earlyText, combination.phrase);
    const coveredTokens = tokens.filter((token) => includesKeyword(params.body, token)).length;
    const tokenCoverage = tokens.length > 0 ? coveredTokens / tokens.length : 0;

    let coverageScore = combination.priority === "core" ? 72 : 66;
    let exposurePotentialScore = combination.priority === "core" ? 70 : 64;

    if (titleIncluded) {
      coverageScore += 10;
      exposurePotentialScore += 12;
    } else {
      coverageScore -= combination.priority === "core" ? 10 : 6;
      exposurePotentialScore -= combination.priority === "core" ? 12 : 7;
    }

    if (introIncluded) {
      coverageScore += 10;
      exposurePotentialScore += 10;
    } else {
      coverageScore -= combination.priority === "core" ? 8 : 5;
      exposurePotentialScore -= combination.priority === "core" ? 10 : 6;
    }

    if (headingIncluded) {
      coverageScore += 8;
      exposurePotentialScore += 8;
    }

    if (earlyCoverage) {
      coverageScore += 6;
      exposurePotentialScore += 6;
    } else {
      coverageScore -= 4;
      exposurePotentialScore -= 5;
    }

    if (exactMatches > 0) {
      coverageScore += combination.priority === "core" ? 10 : 7;
      exposurePotentialScore += combination.priority === "core" ? 9 : 6;
    } else if (tokenCoverage >= 1) {
      coverageScore += 4;
      exposurePotentialScore += 2;
    } else if (tokenCoverage < 0.6) {
      coverageScore -= combination.priority === "core" ? 12 : 8;
      exposurePotentialScore -= combination.priority === "core" ? 12 : 8;
    }

    if (exactMatches >= 4) {
      coverageScore -= 6;
      exposurePotentialScore -= 8;
    }

    const summaryParts = [
      titleIncluded ? "제목 연결" : "제목 약함",
      introIncluded ? "도입부 연결" : "도입부 약함",
      headingIncluded ? "소제목 연결" : "소제목 보강 가능",
      `${exactMatches}회 직접 표현`,
    ];

    let action = "현재 조합 흐름을 유지해도 괜찮습니다.";
    if (!titleIncluded && combination.priority === "core") {
      action = `'${combination.phrase}' 조합을 제목이나 제목 가까운 소제목에 더 직접적으로 드러내는 편이 좋습니다.`;
    } else if (!introIncluded) {
      action = `첫 두 문단 안에서 '${combination.phrase}' 검색 의도를 더 직접적으로 받아 주세요.`;
    } else if (exactMatches === 0 && tokenCoverage >= 1) {
      action = `토큰은 모두 들어가 있으니 '${combination.phrase}' 조합을 한 문장 안에서 한 번 더 자연스럽게 묶어 주세요.`;
    } else if (tokenCoverage < 0.6) {
      action = `이 글에서 '${combination.phrase}' 조합을 실제로 다루는 문단이 부족합니다. ${combination.suggestedPlacement} 쪽을 보강해 주세요.`;
    } else if (exactMatches >= 4) {
      action = `'${combination.phrase}' 직접 반복이 많아 보여 일부는 동의어/설명형 문장으로 풀어 주는 편이 좋습니다.`;
    }

    return {
      phrase: combination.phrase,
      role: combination.role,
      priority: combination.priority,
      exactMatches,
      tokenCoverage: Number(tokenCoverage.toFixed(2)),
      titleIncluded,
      headingIncluded,
      introIncluded,
      earlyCoverage,
      coverageScore: clampScore(coverageScore),
      exposurePotentialScore: clampScore(exposurePotentialScore),
      summary: summaryParts.join(" · "),
      action,
    };
  });
}

function computeCombinationCoverageScore(metrics: SearchCombinationMetric[]): number {
  if (metrics.length === 0) return 0;
  const weightedTotal = metrics.reduce((sum, metric) => {
    const weight = metric.priority === "core" ? 1.4 : 1;
    return sum + metric.coverageScore * weight;
  }, 0);
  const totalWeight = metrics.reduce((sum, metric) => sum + (metric.priority === "core" ? 1.4 : 1), 0);
  return clampScore(weightedTotal / totalWeight);
}

export function selectFocusKeywords(title: string, keywords: string[] = [], limit = 5): string[] {
  const titleTokens = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => isMeaningfulKeywordToken(token));

  return uniqueKeywords([...keywords, ...titleTokens]).filter(isKeywordPhraseUseful).slice(0, limit);
}

function collectKeywordPool(title: string, keywords: string[] = []): string[] {
  const explicitKeywords = uniqueKeywords(keywords).filter(isKeywordPhraseUseful);
  if (explicitKeywords.length > 0) return explicitKeywords;

  const fallbackTitlePhrases = selectFocusKeywords(title, [], 5).filter(isKeywordPhraseUseful);
  return uniqueKeywords(fallbackTitlePhrases);
}

function buildMeaningfulKeywordUnits(keywordPool: string[]): string[] {
  const units: string[] = [];

  for (const phrase of keywordPool) {
    units.push(phrase);
    const tokens = splitCombinationTokens(phrase).filter((token) => isMeaningfulKeywordToken(token));
    for (const token of tokens) {
      units.push(token);
    }
    for (let index = 0; index < tokens.length - 1; index += 1) {
      units.push(`${tokens[index]} ${tokens[index + 1]}`);
    }
  }

  return uniqueKeywords(units);
}

function buildKeywordTokenItems(keywordPool: string[], body: string): Array<{
  token: string;
  count: number;
  sourceKeywords: string[];
  note: string;
}> {
  const tokenSources = new Map<string, Set<string>>();

  for (const unit of buildMeaningfulKeywordUnits(keywordPool)) {
    const tokens = splitCombinationTokens(unit).filter((token) => isMeaningfulKeywordToken(token));
    if (tokens.length === 0) continue;
    const phrases = keywordPool.filter((phrase) => {
      const phraseTokens = splitCombinationTokens(phrase);
      return tokens.every((token) => phraseTokens.includes(token));
    });
    const bucket = tokenSources.get(unit) ?? new Set<string>();
    for (const phrase of phrases) {
      bucket.add(phrase);
    }
    tokenSources.set(unit, bucket);
  }

  return [...tokenSources.entries()]
    .map(([token, sourceSet]) => {
      const count = countKeywordOccurrences(body, token);
      let note = "실제 본문에서 확인된 키워드 축입니다.";
      if (count >= 20) {
        note = "반복이 매우 많은 편입니다. 일부는 다른 표현이나 구체 기준으로 치환하는 편이 안전합니다.";
      } else if (count >= 10) {
        note = "반복이 많은 편입니다. 이 단어가 메인 축이라도 문단마다 되풀이되면 과밀로 보일 수 있습니다.";
      } else if (count >= 4) {
        note = "적당히 보이는 편입니다. 다른 핵심 단어와의 균형을 같이 보는 것이 좋습니다.";
      }

      return {
        token,
        count,
        sourceKeywords: [...sourceSet].slice(0, 4),
        note,
      };
    })
    .filter((item) => item.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.token.length !== left.token.length) return right.token.length - left.token.length;
      return left.token.localeCompare(right.token, "ko");
    });
}

export function countKeywordOccurrences(body: string, keyword: string): number {
  const trimmed = keyword.trim();
  if (!trimmed) return 0;
  const normalizedBody = normalizeBodyForKeywordCounting(body);
  const matches = normalizedBody.match(buildFlexibleKeywordPattern(trimmed));
  return matches?.length ?? 0;
}

function buildContractKeywordItems(contract: KeywordContract, body: string): KeywordUsageItem[] {
  const limitsByKey = new Map(
    contract.limitedKeywords.map((limit) => [limit.keyword.trim().toLowerCase(), limit])
  );
  const ordered = uniqueKeywords([
    contract.mainKeyword,
    ...contract.subKeywords,
    ...contract.bridgeKeywords,
    ...contract.internalLinkAnchors,
  ]).filter((keyword) => limitsByKey.has(keyword.trim().toLowerCase()) || isKeywordPhraseUseful(keyword));

  const keywordItems = ordered.map((keyword) => {
    const limit = limitsByKey.get(keyword.trim().toLowerCase());
    const role = limit?.role ?? (keyword === contract.mainKeyword ? "main" : "sub");
    const min = limit?.min ?? (role === "main" ? 4 : 1);
    const max = limit?.max ?? (role === "main" ? 7 : 3);
    const count = countKeywordOccurrences(body, keyword);
    const status = getLimitedKeywordStatus(count, min, max);
    return {
      keyword,
      count,
      status,
      targetMin: min,
      targetMax: max,
      role,
      recommendation: buildContractKeywordRecommendation(keyword, role, status, min, max),
    } satisfies KeywordUsageItem;
  });

  const forbiddenItems = uniqueKeywords(contract.forbiddenTerms).map((keyword) => {
    const count = countKeywordOccurrences(body, keyword);
    const status: KeywordUsageItem["status"] = count > 0 ? "danger" : "ok";
    return {
      keyword,
      count,
      status,
      targetMin: 0,
      targetMax: 0,
      role: "forbidden" as const,
      recommendation: buildContractKeywordRecommendation(keyword, "forbidden", status, 0, 0),
    };
  });

  return [...keywordItems, ...forbiddenItems];
}

export function analyzeKeywordUsage(params: {
  title: string;
  body: string;
  keywords?: string[];
  seriesRole?: "prelude" | "main";
  targetMainKeyword?: string;
  keywordContract?: KeywordContract;
}): KeywordUsageReport {
  const paragraphs = splitParagraphs(params.body);
  const introText = paragraphs.slice(0, 2).join("\n\n");
  const bodyLength = params.body.replace(/\s+/g, "").length;
  const contract = params.keywordContract;
  const mainKeyword = contract?.mainKeyword ?? selectMainKeyword(params.title, params.keywords ?? [], params.targetMainKeyword);
  const orderedKeywords = contract
    ? []
    : buildTrackedKeywords({
        title: params.title,
        body: params.body,
        mainKeyword,
        keywords: params.keywords ?? [],
      }).filter(Boolean);
  const keywordPool = contract
    ? [contract.mainKeyword, ...contract.subKeywords, ...contract.bridgeKeywords, ...contract.internalLinkAnchors]
    : collectKeywordPool(params.title, orderedKeywords);
  // contract 사용 여부와 관계없이 실제 본문에서 자주 쓰인 단어도 tokenItems에 포함
  const tokenPool = contract
    ? uniqueKeywords([
        ...keywordPool,
        ...buildTrackedKeywords({
          title: params.title,
          body: params.body,
          mainKeyword,
          keywords: keywordPool,
        }),
      ])
    : keywordPool;
  const normalizedTargetMainKeyword = params.targetMainKeyword?.trim().toLowerCase() ?? "";

  const items: KeywordUsageItem[] = contract ? buildContractKeywordItems(contract, params.body) : orderedKeywords.map((keyword, index) => {
    const count = countKeywordOccurrences(params.body, keyword);
    const isPreludeMainKeyword =
      params.seriesRole === "prelude" &&
      index === 0 &&
      !!normalizedTargetMainKeyword &&
      keyword.trim().toLowerCase() === normalizedTargetMainKeyword;

    const targetMin = index === 0 ? (isPreludeMainKeyword ? 1 : 4) : 1;
    const targetMax = index === 0 ? (isPreludeMainKeyword ? 3 : 7) : 3;
    const status =
      index === 0
        ? getMainKeywordStatus(count, isPreludeMainKeyword)
        : getSubKeywordStatus(count);
    const recommendation = buildKeywordRecommendation(
      keyword,
      index === 0 ? "main" : "sub",
      status,
      isPreludeMainKeyword
    );

    return {
      keyword,
      count,
      status,
      targetMin,
      targetMax,
      recommendation,
    };
  });

  const mainKeywordItem = items.find((item) => item.role === "main") ?? items[0] ?? null;
  const subKeywordItems = contract
    ? items.filter((item) => item.role === "sub")
    : items.slice(1, 8);
  const bridgeKeywordItems = items.filter((item) => item.role === "bridge");
  const internalLinkAnchorItems = items.filter((item) => item.role === "anchor");
  const forbiddenItems = items.filter((item) => item.role === "forbidden");
  const introCoverage = mainKeyword ? countKeywordOccurrences(introText, mainKeyword) > 0 : true;
  const titleFrontLoaded =
    mainKeyword ? params.title.indexOf(mainKeyword) >= 0 && params.title.indexOf(mainKeyword) <= 12 : true;
  const totalMentions = items.reduce((sum, item) => sum + item.count, 0);
  const paragraphWarnings = buildParagraphWarnings(paragraphs, [
    ...(mainKeywordItem ? [mainKeywordItem] : []),
    ...subKeywordItems,
    ...bridgeKeywordItems,
  ]);
  const { overallRisk, overallRiskSummary } = evaluateOverallRisk(
    mainKeywordItem,
    [...subKeywordItems, ...bridgeKeywordItems, ...internalLinkAnchorItems, ...forbiddenItems],
    paragraphWarnings
  );

  const summary: string[] = [];
  if (mainKeywordItem) {
    summary.push(`메인 키워드 '${mainKeywordItem.keyword}' 본문 ${mainKeywordItem.count}회`);
  }
  if (!introCoverage && mainKeywordItem) {
    summary.push("제목 앞부분의 메인 키워드 배치가 약합니다.");
  }
  if (!titleFrontLoaded && mainKeywordItem && params.seriesRole !== "prelude") {
    summary.push("\uC81C\uBAA9 \uC55E\uBD80\uBD84\uC758 \uBA54\uC778 \uD0A4\uC6CC\uB4DC \uBC30\uCE58\uAC00 \uC57D\uD569\uB2C8\uB2E4.");
  }
  summary.push(`전체 반복 위험도 ${overallRisk}`);

  const recommendations = [
    ...items.filter((item) => item.status !== "ok").map((item) => item.recommendation),
    ...paragraphWarnings.map((warning) => warning.message),
  ];

  return {
    items,
    mainKeyword: mainKeywordItem,
    subKeywords: subKeywordItems,
    bridgeKeywords: bridgeKeywordItems,
    internalLinkAnchors: internalLinkAnchorItems,
    forbiddenItems,
    contractApplied: Boolean(contract),
    overallRisk,
    overallRiskSummary,
    paragraphWarnings,
    tokenItems: buildKeywordTokenItems(tokenPool, params.body),
    totalMentions,
    introCoverage,
    titleFrontLoaded,
    bodyLength,
    summary,
    recommendations: uniqueKeywords(recommendations).slice(0, 10),
  };
}

export function evaluateSeoCompleteness(params: {
  title: string;
  body: string;
  keywords?: string[];
  targetSearchCombinations?: SearchCombinationTarget[];
  seriesRole?: "prelude" | "main";
  targetMainKeyword?: string;
  keywordContract?: KeywordContract;
}): SeoEvaluation {
  const keywordReport = analyzeKeywordUsage(params);
  const keywordMetrics = buildKeywordFocusMetrics({
    title: params.title,
    body: params.body,
    keywordReport,
    seriesRole: params.seriesRole,
    targetMainKeyword: params.targetMainKeyword,
  });
  const contractCombinations = params.keywordContract
    ? params.keywordContract.limitedKeywords
        .filter((item) => item.role !== "anchor")
        .map((item): SearchCombinationTarget => ({
          phrase: item.keyword,
          role: item.role === "main" ? "main" : "support",
          priority: item.role === "main" ? "core" : "support",
          rationale: "키워드 계약서에 확정된 검사 대상입니다.",
          suggestedPlacement: item.role === "bridge" ? "본문 후반 연결 문단" : "본문 핵심 문단",
        }))
    : [];
  const combinations =
    contractCombinations.length > 0
      ? contractCombinations
      : (params.targetSearchCombinations ?? []).length > 0
      ? params.targetSearchCombinations ?? []
      : buildFallbackSearchCombinations(params.keywords ?? keywordReport.items.map((item) => item.keyword));
  const combinationMetrics = buildSearchCombinationMetrics({
    title: params.title,
    body: params.body,
    combinations,
  });
  const combinationCoverageScore = computeCombinationCoverageScore(combinationMetrics);
  const firstSentence = extractFirstSentence(params.body);
  const headingText = findHeadingLines(params.body).join("\n");
  const conclusionText = extractConclusionText(params.body);
  const mainKeyword = keywordReport.items[0]?.keyword ?? "";
  const mainInFirstSentence = mainKeyword ? includesKeyword(firstSentence, mainKeyword) : true;
  const mainInHeading = mainKeyword ? includesKeyword(headingText, mainKeyword) : true;
  const mainInConclusion = mainKeyword ? includesKeyword(conclusionText, mainKeyword) : true;
  const isPreludeMainKeyword =
    params.seriesRole === "prelude" &&
    !!mainKeyword &&
    mainKeyword.trim().toLowerCase() === (params.targetMainKeyword?.trim().toLowerCase() ?? "");

  let score = 88;
  const evidence: string[] = [];
  const improvements: string[] = [];

  if (params.title.length >= 28 && params.title.length <= 45) {
    score += 4;
    evidence.push("제목 길이가 모바일 검색 노출 구간에 비교적 안정적입니다.");
  } else {
    score -= 8;
    improvements.push("제목 길이를 28~45자 안쪽으로 맞추는 편이 좋습니다.");
  }

  if (isPreludeMainKeyword) {
    evidence.push("선행 포스팅은 메인 키워드를 제목 정면에 반복하지 않는 규칙을 따릅니다.");
  } else if (keywordReport.titleFrontLoaded) {
    score += 4;
    evidence.push("메인 키워드가 제목 앞부분에 배치되어 있습니다.");
  } else if (keywordReport.items[0]) {
    score -= 8;
    improvements.push(`제목 앞부분에 '${keywordReport.items[0].keyword}'를 더 빠르게 노출하면 검색 의도가 선명해집니다.`);
  }

  if (keywordReport.introCoverage) {
    score += 4;
    evidence.push("도입부에 메인 키워드가 보여 검색 의도 연결이 자연스럽습니다.");
  } else if (keywordReport.items[0]) {
    score -= isPreludeMainKeyword ? 3 : 10;
    improvements.push(
      isPreludeMainKeyword
        ? `선행 글 본문에 '${keywordReport.items[0].keyword}'를 최소 한 번 자연스럽게 등장시켜 주세요.`
        : `첫 두 문단 안에 '${keywordReport.items[0].keyword}'를 자연스럽게 넣는 편이 좋습니다.`
    );
  }

  if (isPreludeMainKeyword) {
    evidence.push("선행 포스팅은 메인 키워드를 본문 맥락에서 자연스럽게 노출하는 모드로 평가합니다.");
  } else if (mainInFirstSentence) {
    score += 3;
    evidence.push("첫 문장에 메인 키워드가 보여 검색 의도를 바로 연결합니다.");
  } else if (mainKeyword) {
    score -= 7;
    improvements.push(`첫 문장에 '${mainKeyword}'를 한 번 직접 배치해 검색 의도를 더 또렷하게 보여주세요.`);
  }

  if (!isPreludeMainKeyword && mainInHeading) {
    score += 3;
    evidence.push("소제목에도 메인 키워드가 반영되어 문서 구조와 주제가 잘 맞물립니다.");
  } else if (!isPreludeMainKeyword && mainKeyword) {
    score -= 6;
    improvements.push(`핵심 소제목 1개 이상에 '${mainKeyword}'를 포함해 주제 축을 더 선명하게 잡아주세요.`);
  }

  if (!isPreludeMainKeyword && mainInConclusion) {
    score += 2;
    evidence.push("결론부에도 메인 키워드가 다시 등장해 문서 마무리가 일관됩니다.");
  } else if (!isPreludeMainKeyword && mainKeyword) {
    score -= 4;
    improvements.push(`마무리 문단에서 '${mainKeyword}'를 한 번 더 정리해 글의 중심 키워드를 닫아주세요.`);
  }

  for (const item of keywordReport.items) {
    if (item.role === "forbidden") {
      if (item.status === "danger") {
        score -= 18;
        improvements.push(item.recommendation);
      }
      continue;
    }
    if (item.status === "ok") {
      evidence.push(`\'${item.keyword}\' \uBCF8\uBB38 ${item.count}\uD68C\uB294 \uD604\uC7AC \uAD8C\uC7A5 \uBC94\uC704\uC785\uB2C8\uB2E4.`);
      continue;
    }
    if (item.status === "under") {
      score -= item.keyword === keywordReport.items[0]?.keyword ? 10 : 5;
      improvements.push(item.recommendation);
      continue;
    }
    if (item.status === "caution") {
      score -= item.keyword === keywordReport.items[0]?.keyword ? 8 : 4;
      improvements.push(item.recommendation);
      continue;
    }
    score -= item.keyword === keywordReport.items[0]?.keyword ? 10 : 6;
    improvements.push(item.recommendation);
  }

  const mainKeywordTokens = splitCombinationTokens(mainKeyword).filter((token) => isMeaningfulKeywordToken(token));
  if (!isPreludeMainKeyword && mainKeywordTokens.length > 0) {
    const componentTokenLimit = keywordReport.bodyLength >= 2200 ? 14 : keywordReport.bodyLength >= 1400 ? 10 : 8;
    const overusedComponentTokens = keywordReport.tokenItems.filter(
      (item) =>
        splitCombinationTokens(item.token).length === 1 &&
        mainKeywordTokens.includes(item.token) &&
        item.count > componentTokenLimit
    );

    for (const item of overusedComponentTokens) {
      score -= 4;
      improvements.push(
        `'${item.token}' 반복이 ${item.count}회로 많습니다. 같은 명사를 연달아 반복하지 말고 기준, 상황, 비교 포인트, 기기/액상 예시로 일부 치환해 주세요.`
      );
    }

    if (overusedComponentTokens.length === 0) {
      evidence.push("메인 키워드의 핵심 축 단어 반복이 과도하게 치우치지 않았습니다.");
    }
  }

  if (keywordReport.bodyLength >= 1200) {
    evidence.push("본문 분량이 SEO용 설명 글로는 최소 기준을 넘깁니다.");
  } else {
    score -= 8;
    improvements.push("본문 분량이 짧아서 검색 체류 신호가 약할 수 있습니다.");
  }

  if (combinationMetrics.length > 0) {
    if (combinationCoverageScore >= 78) {
      score += 4;
      evidence.push(`목표 검색 조합 커버력이 ${combinationCoverageScore}점으로 비교적 안정적입니다.`);
    } else if (combinationCoverageScore >= 68) {
      evidence.push(`목표 검색 조합 커버력이 ${combinationCoverageScore}점으로 보통 수준입니다.`);
    } else {
      score -= 6;
      improvements.push(`목표 검색 조합 커버력이 ${combinationCoverageScore}점으로 낮습니다. 핵심 조합을 제목/도입부/소제목에 더 직접적으로 연결해 주세요.`);
    }

    const missingCoreCombination = combinationMetrics.find(
      (metric) => metric.priority === "core" && metric.coverageScore < 65
    );
    if (missingCoreCombination) {
      improvements.push(missingCoreCombination.action);
    }
  }

  return {
    score: clampScore(score),
    evidence: uniqueKeywords(evidence).slice(0, 6),
    improvements: uniqueKeywords(improvements).slice(0, 6),
    keywordReport,
    keywordMetrics,
    combinationCoverageScore,
    combinationMetrics,
  };
}
