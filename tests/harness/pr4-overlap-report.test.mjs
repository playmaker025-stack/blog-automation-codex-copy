import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildArticleContract, evaluateStrategyQualityGate } from "../../lib/agents/article-contract-utils.ts";
import { buildOverlapReport } from "../../lib/agents/overlap-report-utils.ts";
import { buildOpenAIWriterPayloadPreview } from "../../lib/agents/openai-writer-preview.ts";

function makeTopic(overrides = {}) {
  return {
    topicId: "topic-1",
    title: "기본 제목",
    description: "기본 설명",
    category: "전자담배",
    tags: [],
    feasibility: null,
    relatedSources: [],
    status: "draft",
    assignedUserId: "user-1",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  return {
    title: "기본 전략 제목",
    outline: [
      {
        heading: "도입",
        subPoints: ["질문", "상황"],
        contentDirection: "상황형 도입",
        estimatedParagraphs: 2,
      },
    ],
    keyPoints: ["핵심 포인트"],
    estimatedLength: 1700,
    tone: "friendly",
    keywords: ["기본 메인 키워드", "보조 키워드"],
    suggestedSources: [],
    rationale: "기본 전략 근거",
    keywordContract: {
      title: "기본 전략 제목",
      articleType: "leaf",
      articleStage: "info_summary",
      searchIntent: "기본 검색 의도",
      topology: "leaf",
      bodyRole: "기본 본문 역할",
      mainKeyword: "기본 메인 키워드",
      subKeywords: ["보조 키워드"],
      bridgeKeywords: [],
      internalLinkAnchors: [],
      forbiddenTerms: [],
      limitedKeywords: [
        { keyword: "기본 메인 키워드", min: 4, max: 7, role: "main" },
      ],
      excludedTopics: [],
      handoffTopics: [],
      differentiationPoints: ["기본 차별화 포인트"],
    },
    contentTopology: {
      kind: "leaf",
      reason: "현재 검색 의도 해결",
      searchIntent: "현재 검색 의도 해결",
      bodyPlacement: "직접 응답",
      requiredSections: ["질문", "기준", "마무리"],
      internalLinkTargets: [],
    },
    ...overrides,
  };
}

function existingArticle(overrides = {}) {
  return {
    title: "기존 글",
    normalizedTitle: "기존 글",
    userId: "a",
    articleRole: "general",
    targetKeyword: "기존 키워드",
    normalizedTargetKeyword: "기존 키워드",
    searchIntent: "기존 검색 의도",
    normalizedSearchIntent: "기존 검색 의도",
    internalLinkTargets: [],
    introPattern: null,
    conclusionPattern: null,
    topicId: "topic-old",
    postId: "post-old",
    ...overrides,
  };
}

describe("PR4 overlap report", () => {
  test("같은 main_recommendation 제목은 high risk로 차단된다", () => {
    const report = buildOverlapReport({
      currentTitle: "부평 전자담배 추천",
      articleRole: "main_recommendation",
      targetKeyword: "부평 전자담배 추천",
      searchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
      existingArticles: [
        existingArticle({
          title: "부평 전자담배 추천",
          normalizedTitle: "부평 전자담배 추천",
          articleRole: "main_recommendation",
          targetKeyword: "부평 전자담배 추천",
          normalizedTargetKeyword: "부평 전자담배 추천",
          searchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
          normalizedSearchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
        }),
      ],
    });

    const gate = evaluateStrategyQualityGate({
      articleContract: {
        articleRole: "main_recommendation",
        completionMode: "end_here",
        mainIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
        readerState: "추천 기준이 필요한 상태",
        readerQuestions: ["처음이면 어떤 기준부터 보면 될까요?"],
        mustResolve: ["추천 기준"],
        mustNotDefer: ["추천 기준"],
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
      overlapReport: report,
    });

    assert.equal(report.riskLevel, "high");
    assert.ok(report.similarTitles.includes("부평 전자담배 추천"));
    assert.equal(gate.ok, false);
    assert.match(gate.blockingReasons.join(" / "), /중복 위험이 높습니다/u);
  });

  test("기존 추천글과 신규 액상 추천글은 medium risk로 분리 방향을 권고한다", () => {
    const report = buildOverlapReport({
      currentTitle: "부평 전자담배 액상 추천",
      articleRole: "main_recommendation",
      targetKeyword: "부평 전자담배 액상 추천",
      searchIntent: "부평에서 전자담배 액상을 고를 때 취향과 기기 궁합 기준을 알고 싶음",
      existingArticles: [
        existingArticle({
          title: "부평 전자담배 추천",
          normalizedTitle: "부평 전자담배 추천",
          articleRole: "main_recommendation",
          targetKeyword: "부평 전자담배 추천",
          normalizedTargetKeyword: "부평 전자담배 추천",
          searchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
          normalizedSearchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
        }),
      ],
    });

    assert.equal(report.riskLevel, "medium");
    assert.match(report.recommendedRewriteDirection, /액상 취향/u);
    assert.match(report.recommendedRewriteDirection, /기기 궁합/u);
  });

  test("기존 추천글과 신규 problem_solution 글은 low risk다", () => {
    const report = buildOverlapReport({
      currentTitle: "발라리안 코일 빨리 타는 이유",
      articleRole: "problem_solution",
      targetKeyword: "발라리안 코일 빨리 타는 이유",
      searchIntent: "코일이 빨리 타는 원인과 점검 기준을 알고 싶음",
      existingArticles: [
        existingArticle({
          title: "부평 전자담배 추천",
          normalizedTitle: "부평 전자담배 추천",
          articleRole: "main_recommendation",
          targetKeyword: "부평 전자담배 추천",
          normalizedTargetKeyword: "부평 전자담배 추천",
          searchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
          normalizedSearchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
        }),
      ],
    });

    assert.equal(report.riskLevel, "low");
    assert.equal(report.roleConflicts.length, 0);
  });

  test("prelude는 handoffKeyword 대상 main 추천글을 과소비하지 말라는 권고를 받는다", () => {
    const report = buildOverlapReport({
      currentTitle: "부평 고유가 피해 지원금 사용처 전자담배 만수르",
      articleRole: "prelude",
      targetKeyword: "부평 고유가 피해 지원금",
      searchIntent: "지원금 사용처 확인 후 전자담배 매장 결제 가능 여부를 방문 전에 파악",
      handoffKeyword: "부평 입호흡 전자담배 추천",
      existingArticles: [
        existingArticle({
          title: "부평 입호흡 전자담배 추천",
          normalizedTitle: "부평 입호흡 전자담배 추천",
          articleRole: "main_recommendation",
          targetKeyword: "부평 입호흡 전자담배 추천",
          normalizedTargetKeyword: "부평 입호흡 전자담배 추천",
          searchIntent: "부평에서 입호흡 전자담배를 고를 때 추천 기준을 알고 싶음",
          normalizedSearchIntent: "부평에서 입호흡 전자담배를 고를 때 추천 기준을 알고 싶음",
        }),
      ],
    });

    assert.equal(report.riskLevel, "medium");
    assert.match(report.recommendedRewriteDirection, /브릿지 역할/u);
    assert.match(report.recommendedRewriteDirection, /handoffKeyword 대상 글/u);
  });

  test("writer prompt는 overlap report와 recommendedRewriteDirection을 함께 주입한다", () => {
    const topic = makeTopic({
      title: "부평 전자담배 액상 추천",
      description: "액상 취향과 기기 궁합 기준을 정리하는 추천 글",
    });
    const plan = makePlan({
      title: "부평 전자담배 액상 추천, 맛보다 먼저 봐야 할 기준",
      keywords: ["부평 전자담배 액상 추천", "부평 전자담배"],
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "main_recommendation",
        articleStage: "purchase_review",
        mainKeyword: "부평 전자담배 액상 추천",
        subKeywords: ["부평 전자담배"],
      },
    });

    const articleContract = buildArticleContract({ topic, plan });
    const overlapReport = buildOverlapReport({
      currentTitle: plan.title,
      articleRole: articleContract.articleRole,
      targetKeyword: plan.keywordContract.mainKeyword,
      searchIntent: articleContract.mainIntent,
      existingArticles: [
        existingArticle({
          title: "부평 전자담배 추천",
          normalizedTitle: "부평 전자담배 추천",
          articleRole: "main_recommendation",
          targetKeyword: "부평 전자담배 추천",
          normalizedTargetKeyword: "부평 전자담배 추천",
          searchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
          normalizedSearchIntent: "부평에서 전자담배를 고를 때 추천 기준을 알고 싶음",
        }),
      ],
    });
    const gate = evaluateStrategyQualityGate({ articleContract, overlapReport });
    const prompt = buildOpenAIWriterPayloadPreview({
      strategy: { ...plan, articleContract, overlapReport, strategyQualityGate: gate },
      userId: "mansour-test",
    }).input[1].content;

    assert.match(prompt, /Overlap report:/u);
    assert.match(prompt, /Recommended rewrite direction:/u);
    assert.match(prompt, /Avoid repeating the same title direction, intro pattern, conclusion pattern, or CTA/u);
  });
});
