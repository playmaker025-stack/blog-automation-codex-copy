import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { runFinalDraftCheck } from "../../lib/agents/final-draft-check.ts";

function makeStrategy(overrides = {}) {
  const articleContract = {
    articleRole: "general",
    completionMode: "end_here",
    nodeType: "leaf",
    introPattern: "customer_question",
    conclusionPattern: "criteria_summary",
    mainIntent: "전자담배 선택 기준을 현재 글에서 정리한다.",
    readerState: "처음 고르기 전 기준이 필요한 상태",
    readerQuestions: ["처음엔 어떤 기준부터 보면 좋을까요?"],
    mustResolve: ["흡입감 기준", "관리 편의성"],
    mustNotDefer: ["흡입감 기준"],
    handoffKeyword: null,
    forbiddenExactPhrases: ["선행포스팅", "키워드빌드업"],
    forbiddenHeadingPatterns: ["실패 없는 선택"],
    forbiddenTonePatterns: ["꼭 확인하세요"],
    ctaMode: "기준 정리 후 상담 연결",
    keywordUsagePolicy: {
      avoidSubKeywordStuffingInQuestions: true,
      preferContextualSubKeywordUse: true,
    },
  };

  return {
    title: "전자담배 처음 고르기 전 많이 비교하는 기준 5가지",
    outline: [],
    keyPoints: [],
    estimatedLength: 1600,
    tone: "casual",
    keywords: ["전자담배 선택 기준", "흡입감"],
    suggestedSources: [],
    rationale: "테스트 전략",
    keywordContract: {
      title: "전자담배 처음 고르기 전 많이 비교하는 기준 5가지",
      articleType: "warmup",
      articleStage: "info_summary",
      searchIntent: "처음 전자담배를 고르기 전 비교 기준 확인",
      topology: "leaf",
      bodyRole: "제품 추천 전 기준 정리",
      mainKeyword: "전자담배 선택 기준",
      subKeywords: ["흡입감"],
      bridgeKeywords: ["입호흡 전자담배 추천"],
      internalLinkAnchors: [],
      forbiddenTerms: ["선행포스팅", "키워드빌드업"],
      limitedKeywords: [{ keyword: "전자담배 선택 기준", min: 2, max: 4, role: "main" }],
      excludedTopics: [],
      handoffTopics: ["입호흡 전자담배 추천"],
      differentiationPoints: ["제품명 나열 대신 기준 정리"],
    },
    articleContract,
    ...overrides,
  };
}

describe("PR6 final draft check", () => {
  test("금지 표현을 감지하고 차단한다", () => {
    const result = runFinalDraftCheck({
      title: "테스트",
      strategy: makeStrategy(),
      content: "이 글은 선행포스팅 흐름으로 꼭 확인하세요. 흡입감 기준과 관리 편의성을 정리합니다.",
    });

    assert.equal(result.ok, false);
    assert.ok(result.matchedForbiddenPhrases.includes("선행포스팅"));
    assert.ok(result.blockingReasons.some((reason) => reason.includes("금지 표현")));
  });

  test("질문문 안 서브 키워드 exact phrase를 감지한다", () => {
    const result = runFinalDraftCheck({
      title: "테스트",
      strategy: makeStrategy(),
      content: "\"흡입감 괜찮나요?\"라고 묻기보다 실제 사용 목적을 먼저 확인합니다. 흡입감 기준과 관리 편의성을 정리합니다.",
    });

    assert.equal(result.ok, false);
    assert.ok(result.keywordStuffingFindings.some((finding) => finding.includes("질문문")));
  });

  test("end_here 글의 defer 문장을 감지한다", () => {
    const result = runFinalDraftCheck({
      title: "테스트",
      strategy: makeStrategy(),
      content: "흡입감 기준과 관리 편의성을 정리했습니다. 다음 글에서 더 자세히 다루겠습니다.",
    });

    assert.equal(result.ok, false);
    assert.ok(result.deferFindings.some((finding) => finding.includes("다음 글에서")));
  });

  test("mustResolve 미반영은 warning으로 남긴다", () => {
    const result = runFinalDraftCheck({
      title: "테스트",
      strategy: makeStrategy(),
      content: "전자담배를 고르기 전에는 예산과 사용 시간을 먼저 생각하면 좋습니다.",
    });

    assert.equal(result.ok, true);
    assert.ok(result.contractCoverageFindings.some((finding) => finding.includes("흡입감 기준")));
    assert.ok(result.warnings.some((warning) => warning.includes("mustResolve")));
  });

  test("prelude의 handoffKeyword 과소비는 warning으로 남긴다", () => {
    const strategy = makeStrategy({
      seriesRole: "prelude",
      articleContract: {
        ...makeStrategy().articleContract,
        articleRole: "prelude",
        completionMode: "handoff",
        handoffKeyword: "입호흡 전자담배 추천",
      },
      keywordContract: {
        ...makeStrategy().keywordContract,
        limitedKeywords: [],
        bridgeKeywords: ["입호흡 전자담배 추천"],
      },
    });
    const result = runFinalDraftCheck({
      title: "테스트",
      strategy,
      content:
        "처음 고르기 전 기준을 정리합니다. 입호흡 전자담배 추천은 다음 선택에서 참고합니다. 입호흡 전자담배 추천을 바로 고르기보다 기준이 먼저입니다. 입호흡 전자담배 추천 후보는 뒤에서 보면 됩니다. 흡입감 기준과 관리 편의성을 정리합니다.",
    });

    assert.equal(result.ok, true);
    assert.ok(result.keywordStuffingFindings.some((finding) => finding.includes("handoffKeyword")));
    assert.ok(result.warnings.some((warning) => warning.includes("handoffKeyword")));
  });

  test("정상 초안은 ok=true를 반환한다", () => {
    const result = runFinalDraftCheck({
      title: "테스트",
      strategy: makeStrategy(),
      content:
        "전자담배 선택 기준은 처음부터 제품명을 고르기보다 사용 목적을 정리하는 데서 시작합니다. 흡입감 기준을 먼저 보면 연초와 비슷한 느낌을 원하는지, 부드러운 사용감을 원하는지 구분할 수 있습니다. 관리 편의성도 중요합니다. 충전 방식과 액상 주입 방식, 한 달 유지비를 함께 보면 처음 선택이 훨씬 쉬워집니다.",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.blockingReasons, []);
    assert.deepEqual(result.matchedForbiddenPhrases, []);
  });
});
