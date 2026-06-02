import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildConfirmedSeoKeywords } from "../../lib/agents/confirmed-seo-keywords.ts";
import { buildArticlePlan, patchArticlePlan } from "../../lib/agents/article-plan.ts";
import { evaluateSeoCompleteness } from "../../lib/agents/seo-metrics.ts";
import { runFinalDraftCheck } from "../../lib/agents/final-draft-check.ts";

function makeTopic(overrides = {}) {
  return {
    topicId: "topic-article-plan",
    title: "입호흡 전자담배 추천 베스트 5",
    description: "메인 키워드: 입호흡 전자담배 추천 / 서브 키워드: 입호흡, 부평",
    category: "direct-run",
    tags: ["입호흡 전자담배 추천", "입호흡", "부평"],
    targetKeyword: "입호흡 전자담배 추천",
    subKeywords: ["입호흡", "부평"],
    source: "direct",
    feasibility: null,
    relatedSources: [],
    status: "draft",
    assignedUserId: "user-a",
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeStrategy(overrides = {}) {
  return {
    title: "입호흡 전자담배 추천 베스트 5",
    outline: [],
    keyPoints: ["제품별 추천 이유", "추천 대상"],
    estimatedLength: 2200,
    tone: "friendly",
    keywords: ["입호흡 전자담배 추천", "입호흡", "부평"],
    suggestedSources: [],
    rationale: "제품 리스트형 추천글",
    keywordContract: {
      title: "입호흡 전자담배 추천 베스트 5",
      articleType: "product_list_recommendation",
      articleStage: "purchase_review",
      searchIntent: "구매검토형",
      topology: "hub",
      bodyRole: "제품별 추천 리스트형 본문",
      mainKeyword: "입호흡 전자담배 추천",
      subKeywords: ["입호흡", "부평", "비교"],
      bridgeKeywords: [],
      internalLinkAnchors: [],
      forbiddenTerms: ["선행포스팅", "키워드빌드업"],
      limitedKeywords: [
        { keyword: "입호흡 전자담배 추천", min: 4, max: 7, role: "main" },
        { keyword: "입호흡", min: 1, max: 3, role: "sub" },
        { keyword: "부평", min: 1, max: 3, role: "sub" },
      ],
      excludedTopics: [],
      handoffTopics: [],
      differentiationPoints: [],
      productCandidates: ["유웰 발라리안 맥스프로", "베놈 아스트로 MK3", "말론"],
      comparisonTargets: [],
    },
    articleContract: {
      articleRole: "product_list_recommendation",
      completionMode: "end_here",
      nodeType: "hub",
      introPattern: "customer_question",
      conclusionPattern: "product_fit_summary",
      mainIntent: "제품별 추천",
      readerState: "입문 또는 교체 필요",
      readerQuestions: ["어떤 제품이 맞는가"],
      mustResolve: ["제품별 추천 이유", "추천 대상"],
      mustNotDefer: ["제품별 추천"],
      handoffKeyword: null,
      forbiddenExactPhrases: [],
      forbiddenHeadingPatterns: [],
      forbiddenTonePatterns: [],
      ctaMode: "guide_to_next_step",
      keywordUsagePolicy: {
        avoidSubKeywordStuffingInQuestions: true,
        preferContextualSubKeywordUse: true,
      },
    },
    ...overrides,
  };
}

describe("PR12 article plan and keyword qc", () => {
  test("확정 SEO 키워드는 일반 반복어와 제목형 문장을 제외한다", () => {
    const confirmed = buildConfirmedSeoKeywords({
      keywordContract: {
        mainKeyword: "입호흡 전자담배 추천",
        subKeywords: ["입호흡", "부평", "비교", "초보자가 시작 전에 자주 놓치는 체크포인트"],
      },
    });

    assert.equal(confirmed.mainKeyword, "입호흡 전자담배 추천");
    assert.deepEqual(confirmed.subKeywords, ["입호흡", "부평"]);
    assert.ok(confirmed.rejectedCandidates.some((item) => item.value === "비교"));
    assert.ok(confirmed.rejectedCandidates.some((item) => item.value.includes("체크포인트")));
  });

  test("ArticlePlan은 제품 리스트형 요구사항과 필수 섹션을 고정한다", () => {
    const topic = makeTopic();
    const strategy = makeStrategy();
    const articlePlan = buildArticlePlan({
      topic,
      plan: strategy,
      topicIntentResolution: {
        intentType: "product_list_recommendation",
        articleType: "product_list_recommendation",
        articleStage: "purchase_review",
        searchIntent: "구매검토형",
        reason: "제품 후보 3개 이상",
        isProductListRecommendation: true,
        productCandidates: ["유웰 발라리안 맥스프로", "베놈 아스트로 MK3", "말론"],
        comparisonTargets: [],
        keywordAssignments: [],
      },
    });

    assert.equal(articlePlan.mainKeyword, "입호흡 전자담배 추천");
    assert.deepEqual(articlePlan.requiredEntities, ["유웰 발라리안 맥스프로", "베놈 아스트로 MK3", "말론"]);
    assert.ok(articlePlan.lockedRequirements.some((item) => item.includes("모두 포함")));
    assert.ok(articlePlan.requiredSections.some((item) => item.includes("유웰 발라리안 맥스프로 추천 이유와 추천 대상")));
  });

  test("본문 키워드 카운트는 줄바꿈과 해시태그를 정규화한다", () => {
    const seo = evaluateSeoCompleteness({
      title: "입호흡 전자담배 추천 베스트 5",
      body: [
        "입호흡",
        "전자담배 추천을 처음 고를 때 기준을 먼저 잡아야 합니다.",
        "",
        "URL https://example.com/sample 은 집계에서 제외됩니다.",
        "",
        "#입호흡전자담배추천",
        "#전자담배추천",
      ].join("\n"),
      keywordContract: makeStrategy().keywordContract,
      confirmedSeoKeywords: {
        mainKeyword: "입호흡 전자담배 추천",
        subKeywords: ["입호흡", "부평"],
        source: "keywordContract",
        rejectedCandidates: [],
      },
    });

    const mainItem = seo.keywordReport.seoKeywordItems.find((item) => item.keyword === "입호흡 전자담배 추천");
    assert.ok(mainItem);
    assert.equal(mainItem.exactCount, 1);
  });

  test("최종 검수는 필수 제품명과 추천 이유/대상 누락을 차단한다", () => {
    const strategy = makeStrategy();
    strategy.articlePlan = buildArticlePlan({
      topic: makeTopic(),
      plan: strategy,
      topicIntentResolution: {
        intentType: "product_list_recommendation",
        articleType: "product_list_recommendation",
        articleStage: "purchase_review",
        searchIntent: "구매검토형",
        reason: "제품 후보 3개 이상",
        isProductListRecommendation: true,
        productCandidates: ["유웰 발라리안 맥스프로", "베놈 아스트로 MK3", "말론"],
        comparisonTargets: [],
        keywordAssignments: [],
      },
    });

    const check = runFinalDraftCheck({
      title: strategy.title,
      content: "입호흡 전자담배 추천 기준만 먼저 정리합니다. 제품명은 아직 다루지 않습니다.",
      strategy,
    });

    assert.equal(check.ok, false);
    assert.ok(check.blockingReasons.some((item) => item.includes("필수 포함 요소 누락")));
  });

  test("사용자 수정사항을 패치하면 planVersion을 올리고 필수 제품을 잠근다", () => {
    const strategy = makeStrategy();
    const initialPlan = buildArticlePlan({
      topic: makeTopic(),
      plan: strategy,
      topicIntentResolution: {
        intentType: "product_list_recommendation",
        articleType: "product_list_recommendation",
        articleStage: "purchase_review",
        searchIntent: "구매검토형",
        reason: "제품 후보 3개 이상",
        isProductListRecommendation: true,
        productCandidates: ["유웰 발라리안 맥스프로", "베놈 아스트로 MK3"],
        comparisonTargets: [],
        keywordAssignments: [],
      },
    });

    const patched = patchArticlePlan(initialPlan, {
      modifications: [
        "본문에 추천 기기 5개를 모두 포함한다.",
        "유웰 발라리안 맥스프로",
        "베놈 아스트로 MK3",
        "포켓코리아 아어미니",
        "말론",
        "수파X",
        "각 기기마다 추천 이유를 작성한다.",
        "각 기기마다 추천 대상을 작성한다.",
      ].join("\n"),
      fallbackRequiredEntities: ["포켓코리아 아어미니", "말론", "수파X"],
    });

    assert.ok(patched);
    assert.equal(patched.planVersion, 2);
    assert.deepEqual([...patched.requiredEntities].sort((a, b) => a.localeCompare(b, "ko")), [
      "말론",
      "베놈 아스트로 MK3",
      "수파X",
      "유웰 발라리안 맥스프로",
      "포켓코리아 아어미니",
    ].sort((a, b) => a.localeCompare(b, "ko")));
    assert.ok(patched.lockedRequirements.some((item) => item.includes("추천 이유")));
  });
});
