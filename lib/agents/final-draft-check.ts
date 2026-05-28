import type {
  ArticleContract,
  ConfirmedSeoKeywords,
  FinalDraftCheck,
  FinalDraftRewriteResult,
  KeywordLimit,
  OverlapReport,
  StrategyPlanResult,
} from "./types";
import { buildConfirmedSeoKeywords } from "./confirmed-seo-keywords.ts";

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

function collectConfirmedDraftCheckKeywords(
  strategy: StrategyPlanResult,
  confirmedSeoKeywords?: ConfirmedSeoKeywords
): string[] {
  const confirmed = confirmedSeoKeywords ?? buildConfirmedSeoKeywords({
    keywordContract: strategy.keywordContract,
    topicMetadata: {
      targetKeyword: strategy.keywordContract?.mainKeyword,
      targetMainKeyword: strategy.targetMainKeyword,
      subKeywords: strategy.keywordContract?.subKeywords,
    },
  });

  return uniq([
    confirmed.mainKeyword ?? "",
    ...confirmed.subKeywords,
  ].filter(Boolean));
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
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
  confirmedSeoKeywords?: ConfirmedSeoKeywords;
}): string[] {
  const contract = params.contract;
  const shouldCheck = contract?.keywordUsagePolicy?.avoidSubKeywordStuffingInQuestions ?? true;
  if (!shouldCheck) return [];

  const keywords = collectConfirmedDraftCheckKeywords(params.strategy, params.confirmedSeoKeywords);
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
    findings.push(`prelude 본문에서 main_recommendation 성격의 표현이 감지됐습니다: ${consumedMainRecommendation.join(", ")}`);
  }

  return findings;
}

