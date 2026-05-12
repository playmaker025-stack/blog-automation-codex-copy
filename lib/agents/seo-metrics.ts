import type {
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
  "선택",
  "찾는",
  "이유",
  "실제",
  "시작",
  "전에",
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
]);

function isMeaningfulKeywordToken(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (normalized.length < 2) return false;
  if (GENERIC_KEYWORD_TOKENS.has(normalized)) return false;
  if (/^\d+$/u.test(normalized)) return false;
  return true;
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

function getKeywordTargets(
  bodyLength: number,
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

  if (isPreludeTarget) {
    return { targetMin: 1, targetMax: 3 };
  }

  if (index === 0) {
    if (bodyLength >= 2200) return { targetMin: 5, targetMax: 8 };
    if (bodyLength >= 1400) return { targetMin: 4, targetMax: 6 };
    return { targetMin: 3, targetMax: 5 };
  }

  if (index === 1) {
    if (bodyLength >= 2200) return { targetMin: 2, targetMax: 5 };
    if (bodyLength >= 1400) return { targetMin: 2, targetMax: 4 };
    return { targetMin: 1, targetMax: 3 };
  }

  if (bodyLength >= 2200) return { targetMin: 1, targetMax: 4 };
  if (bodyLength >= 1400) return { targetMin: 1, targetMax: 3 };
  return { targetMin: 1, targetMax: 2 };
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

  return params.keywordReport.items.map((item, index) => {
    const role: KeywordFocusMetric["role"] = index === 0 ? "main" : "sub";
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

    if (isPreludeTarget) {
      completenessScore += 0;
      exposurePotentialScore += 0;
    } else if (titleIncluded) {
      completenessScore += role === "main" ? 8 : 6;
      exposurePotentialScore += role === "main" ? 10 : 8;
    } else {
      completenessScore -= role === "main" ? 14 : 10;
      exposurePotentialScore -= role === "main" ? 16 : 12;
    }

    if (role === "main" && !isPreludeTarget) {
      if (titleFrontLoaded) {
        completenessScore += 6;
        exposurePotentialScore += 6;
      } else {
        completenessScore -= 6;
        exposurePotentialScore -= 8;
      }
    }

    if (introIncluded) {
      completenessScore += role === "main" ? 8 : 5;
      exposurePotentialScore += role === "main" ? 8 : 5;
    } else {
      completenessScore -= role === "main" ? 12 : 7;
      exposurePotentialScore -= role === "main" ? 12 : 8;
    }

    if (earlyCoverage) {
      completenessScore += 4;
      exposurePotentialScore += 4;
    } else {
      completenessScore -= 4;
      exposurePotentialScore -= 5;
    }

    if (role === "main" && !isPreludeTarget) {
      if (firstSentenceIncluded) {
        completenessScore += 6;
        exposurePotentialScore += 7;
      } else {
        completenessScore -= 6;
        exposurePotentialScore -= 7;
      }

      if (headingIncluded) {
        completenessScore += 6;
        exposurePotentialScore += 7;
      } else {
        completenessScore -= 5;
        exposurePotentialScore -= 6;
      }

      if (conclusionIncluded) {
        completenessScore += 4;
        exposurePotentialScore += 4;
      } else {
        completenessScore -= 3;
        exposurePotentialScore -= 4;
      }
    }

    if (item.status === "적정") {
      completenessScore += 10;
      exposurePotentialScore += 10;
    } else if (item.status === "부족") {
      completenessScore -= role === "main" ? 10 : 7;
      exposurePotentialScore -= role === "main" ? 12 : 8;
    } else {
      completenessScore -= role === "main" ? 8 : 6;
      exposurePotentialScore -= role === "main" ? 10 : 7;
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
      summaryParts.push(role === "main" && titleFrontLoaded ? "제목 앞부분 반영" : "제목 반영");
    } else {
      summaryParts.push("제목 미반영");
    }
    summaryParts.push(introIncluded ? "도입부 반영" : "도입부 약함");
    summaryParts.push(`${item.count}회 사용`);

    let action = "현재 흐름을 유지해도 괜찮습니다.";
    if (!titleIncluded) {
      action = `'${item.keyword}'를 제목에 더 직접적으로 넣는 편이 좋습니다.`;
    } else if (!introIncluded) {
      action = `첫 두 문단 안에 '${item.keyword}'를 자연스럽게 보강해 주세요.`;
    } else if (item.status !== "적정") {
      action = item.recommendation;
    } else if (bodyLength < 1200) {
      action = "본문 분량을 조금 더 보강하면 검색 체류 신호에 유리합니다.";
    }

    return {
      keyword: item.keyword,
      role,
      label: role === "main" ? "메인 키워드" : `서브 키워드 ${index}`,
      completenessScore: clampScore(completenessScore),
      exposurePotentialScore: clampScore(exposurePotentialScore),
      count: item.count,
      targetMin: item.targetMin,
      targetMax: item.targetMax,
      titleIncluded,
      titleFrontLoaded,
      introIncluded,
      earlyCoverage,
      summary: summaryParts.join(" · "),
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

  return uniqueKeywords([...keywords, ...titleTokens]).slice(0, limit);
}

function collectKeywordPool(title: string, keywords: string[] = []): string[] {
  const titleTokens = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => isMeaningfulKeywordToken(token));

  return uniqueKeywords([...keywords, ...titleTokens]);
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

export function analyzeKeywordUsage(params: {
  title: string;
  body: string;
  keywords?: string[];
  seriesRole?: "prelude" | "main";
  targetMainKeyword?: string;
}): KeywordUsageReport {
  const keywordPool = collectKeywordPool(params.title, params.keywords);
  const keywords = keywordPool.slice(0, 5);
  const paragraphs = splitParagraphs(params.body);
  const introText = paragraphs.slice(0, 2).join("\n\n");
  const bodyLength = params.body.replace(/\s+/g, "").length;

  const items: KeywordUsageItem[] = keywords.map((keyword, index) => {
    const count = countKeywordOccurrences(params.body, keyword);
    const { targetMin, targetMax } = getKeywordTargets(bodyLength, index, {
      seriesRole: params.seriesRole,
      targetMainKeyword: params.targetMainKeyword,
      keyword,
    });

    let status: KeywordUsageItem["status"] = "적정";
    let recommendation = "현재 밀도를 유지해도 괜찮습니다.";

    if (count < targetMin) {
      status = "부족";
      recommendation = `도입부나 기준 설명 문단에 '${keyword}'를 자연스럽게 1~2회 더 넣는 편이 좋습니다.`;
    } else if (count > targetMax) {
      status = "과다";
      recommendation = `'${keyword}' 반복이 많아 보여서 일부는 동의어/맥락 표현으로 바꾸는 편이 좋습니다.`;
    }

    return {
      keyword,
      count,
      status,
      targetMin,
      targetMax,
      recommendation,
    };
  });

  const mainKeyword = items[0]?.keyword ?? "";
  const introCoverage = mainKeyword ? countKeywordOccurrences(introText, mainKeyword) > 0 : true;
  const titleFrontLoaded =
    mainKeyword ? params.title.indexOf(mainKeyword) >= 0 && params.title.indexOf(mainKeyword) <= 12 : true;
  const totalMentions = items.reduce((sum, item) => sum + item.count, 0);

  const summary: string[] = [];
  if (mainKeyword) {
    summary.push(`메인 키워드 '${mainKeyword}' 반복 ${items[0]?.count ?? 0}회`);
  }
  if (!introCoverage && mainKeyword) {
    summary.push("도입부에 메인 키워드가 부족합니다.");
  }
  if (!titleFrontLoaded && mainKeyword) {
    summary.push("제목 앞부분에 메인 키워드가 더 빨리 보이면 SEO에 유리합니다.");
  }

  const recommendations = items.filter((item) => item.status !== "적정").map((item) => item.recommendation);

  const tokenItems = buildKeywordTokenItems(keywordPool, params.body);
  return {
    items,
    tokenItems,
    totalMentions,
    introCoverage,
    titleFrontLoaded,
    bodyLength,
    summary,
    recommendations,
  };
}

export function evaluateSeoCompleteness(params: {
  title: string;
  body: string;
  keywords?: string[];
  targetSearchCombinations?: SearchCombinationTarget[];
  seriesRole?: "prelude" | "main";
  targetMainKeyword?: string;
}): SeoEvaluation {
  const keywordReport = analyzeKeywordUsage(params);
  const keywordMetrics = buildKeywordFocusMetrics({
    title: params.title,
    body: params.body,
    keywordReport,
    seriesRole: params.seriesRole,
    targetMainKeyword: params.targetMainKeyword,
  });
  const combinations =
    (params.targetSearchCombinations ?? []).length > 0
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
    if (item.status === "적정") {
      evidence.push(`'${item.keyword}' 반복 ${item.count}회로 과하지 않습니다.`);
      continue;
    }
    if (item.status === "부족") {
      score -= item.keyword === keywordReport.items[0]?.keyword ? 10 : 5;
      improvements.push(item.recommendation);
      continue;
    }
    score -= item.keyword === keywordReport.items[0]?.keyword ? 8 : 4;
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
