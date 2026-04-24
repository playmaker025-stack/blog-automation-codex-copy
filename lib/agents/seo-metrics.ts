import type { KeywordUsageItem, KeywordUsageReport, SeoEvaluation } from "./types";

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
  const titleFrontLoaded = mainKeyword ? params.title.indexOf(mainKeyword) >= 0 && params.title.indexOf(mainKeyword) <= 12 : true;
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

  const recommendations = items
    .filter((item) => item.status !== "적정")
    .map((item) => item.recommendation);

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
}): SeoEvaluation {
  const keywordReport = analyzeKeywordUsage(params);
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

  return {
    score: clampScore(score),
    evidence: evidence.slice(0, 5),
    improvements: uniqueKeywords(improvements).slice(0, 5),
    keywordReport,
  };
}
