import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { evaluateStrategyQualityGate } from "../../lib/agents/article-contract-utils.ts";
import { runFinalDraftCheck } from "../../lib/agents/final-draft-check.ts";

function makeStrategy(overrides = {}) {
  return {
    title: "부평 전자담배 추천",
    outline: [],
    keyPoints: [],
    estimatedLength: 1600,
    tone: "friendly",
    keywords: ["부평 전자담배 추천", "부평 전자담배"],
    suggestedSources: [],
    rationale: "중복 무시 작성 테스트",
    keywordContract: {
      title: "부평 전자담배 추천",
      articleType: "main_recommendation",
      articleStage: "purchase_review",
      searchIntent: "부평에서 전자담배 추천 기준을 확인",
      topology: "hub",
      bodyRole: "추천 기준과 상담 흐름 정리",
      mainKeyword: "부평 전자담배 추천",
      subKeywords: ["부평 전자담배"],
      bridgeKeywords: [],
      internalLinkAnchors: [],
      forbiddenTerms: [],
      limitedKeywords: [],
      excludedTopics: [],
      handoffTopics: [],
      differentiationPoints: ["사용자 유형별 기준 분리"],
    },
    articleContract: {
      articleRole: "main_recommendation",
      completionMode: "end_here",
      nodeType: "hub",
      introPattern: "customer_question",
      conclusionPattern: "visit_consultation",
      mainIntent: "부평 전자담배 추천을 찾는 사람이 추천 기준과 상담 흐름을 알고 싶어 함",
      readerState: "무엇부터 비교해야 할지 모르는 상태",
      readerQuestions: ["요즘 뭐가 제일 잘 나가요?"],
      mustResolve: ["추천 기준", "사용자 유형별 분기", "방문 전 상담 기준"],
      mustNotDefer: ["추천 기준", "방문 전 상담 기준"],
      handoffKeyword: null,
      forbiddenExactPhrases: [],
      forbiddenHeadingPatterns: [],
      forbiddenTonePatterns: [],
      ctaMode: "방문 전 기준 정리 후 상담 유도",
      keywordUsagePolicy: {
        avoidSubKeywordStuffingInQuestions: true,
        preferContextualSubKeywordUse: true,
      },
    },
    articlePlan: {
      title: "부평 전자담배 추천",
      mainKeyword: "부평 전자담배 추천",
      subKeywords: ["부평 전자담배"],
      searchIntent: "부평에서 전자담배 추천 기준 확인",
      requiredEntities: [],
      lockedRequirements: [],
      requiredSections: ["추천 기준", "사용자 유형별 분기", "방문 전 상담 기준"],
      duplicateMode: "different_angle",
      planVersion: 1,
      updatedAt: "2026-06-04T00:00:00.000Z",
    },
    overlapReport: {
      riskLevel: "high",
      similarTitles: ["부평 전자담배 추천"],
      similarIntents: ["부평에서 전자담배 추천 기준 확인"],
      repeatedIntroPatterns: ["customer_question"],
      repeatedConclusionPatterns: ["visit_consultation"],
      repeatedInternalLinkTargets: [],
      repeatedCtaModes: ["방문 전 기준 정리 후 상담 유도"],
      roleConflicts: ["same articleRole + same target keyword"],
      recommendedRewriteDirection: "취향 기준과 사용자 유형 분기로 분리",
    },
    ...overrides,
  };
}

describe("PR13 force duplicate override", () => {
  test("기본 duplicate mode에서는 high overlap을 차단한다", () => {
    const result = evaluateStrategyQualityGate(makeStrategy());
    assert.equal(result.ok, false);
    assert.ok(result.blockingReasons.some((reason) => reason.includes("중복 위험")));
  });

  test("force_duplicate에서는 high overlap이 경고로만 남는다", () => {
    const result = evaluateStrategyQualityGate(
      makeStrategy({
        articlePlan: {
          ...makeStrategy().articlePlan,
          duplicateMode: "force_duplicate",
        },
      })
    );
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((warning) => warning.includes("중복 무시 작성 모드")));
  });

  test("final draft check도 force_duplicate에서는 overlap을 차단 대신 warning으로 내린다", () => {
    const strategy = makeStrategy({
      articlePlan: {
        ...makeStrategy().articlePlan,
        duplicateMode: "force_duplicate",
      },
    });
    const result = runFinalDraftCheck({
      title: strategy.title,
      strategy,
      content:
        "부평 전자담배 추천을 볼 때는 제품명부터 고르기보다 추천 기준과 사용자 유형을 먼저 나눠야 합니다. 요즘 뭐가 제일 잘 나가요? 같은 질문이 많지만, 실제로는 흡입감과 유지비, 관리 편의성을 같이 봐야 합니다. 방문 전에는 어떤 기준을 중요하게 생각하는지 정리해 두면 상담이 훨씬 빨라집니다.",
    });

    assert.equal(result.ok, true);
    assert.equal(result.blockingReasons.some((reason) => reason.includes("high overlap")), false);
    assert.ok(result.warnings.some((warning) => warning.includes("high overlap")));
  });
});
