import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  runFinalDraftCheck,
  runLimitedFinalDraftRewrite,
} from "../../lib/agents/final-draft-check.ts";

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

describe("PR8 limited final draft rewrite", () => {
  test("금지 표현이 있는 초안은 1회 rewrite 후 제거된다", () => {
    const strategy = makeStrategy();
    const content = "이 글은 선행포스팅 흐름입니다. 꼭 확인하세요. 흡입감 기준과 관리 편의성을 정리합니다.";
    const result = runLimitedFinalDraftRewrite({
      title: "테스트",
      content,
      strategy,
    });

    assert.equal(result.attempted, true);
    assert.equal(result.applied, true);
    assert.equal(result.content.includes("선행포스팅"), false);
    assert.equal(result.content.includes("꼭 확인하세요"), false);
    assert.equal(result.afterCheck.ok, true);
  });

  test("질문문 안 exact keyword는 자연 질문으로 수정된다", () => {
    const strategy = makeStrategy();
    const content = "\"흡입감 괜찮나요?\"라고 묻는 분들이 많습니다. 흡입감 기준과 관리 편의성을 정리합니다.";
    const result = runLimitedFinalDraftRewrite({
      title: "테스트",
      content,
      strategy,
    });

    assert.equal(result.attempted, true);
    assert.equal(result.content.includes("\"흡입감 괜찮나요?\""), false);
    assert.equal(runFinalDraftCheck({ title: "테스트", content: result.content, strategy }).blockingReasons.length, 0);
  });

  test("end_here defer 문장은 현재 글 안에서 답변하는 문장으로 바뀐다", () => {
    const strategy = makeStrategy();
    const content = "흡입감 기준과 관리 편의성을 정리했습니다. 다음 글에서 더 자세히 다루겠습니다.";
    const result = runLimitedFinalDraftRewrite({
      title: "테스트",
      content,
      strategy,
    });

    assert.equal(result.attempted, true);
    assert.equal(result.content.includes("다음 글에서"), false);
    assert.equal(result.afterCheck.deferFindings.length, 0);
  });

  test("rewrite 후에도 blockingReasons가 남으면 승인 차단 상태를 유지한다", () => {
    const strategy = makeStrategy({
      articlePlan: {
        title: "입호흡 전자담배 추천 베스트 5",
        mainKeyword: "입호흡 전자담배 추천",
        subKeywords: ["입호흡"],
        searchIntent: "구매검토형",
        requiredEntities: ["유웰 발라리안 맥스프로"],
        lockedRequirements: ["본문에 추천 기기 5개를 모두 포함한다."],
        requiredSections: ["유웰 발라리안 맥스프로 추천 이유와 추천 대상"],
        duplicateMode: "force_duplicate",
        planVersion: 1,
        updatedAt: "2026-06-09T00:00:00.000Z",
      },
    });
    const content = "입호흡 전자담배 추천은 흡입감 기준과 관리 편의성을 함께 봐야 합니다.";
    const result = runLimitedFinalDraftRewrite({
      title: "테스트",
      content,
      strategy,
    });

    assert.equal(result.attempted, true);
    assert.equal(result.afterCheck.ok, false);
    assert.ok(result.afterCheck.blockingReasons.some((reason) => reason.includes("유웰 발라리안 맥스프로")));
  });

  test("warning only는 rewrite를 실행하지 않는다", () => {
    const strategy = makeStrategy();
    const content = "전자담배를 고르기 전에는 예산과 사용 시간을 먼저 생각하면 좋습니다.";
    const before = runFinalDraftCheck({ title: "테스트", content, strategy });
    const result = runLimitedFinalDraftRewrite({
      title: "테스트",
      content,
      strategy,
      beforeCheck: before,
    });

    assert.equal(before.ok, true);
    assert.ok(before.warnings.length > 0);
    assert.equal(result.attempted, false);
    assert.equal(result.content, content);
  });
});
