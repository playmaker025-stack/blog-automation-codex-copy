import type {
  ArticleContract,
  FinalDraftCheck,
  KeywordLimit,
  OverlapReport,
  StrategyPlanResult,
} from "./types";

const DEFER_PHRASES = [
  "다음 글에서",
  "다음 포스팅에서",
  "다음에 자세히",
  "다음 편에서",
  "다음 시간에",
  "다음 글로",
  "추후 자세히",
];

const PRELUDE_MAIN_CONSUMPTION_PATTERNS = [
  /TOP\s*5/iu,
  /베스트\s*\d+/iu,
  /순위/iu,
  /추천\s*(제품|기기|리스트|모델)/iu,
  /제품명/iu,
  /1위|2위|3위/iu,
];

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

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countExactPhrase(content: string, phrase: string): number {
  const target = normalizeText(phrase);
  if (!target) return 0;
  const normalized = normalizeText(content);
  const matches = normalized.match(new RegExp(escapeRegExp(target), "giu"));
  return matches?.length ?? 0;
}

function containsLoose(content: string, phrase: string): boolean {
  const target = normalizeLoose(phrase);
  if (target.length < 2) return false;
  return normalizeLoose(content).includes(target);
}

function tokenizeMeaningful(value: string): string[] {
  return uniq(
    value
      .normalize("NFKC")
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function phraseHasMinimalCue(content: string, phrase: string): boolean {
  if (containsLoose(content, phrase)) return true;
  const tokens = tokenizeMeaningful(phrase);
  if (tokens.length === 0) return false;
  const looseContent = normalizeLoose(content);
  const matched = tokens.filter((token) => looseContent.includes(normalizeLoose(token))).length;
  return matched >= Math.min(2, tokens.length);
}

function findForbiddenMatches(content: string, contract?: ArticleContract): string[] {
  const phrases = uniq([
    ...(contract?.forbiddenTonePatterns ?? []),
    ...(contract?.forbiddenHeadingPatterns ?? []),
    ...(contract?.forbiddenExactPhrases ?? []),
  ]);
  return phrases.filter((phrase) => containsLoose(content, phrase) || countExactPhrase(content, phrase) > 0);
}

function extractQuestionLikeFragments(content: string): string[] {
  const fragments: string[] = [];
  const quoteRegex = /["'“”‘’「」『』](.{2,120}?)[?"'“”‘’」』]/gu;
  for (const match of content.matchAll(quoteRegex)) {
    const fragment = match[1]?.trim();
    if (fragment) fragments.push(fragment);
  }

  const sentenceRegex = /[^.!?\n。！？]*[?？][^.!?\n。！？]*/gu;
  for (const match of content.matchAll(sentenceRegex)) {
    const fragment = match[0]?.trim();
    if (fragment) fragments.push(fragment);
  }

  return uniq(fragments);
}

function findQuestionKeywordStuffing(params: {
  content: string;
  contract?: ArticleContract;
  strategy: StrategyPlanResult;
}): string[] {
  const contract = params.contract;
  const shouldCheck = contract?.keywordUsagePolicy?.avoidSubKeywordStuffingInQuestions ?? true;
  if (!shouldCheck) return [];

  const keywords = uniq([
    params.strategy.keywordContract?.mainKeyword ?? "",
    ...(params.strategy.keywordContract?.subKeywords ?? []),
    ...(params.strategy.keywords ?? []),
  ].filter(Boolean));
  if (!keywords.length) return [];

  const fragments = extractQuestionLikeFragments(params.content);
  const findings: string[] = [];
  for (const fragment of fragments) {
    const matched = keywords.filter((keyword) => countExactPhrase(fragment, keyword) > 0);
    if (matched.length > 0) {
      findings.push(`질문문/따옴표 안 exact keyword 사용: ${matched.join(", ")} / "${fragment.slice(0, 80)}"`);
    }
  }
  return uniq(findings);
}

function evaluateKeywordLimits(content: string, limits: KeywordLimit[] | undefined): string[] {
  if (!limits?.length) return [];
  return limits
    .map((limit) => {
      const count = countExactPhrase(content, limit.keyword);
      if (count <= limit.max) return null;
      return `${limit.role} keyword "${limit.keyword}" ${count}회 사용, 상한 ${limit.max}회 초과`;
    })
    .filter((finding): finding is string => Boolean(finding));
}

function findDeferViolations(content: string, contract?: ArticleContract): string[] {
  if (contract?.completionMode !== "end_here") return [];
  return DEFER_PHRASES.filter((phrase) => countExactPhrase(content, phrase) > 0).map(
    (phrase) => `end_here 글에서 defer 표현 사용: "${phrase}"`
  );
}

function findContractCoverage(content: string, contract?: ArticleContract): string[] {
  if (!contract) return ["ArticleContract가 없어 최종 계약 이행 여부를 확인하지 못했습니다."];

  const findings: string[] = [];
  for (const item of contract.mustResolve ?? []) {
    if (!phraseHasMinimalCue(content, item)) {
      findings.push(`mustResolve 단서 부족: ${item}`);
    }
  }
  return findings;
}

function findOverlapIssues(content: string, report?: OverlapReport): string[] {
  if (!report || report.riskLevel === "low") return [];

  const findings: string[] = [];
  const prefix = report.riskLevel === "high" ? "high overlap" : "medium overlap";

  if (report.similarTitles.length > 0) {
    const reflected = report.similarTitles.filter((title) => containsLoose(content, title) || countExactPhrase(content, title) > 0);
    findings.push(`${prefix}: 기존 제목 유사 위험 ${report.similarTitles.length}건${reflected.length ? `, 본문 직접 반영 ${reflected.length}건` : ""}`);
  }
  if (report.repeatedIntroPatterns.length > 0) {
    findings.push(`${prefix}: 도입 패턴 반복 위험 ${report.repeatedIntroPatterns.join(", ")}`);
  }
  if (report.repeatedConclusionPatterns.length > 0) {
    findings.push(`${prefix}: 결론 패턴 반복 위험 ${report.repeatedConclusionPatterns.join(", ")}`);
  }
  if (report.repeatedInternalLinkTargets.length > 0) {
    const reflected = report.repeatedInternalLinkTargets.filter((target) => containsLoose(content, target));
    findings.push(`${prefix}: 내부링크 대상 반복 위험 ${report.repeatedInternalLinkTargets.join(", ")}${reflected.length ? `, 본문 반영 ${reflected.join(", ")}` : ""}`);
  }
  if (report.repeatedCtaModes.length > 0) {
    findings.push(`${prefix}: CTA 반복 위험 ${report.repeatedCtaModes.length}건`);
  }
  if (report.roleConflicts.length > 0) {
    findings.push(`${prefix}: 역할 충돌 ${report.roleConflicts.join(" / ")}`);
  }

  return findings;
}

function findPreludeOverConsumption(params: {
  content: string;
  contract?: ArticleContract;
  strategy: StrategyPlanResult;
}): string[] {
  const contract = params.contract;
  if (contract?.articleRole !== "prelude" && params.strategy.seriesRole !== "prelude") return [];

  const findings: string[] = [];
  const handoffKeyword =
    contract?.handoffKeyword ||
    params.strategy.keywordContract?.bridgeKeywords?.[0] ||
    params.strategy.targetMainKeyword ||
    "";
  const handoffCount = handoffKeyword ? countExactPhrase(params.content, handoffKeyword) : 0;
  if (handoffKeyword && handoffCount >= 3) {
    findings.push(`prelude가 handoffKeyword "${handoffKeyword}"를 ${handoffCount}회 사용했습니다. 본편 키워드 소비를 줄여야 합니다.`);
  }

  const consumedMainRecommendation = PRELUDE_MAIN_CONSUMPTION_PATTERNS
    .filter((pattern) => pattern.test(params.content))
    .map((pattern) => pattern.source);
  if (consumedMainRecommendation.length > 0) {
    findings.push(`prelude 본문에 main_recommendation 성격의 표현이 감지됐습니다: ${consumedMainRecommendation.join(", ")}`);
  }

  return findings;
}

export function runFinalDraftCheck(params: {
  title: string;
  content: string;
  strategy: StrategyPlanResult;
}): FinalDraftCheck {
  const contract = params.strategy.articleContract;
  const overlapReport = params.strategy.overlapReport;

  const matchedForbiddenPhrases = findForbiddenMatches(params.content, contract);
  const questionStuffing = findQuestionKeywordStuffing({
    content: params.content,
    contract,
    strategy: params.strategy,
  });
  const keywordLimitFindings = evaluateKeywordLimits(params.content, params.strategy.keywordContract?.limitedKeywords);
  const preludeConsumptionFindings = findPreludeOverConsumption({
    content: params.content,
    contract,
    strategy: params.strategy,
  });
  const keywordStuffingFindings = uniq([
    ...questionStuffing,
    ...keywordLimitFindings,
    ...preludeConsumptionFindings,
  ]);
  const deferFindings = findDeferViolations(params.content, contract);
  const contractCoverageFindings = findContractCoverage(params.content, contract);
  const overlapFindings = findOverlapIssues(params.content, overlapReport);

  const blockingReasons = uniq([
    ...matchedForbiddenPhrases.map((phrase) => `금지 표현 감지: ${phrase}`),
    ...questionStuffing,
    ...keywordLimitFindings,
    ...deferFindings,
    ...(overlapReport?.riskLevel === "high" ? overlapFindings : []),
  ]);

  const warnings = uniq([
    ...contractCoverageFindings,
    ...preludeConsumptionFindings,
    ...(overlapReport?.riskLevel === "medium" ? overlapFindings : []),
  ]);

  return {
    ok: blockingReasons.length === 0,
    blockingReasons,
    warnings,
    matchedForbiddenPhrases,
    keywordStuffingFindings,
    deferFindings,
    contractCoverageFindings,
    overlapFindings,
  };
}
