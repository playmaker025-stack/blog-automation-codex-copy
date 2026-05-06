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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitCombinationTokens(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
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
}): KeywordFocusMetric[] {
  const paragraphs = splitParagraphs(params.body);
  const introText = paragraphs.slice(0, 2).join("\n\n");
  const earlyText = paragraphs.slice(0, 4).join("\n\n");
  const compactTitle = params.title.toLowerCase();
  const bodyLength = params.keywordReport.bodyLength;

  return params.keywordReport.items.map((item, index) => {
    const role: KeywordFocusMetric["role"] = index === 0 ? "main" : "sub";
    const titleIncluded = compactTitle.includes(item.keyword.toLowerCase());
    const titleFrontLoaded =
      titleIncluded && params.title.indexOf(item.keyword) >= 0 && params.title.indexOf(item.keyword) <= 12;
    const introIncluded = includesKeyword(introText, item.keyword);
    const earlyCoverage = includesKeyword(earlyText, item.keyword);

    let completenessScore = role === "main" ? 76 : 72;
    let exposurePotentialScore = role === "main" ? 74 : 70;

    if (titleIncluded) {
      completenessScore += role === "main" ? 8 : 6;
      exposurePotentialScore += role === "main" ? 10 : 8;
    } else {
      completenessScore -= role === "main" ? 14 : 10;
      exposurePotentialScore -= role === "main" ? 16 : 12;
    }

    if (role === "main") {
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
    .filter((token) => token.length >= 2);

  return uniqueKeywords([...keywords, ...titleTokens]).slice(0, limit);
}

export function countKeywordOccurrences(body: string, keyword: string): number {
  const trimmed = keyword.trim();
  if (!trimmed) return 0;
  const matches = body.match(new RegExp(escapeRegExp(trimmed), "giu"));
  return matches?.length ?? 0;
}

export function analyzeKeywordUsage(params: {
  title: string;
  body: string;
  keywords?: string[];
}): KeywordUsageReport {
  const keywords = selectFocusKeywords(params.title, params.keywords);
  const paragraphs = splitParagraphs(params.body);
  const introText = paragraphs.slice(0, 2).join("\n\n");

  const items: KeywordUsageItem[] = keywords.map((keyword, index) => {
    const count = countKeywordOccurrences(params.body, keyword);
    const targetMin = index === 0 ? 2 : 1;
    const targetMax = index <= 1 ? 6 : 4;

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
  const bodyLength = params.body.replace(/\s+/g, "").length;
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

  return {
    items,
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
}): SeoEvaluation {
  const keywordReport = analyzeKeywordUsage(params);
  const keywordMetrics = buildKeywordFocusMetrics({
    title: params.title,
    body: params.body,
    keywordReport,
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

  if (keywordReport.titleFrontLoaded) {
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
    score -= 10;
    improvements.push(`첫 두 문단 안에 '${keywordReport.items[0].keyword}'를 자연스럽게 넣는 편이 좋습니다.`);
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
