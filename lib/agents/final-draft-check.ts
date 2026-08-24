import type {
  ArticleContract,
  ConfirmedSeoKeywords,
  FinalDraftCheck,
  KeywordLimit,
  OverlapReport,
  StrategyPlanResult,
} from "./types";
import { buildConfirmedSeoKeywords } from "./confirmed-seo-keywords.ts";
import {
  findSpecViolations,
  describeSpecViolation,
  type ProductSpecRegistry,
} from "./product-specs.ts";

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
    keywordContract: {
      mainKeyword: strategy.articlePlan?.mainKeyword ?? strategy.keywordContract?.mainKeyword ?? "",
      subKeywords: strategy.articlePlan?.subKeywords?.length
        ? strategy.articlePlan.subKeywords
        : (strategy.keywordContract?.subKeywords ?? []),
    },
    topicMetadata: {
      targetKeyword: strategy.articlePlan?.mainKeyword ?? strategy.keywordContract?.mainKeyword ?? "",
      targetMainKeyword: strategy.targetMainKeyword,
      subKeywords: strategy.articlePlan?.subKeywords?.length
        ? strategy.articlePlan.subKeywords
        : (strategy.keywordContract?.subKeywords ?? []),
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

function findArticlePlanCoverage(content: string, strategy: StrategyPlanResult): { blocking: string[]; warnings: string[] } {
  const plan = strategy.articlePlan;
  if (!plan) {
    return { blocking: [], warnings: ["ArticlePlan이 없어 사용자 고정 요구사항 검수를 건너뛰었습니다."] };
  }

  const blocking: string[] = [];
  const warnings: string[] = [];
  const normalizedContent = normalizeText(content);

  for (const entity of plan.requiredEntities) {
    if (!containsLoose(content, entity)) {
      blocking.push(`필수 포함 요소 누락: ${entity}`);
      continue;
    }

    const start = normalizedContent.indexOf(normalizeText(entity));
    if (start >= 0) {
      const context = normalizedContent.slice(start, Math.min(normalizedContent.length, start + 420));
      if (!/(추천 이유|추천하는 이유|이유는|장점은|추천 포인트|왜 추천)/.test(context)) {
        blocking.push(`필수 포함 요소 '${entity}' 아래 추천 이유가 부족합니다.`);
      }
      if (!/(추천 대상|잘 맞는 분|어울리는 분|이런 분|이런 분께|입문자|기존 사용자|사용자 유형)/.test(context)) {
        blocking.push(`필수 포함 요소 '${entity}' 아래 추천 대상이 부족합니다.`);
      }
    }
  }

  for (const section of plan.requiredSections) {
    if (!phraseHasMinimalCue(content, section)) {
      warnings.push(`필수 섹션 반영 부족: ${section}`);
    }
  }

  if (plan.lockedRequirements.some((item) => item.includes("기준 설명형 글로만 작성하지 않는다."))) {
    const includedEntityCount = plan.requiredEntities.filter((entity) => containsLoose(content, entity)).length;
    if (includedEntityCount === 0) {
      blocking.push("제품별 추천 구조 없이 일반 기준 설명형 글로만 작성되었습니다.");
    }
  }

  if (plan.planVersion <= 0) {
    blocking.push("최신 글쓰기 계획 버전이 아닙니다.");
  }

  return {
    blocking: uniq(blocking),
    warnings: uniq(warnings),
  };
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
  /** 제품 사양 원장. 없으면 사양 검사를 건너뛴다. */
  productSpecs?: ProductSpecRegistry;
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
  const articlePlanCoverage = findArticlePlanCoverage(params.content, params.strategy);
  const overlapFindings = findOverlapIssues(params.content, overlapReport);

  // 사양 검사. 등록값과 반대되는 주장(모순)은 명백한 거짓이라 차단하고,
  // 원장에 값이 없는 항목을 단정한 경우(미확인)는 원장이 자랄 때까지 경고로 둔다.
  const specViolations = params.productSpecs
    ? findSpecViolations(params.content, params.productSpecs)
    : [];
  const specContradictions = specViolations
    .filter((v) => v.kind === "모순")
    .map(describeSpecViolation);
  const specSoftFindings = specViolations
    .filter((v) => v.kind !== "모순")
    .map(describeSpecViolation);

  const blockingReasons = uniq([
    ...matchedForbiddenPhrases.map((phrase) => `금지 표현 감지: ${phrase}`),
    ...questionStuffing,
    ...keywordLimitFindings,
    ...deferFindings,
    ...articlePlanCoverage.blocking,
    ...specContradictions,
  ]);

  const warnings = uniq([
    ...contractCoverageFindings,
    ...articlePlanCoverage.warnings,
    ...preludeConsumptionFindings,
    ...(overlapReport?.riskLevel === "high" ? overlapFindings : []),
    ...(overlapReport?.riskLevel === "medium" ? overlapFindings : []),
    ...specSoftFindings,
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
    specFindings: uniq([...specContradictions, ...specSoftFindings]),
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

// ============================================================
// 발행 본문 자동 수정 금지 원칙
// ------------------------------------------------------------
// finalDraftCheck는 위반을 "감지"만 한다. 예전에는 여기서 금지어를 빈 문자열로
// 지우고, 걸린 소제목을 고정 문자열로 갈아끼우고, 누락 항목에 템플릿 문단을
// 덧붙였다. 그 결과 모든 글에 동일한 소제목과 동일한 안내 문장이 박혀서
// 사람이 쓴 글이 아니라 코드가 조립한 글처럼 읽혔다.
//
// 지금은 위반을 재작성 지시문으로만 바꾸고, 실제 수정은 master-writer가 한다.
// writer-revision-policy.shouldAttemptWriterRevision이 blockingReasons > 0이면
// 자동으로 재작성 라운드를 돌리므로 차단된 초안은 그대로 방치되지 않는다.
// ============================================================

export function buildFinalDraftRevisionInstructions(check: FinalDraftCheck): string[] {
  return uniq([
    ...check.matchedForbiddenPhrases.map(
      (phrase) => `금지 표현 '${phrase}'을(를) 쓰지 말고, 같은 뜻을 사용자 말투의 다른 문장으로 다시 쓰세요. 단어만 지우지 말고 문장을 다시 쓰세요.`
    ),
    ...check.keywordStuffingFindings.map(
      (finding) => `키워드 과다/질문문 삽입 수정: ${finding}. 손님 질문은 실제 말투로 두고, 키워드는 설명 문단으로 옮기세요.`
    ),
    ...check.deferFindings.map(
      (finding) => `${finding} — 미루는 문장을 지우는 데 그치지 말고, 그 자리에서 실제 답을 본문에 쓰세요.`
    ),
    ...check.contractCoverageFindings.map(
      (finding) => `${finding} — 별도 요약 섹션을 덧붙이지 말고, 관련 본문 문단 안에서 자연스럽게 다루세요.`
    ),
    ...check.blockingReasons.map((reason) => `발행 차단 사유 해결: ${reason}`),
  ]);
}

export function formatFinalDraftRevisionSection(check: FinalDraftCheck | null | undefined): string {
  if (!check || check.blockingReasons.length === 0) return "";
  const instructions = buildFinalDraftRevisionInstructions(check);
  if (instructions.length === 0) return "";

  return [
    "발행 전 검수에서 걸린 항목 (반드시 본문 재작성으로 해결)",
    ...instructions.map((item) => `- ${item}`),
    "- 위 항목은 문장을 지우거나 고정 문구로 갈아끼우는 방식으로 해결하지 마세요. 해당 문단을 사용자 말투로 다시 쓰세요.",
  ].join("\n");
}