export function runFinalDraftCheck(params: {
  title: string;
  content: string;
  strategy: StrategyPlanResult;
  confirmedSeoKeywords?: ConfirmedSeoKeywords;
}): FinalDraftCheck {
  const contract = params.strategy.articleContract;
  const overlapReport = params.strategy.overlapReport;

  const matchedForbiddenPhrases = findForbiddenMatches(params.content, contract);
  const questionStuffing = findQuestionKeywordStuffing({
    content: params.content,
    contract,
    strategy: params.strategy,
    confirmedSeoKeywords: params.confirmedSeoKeywords,
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

export type FinalDraftCheckApprovalStatus = "pass" | "warning" | "blocked";

export function getFinalDraftCheckApprovalStatus(
  check: FinalDraftCheck | null | undefined
): FinalDraftCheckApprovalStatus {
  if (!check) return "warning";
  if (check.blockingReasons.length > 0) return "blocked";
  if (check.warnings.length > 0) return "warning";
  return "pass";
}

export function canApproveFinalDraft(check: FinalDraftCheck | null | undefined): boolean {
  return getFinalDraftCheckApprovalStatus(check) !== "blocked";
}

export function collectFinalDraftCheckMessages(check: FinalDraftCheck | null | undefined): {
  blockingReasons: string[];
  warnings: string[];
  matchedForbiddenPhrases: string[];
  keywordStuffingFindings: string[];
  deferFindings: string[];
  contractCoverageFindings: string[];
  overlapFindings: string[];
} {
  return {
    blockingReasons: check?.blockingReasons ?? [],
    warnings: check?.warnings ?? [],
    matchedForbiddenPhrases: check?.matchedForbiddenPhrases ?? [],
    keywordStuffingFindings: check?.keywordStuffingFindings ?? [],
    deferFindings: check?.deferFindings ?? [],
    contractCoverageFindings: check?.contractCoverageFindings ?? [],
    overlapFindings: check?.overlapFindings ?? [],
  };
}

function replaceExactPhraseAll(content: string, phrase: string, replacement: string): string {
  if (!phrase.trim()) return content;
  return content.replace(new RegExp(escapeRegExp(phrase), "giu"), replacement);
}

function removeForbiddenPhrases(content: string, phrases: string[]): string {
  let next = content;
  for (const phrase of phrases) {
    next = replaceExactPhraseAll(next, phrase, "");
  }
  return next
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function rewriteForbiddenHeadings(content: string, contract?: ArticleContract): string {
  const patterns = contract?.forbiddenHeadingPatterns ?? [];
  if (!patterns.length) return content;
  return content
    .split("\n")
    .map((line) => {
      if (!/^#{1,6}\s+/.test(line)) return line;
      if (!patterns.some((pattern) => countExactPhrase(line, pattern) > 0 || containsLoose(line, pattern))) return line;
      const level = line.match(/^#{1,6}/)?.[0] ?? "##";
      return `${level} 확인 기준 정리`;
    })
    .join("\n");
}

function naturalizeQuestionKeywordStuffing(
  content: string,
  strategy: StrategyPlanResult,
  confirmedSeoKeywords?: ConfirmedSeoKeywords
): string {
  const keywords = collectConfirmedDraftCheckKeywords(strategy, confirmedSeoKeywords);
  if (!keywords.length) return content;

  return content
    .split("\n")
    .map((line) => {
      const questionLike = /[?？]|["“”'‘’「」『』]/u.test(line);
      if (!questionLike) return line;
      let next = line;
      for (const keyword of keywords) {
        if (countExactPhrase(next, keyword) > 0) {
          next = replaceExactPhraseAll(next, keyword, "이 기준");
        }
      }
      return next.replace(/\s{2,}/g, " ");
    })
    .join("\n");
}

function resolveDeferSentences(content: string, contract?: ArticleContract): string {
  if (contract?.completionMode !== "end_here") return content;
  let next = content;
  for (const phrase of DEFER_PHRASES) {
    next = replaceExactPhraseAll(next, phrase, "이 글에서");
  }
  return next
    .replace(/이 글에서\s*(더\s*)?자세히\s*(다루겠습니다|알아보겠습니다|정리하겠습니다)/giu, "이 글에서 바로 정리합니다")
    .replace(/이 글에서\s*(확인해\s*보겠습니다|보겠습니다)/giu, "이 글에서 확인합니다");
}

function appendMissingMustResolveParagraphs(content: string, check: FinalDraftCheck, contract?: ArticleContract): string {
  if (!contract?.mustResolve?.length || check.contractCoverageFindings.length === 0) return content;
  const missing = contract.mustResolve.filter((item) => !phraseHasMinimalCue(content, item));
  if (!missing.length) return content;
  const addition = [
    "",
    "## 추가 확인 기준",
    ...missing.map((item) => `- ${item}: 이 글에서 바로 확인해야 할 기준입니다. 실제 선택 전에 이 부분을 먼저 점검하면 판단이 쉬워집니다.`),
  ].join("\n");
  return `${content.trimEnd()}\n${addition}`;
}

function buildLimitedRewriteInstructions(check: FinalDraftCheck): string[] {
  return uniq([
    ...check.blockingReasons.map((reason) => `차단 사유 수정: ${reason}`),
    ...check.matchedForbiddenPhrases.map((phrase) => `금지 표현 제거: ${phrase}`),
    ...check.keywordStuffingFindings.map((finding) => `키워드/질문문 자연화: ${finding}`),
    ...check.deferFindings.map((finding) => `defer 문장 제거: ${finding}`),
    ...check.contractCoverageFindings.map((finding) => `누락 기준 보강: ${finding}`),
  ]);
}

export function runLimitedFinalDraftRewrite(params: {
  title: string;
  content: string;
  strategy: StrategyPlanResult;
  beforeCheck?: FinalDraftCheck;
  confirmedSeoKeywords?: ConfirmedSeoKeywords;
}): FinalDraftRewriteResult & { content: string } {
  const beforeCheck = params.beforeCheck ?? runFinalDraftCheck(params);
  if (beforeCheck.ok || beforeCheck.blockingReasons.length === 0) {
    return {
      attempted: false,
      applied: false,
      instructions: [],
      beforeCheck,
      afterCheck: beforeCheck,
      content: params.content,
    };
  }

  const instructions = buildLimitedRewriteInstructions(beforeCheck);
  let rewritten = params.content;
  rewritten = removeForbiddenPhrases(rewritten, beforeCheck.matchedForbiddenPhrases);
  rewritten = rewriteForbiddenHeadings(rewritten, params.strategy.articleContract);
  rewritten = naturalizeQuestionKeywordStuffing(rewritten, params.strategy, params.confirmedSeoKeywords);
  rewritten = resolveDeferSentences(rewritten, params.strategy.articleContract);
  rewritten = appendMissingMustResolveParagraphs(rewritten, beforeCheck, params.strategy.articleContract);
  rewritten = rewritten.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  const afterCheck = runFinalDraftCheck({
    title: params.title,
    content: rewritten,
    strategy: params.strategy,
    confirmedSeoKeywords: params.confirmedSeoKeywords,
  });

  return {
    attempted: true,
    applied: rewritten !== params.content,
    instructions,
    beforeCheck,
    afterCheck,
    content: rewritten,
  };
}
