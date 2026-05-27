import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildArticleContract, evaluateStrategyQualityGate } from "../../lib/agents/article-contract-utils.ts";
import { buildOverlapReport } from "../../lib/agents/overlap-report-utils.ts";

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
    title: "기본 초안 제목",
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
      title: "기본 초안 제목",
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
      limitedKeywords: [{ keyword: "기본 메인 키워드", min: 4, max: 7, role: "main" }],
      excludedTopics: [],
      handoffTopics: [],
      differentiationPoints: ["기본 차별화 포인트"],
    },
    contentTopology: {
      kind: "leaf",
      reason: "현재 검색 의도 완결",
      searchIntent: "현재 검색 의도 완결",
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
    nodeType: "leaf",
    targetKeyword: "기존 키워드",
    normalizedTargetKeyword: "기존 키워드",
    searchIntent: "기존 검색 의도",
    normalizedSearchIntent: "기존 검색 의도",
    internalLinkTargets: [],
    introPattern: "customer_question",
    conclusionPattern: "criteria_summary",
    ctaMode: "현재 글 기준을 정리한 뒤 방문 전 상담이나 선택 판단으로 연결",
    topicId: "topic-old",
    postId: "post-old",
    ...overrides,
  };
}

describe("PR5 overlap heuristics", () => {
  test("같은 지역 main_recommendation hub 반복은 medium 이상으로 오른다", () => {
    const topic = makeTopic({
      title: "부평 전자담배 추천",
      description: "부평 지역 메인 추천 허브 글",
      contentKind: "hub",
    });
    const plan = makePlan({
      title: "부평 전자담배 추천, 처음 고를 때 먼저 볼 기준",
      keywords: ["부평 전자담배 추천", "부평 전자담배"],
      rationale: "지역 메인 추천 허브",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "main_recommendation",
        articleStage: "purchase_review",
        topology: "hub",
        mainKeyword: "부평 전자담배 추천",
        subKeywords: ["부평 전자담배"],
      },
      contentTopology: {
        ...makePlan().contentTopology,
        kind: "hub",
      },
    });
    const contract = buildArticleContract({ topic, plan });
    const report = buildOverlapReport({
      currentTitle: plan.title,
      articleRole: contract.articleRole,
      nodeType: contract.nodeType,
      introPattern: contract.introPattern,
      conclusionPattern: contract.conclusionPattern,
      ctaMode: contract.ctaMode,
      targetKeyword: plan.keywordContract.mainKeyword,
      searchIntent: contract.mainIntent,
      existingArticles: [
        existingArticle({
          title: "부평 전자담배 추천",
          normalizedTitle: "부평 전자담배 추천",
          articleRole: "main_recommendation",
          nodeType: "hub",
          targetKeyword: "부평 전자담배 추천",
          normalizedTargetKeyword: "부평 전자담배 추천",
          searchIntent: contract.mainIntent,
          normalizedSearchIntent: contract.mainIntent.toLowerCase(),
          introPattern: contract.introPattern,
          conclusionPattern: contract.conclusionPattern,
          ctaMode: contract.ctaMode,
        }),
      ],
    });

    assert.equal(contract.nodeType, "hub");
    assert.ok(["medium", "high"].includes(report.riskLevel));
  });

  test("기존 hub가 있고 신규 problem_solution leaf면 low로 두고 hub 연결 방향을 권고한다", () => {
    const topic = makeTopic({
      title: "발라리안 코일 빨리 타는 이유",
      description: "코일이 빨리 타는 원인과 점검 기준",
      contentKind: "leaf",
    });
    const plan = makePlan({
      title: "발라리안 코일 빨리 타는 이유, 교체 전에 먼저 볼 기준",
      keywords: ["발라리안 코일 빨리 타는 이유", "부평 전자담배"],
      rationale: "문제 해결형 리프 글",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "problem_solution",
        articleStage: "problem_solution",
        mainKeyword: "발라리안 코일 빨리 타는 이유",
        subKeywords: ["부평 전자담배"],
      },
      contentTopology: {
        ...makePlan().contentTopology,
        kind: "leaf",
      },
    });
    const contract = buildArticleContract({ topic, plan });
    const report = buildOverlapReport({
      currentTitle: plan.title,
      articleRole: contract.articleRole,
      nodeType: contract.nodeType,
      introPattern: contract.introPattern,
      conclusionPattern: contract.conclusionPattern,
      ctaMode: contract.ctaMode,
      targetKeyword: plan.keywordContract.mainKeyword,
      searchIntent: contract.mainIntent,
      existingArticles: [
        existingArticle({
          title: "부평 전자담배 추천",
          normalizedTitle: "부평 전자담배 추천",
          articleRole: "main_recommendation",
          nodeType: "hub",
          targetKeyword: "부평 전자담배 추천",
          normalizedTargetKeyword: "부평 전자담배 추천",
          searchIntent: "부평에서 전자담배를 고르려는 사람이 추천 기준을 알고 싶어 함",
          normalizedSearchIntent: "부평에서 전자담배를 고르려는 사람이 추천 기준을 알고 싶어 함",
        }),
      ],
    });

    assert.equal(contract.nodeType, "leaf");
    assert.equal(report.riskLevel, "low");
    assert.match(report.recommendedRewriteDirection, /leaf/u);
    assert.match(report.recommendedRewriteDirection, /hub/u);
  });

  test("prelude bridge가 handoff 대상 main_recommendation 내용을 과소비하면 medium 경고를 만든다", () => {
    const topic = makeTopic({
      title: "부평 고유가 피해 지원금 사용처 전자담배 만수르",
      description: "지원금 사용처와 결제 가능 여부를 먼저 확인하는 브릿지 글",
      seriesRole: "prelude",
      targetMainKeyword: "부평 입호흡 전자담배 추천",
      contentKind: "leaf",
    });
    const plan = makePlan({
      title: "부평 고유가 피해 지원금 사용처, 전자담배 매장 방문 전 확인 기준",
      keywords: ["부평 고유가 피해 지원금", "부평 전자담배"],
      rationale: "지원금 사용처 확인 후 메인 추천 글로 넘기는 브릿지",
      seriesRole: "prelude",
      targetMainKeyword: "부평 입호흡 전자담배 추천",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "warmup",
        articleStage: "pre_suasion",
        mainKeyword: "부평 고유가 피해 지원금",
        subKeywords: ["부평 전자담배"],
        bridgeKeywords: ["부평 입호흡 전자담배 추천"],
      },
      contentTopology: {
        ...makePlan().contentTopology,
        kind: "leaf",
      },
    });
    const contract = buildArticleContract({ topic, plan });
    const report = buildOverlapReport({
      currentTitle: plan.title,
      articleRole: contract.articleRole,
      nodeType: contract.nodeType,
      introPattern: contract.introPattern,
      conclusionPattern: contract.conclusionPattern,
      ctaMode: contract.ctaMode,
      targetKeyword: plan.keywordContract.mainKeyword,
      searchIntent: contract.mainIntent,
      handoffKeyword: contract.handoffKeyword,
      existingArticles: [
        existingArticle({
          title: "부평 입호흡 전자담배 추천",
          normalizedTitle: "부평 입호흡 전자담배 추천",
          articleRole: "main_recommendation",
          nodeType: "hub",
          targetKeyword: "부평 입호흡 전자담배 추천",
          normalizedTargetKeyword: "부평 입호흡 전자담배 추천",
          searchIntent: "부평에서 입호흡 전자담배를 고르려는 사람이 추천 기준을 알고 싶어 함",
          normalizedSearchIntent: "부평에서 입호흡 전자담배를 고르려는 사람이 추천 기준을 알고 싶어 함",
        }),
      ],
    });

    assert.equal(contract.nodeType, "bridge");
    assert.equal(report.riskLevel, "medium");
    assert.match(report.recommendedRewriteDirection, /bridge/u);
    assert.match(report.recommendedRewriteDirection, /handoff/u);
  });

  test("같은 introPattern과 conclusionPattern 반복은 risk를 올린다", () => {
    const topic = makeTopic({
      title: "부평 전자담배 액상 추천",
      description: "액상 추천 기준과 방문 전 상담 기준",
      contentKind: "hub",
    });
    const plan = makePlan({
      title: "부평 전자담배 액상 추천, 맛보다 먼저 봐야 할 기준",
      keywords: ["부평 전자담배 액상 추천", "부평 전자담배"],
      rationale: "질문형 도입과 상담형 마무리",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "main_recommendation",
        articleStage: "purchase_review",
        topology: "hub",
        mainKeyword: "부평 전자담배 액상 추천",
        subKeywords: ["부평 전자담배"],
      },
      contentTopology: {
        ...makePlan().contentTopology,
        kind: "hub",
      },
    });
    const contract = buildArticleContract({ topic, plan });
    const report = buildOverlapReport({
      currentTitle: plan.title,
      articleRole: contract.articleRole,
      nodeType: contract.nodeType,
      introPattern: contract.introPattern,
      conclusionPattern: contract.conclusionPattern,
      ctaMode: contract.ctaMode,
      targetKeyword: plan.keywordContract.mainKeyword,
      searchIntent: contract.mainIntent,
      existingArticles: [
        existingArticle({
          title: "부평 전자담배 추천 기준",
          normalizedTitle: "부평 전자담배 추천 기준",
          articleRole: "main_recommendation",
          nodeType: "hub",
          targetKeyword: "부평 전자담배 추천",
          normalizedTargetKeyword: "부평 전자담배 추천",
          searchIntent: "부평에서 전자담배를 고르려는 사람이 기준을 알고 싶어 함",
          normalizedSearchIntent: "부평에서 전자담배를 고르려는 사람이 기준을 알고 싶어 함",
          introPattern: contract.introPattern,
          conclusionPattern: contract.conclusionPattern,
          ctaMode: contract.ctaMode,
        }),
      ],
    });

    assert.ok(["medium", "high"].includes(report.riskLevel));
    assert.ok(report.repeatedIntroPatterns.includes(contract.introPattern));
    assert.ok(report.repeatedConclusionPatterns.includes(contract.conclusionPattern));
  });

  test("같은 내부링크 대상 반복은 warning으로 남긴다", () => {
    const topic = makeTopic({
      title: "부평 전자담배 액상 추천",
      description: "액상 선택 기준",
      contentKind: "leaf",
    });
    const plan = makePlan({
      title: "부평 전자담배 액상 추천, 기기 궁합부터 보는 이유",
      keywords: ["부평 전자담배 액상 추천", "부평 전자담배"],
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "general",
        mainKeyword: "부평 전자담배 액상 추천",
        subKeywords: ["부평 전자담배"],
      },
      contentTopology: {
        ...makePlan().contentTopology,
        kind: "leaf",
        internalLinkTargets: [
          {
            title: "부평 전자담배 추천",
            role: "hub",
            reason: "지역 허브",
            url: null,
          },
        ],
      },
    });
    const contract = buildArticleContract({ topic, plan });
    const report = buildOverlapReport({
      currentTitle: plan.title,
      articleRole: contract.articleRole,
      nodeType: contract.nodeType,
      introPattern: contract.introPattern,
      conclusionPattern: contract.conclusionPattern,
      ctaMode: contract.ctaMode,
      targetKeyword: plan.keywordContract.mainKeyword,
      searchIntent: contract.mainIntent,
      internalLinkTargets: ["부평 전자담배 추천"],
      existingArticles: [
        existingArticle({
          title: "부평 전자담배 추천",
          normalizedTitle: "부평 전자담배 추천",
          articleRole: "main_recommendation",
          nodeType: "hub",
          internalLinkTargets: ["부평 전자담배 추천"],
        }),
      ],
    });
    const gate = evaluateStrategyQualityGate({ articleContract: contract, overlapReport: report });

    assert.ok(report.repeatedInternalLinkTargets.includes("부평 전자담배 추천"));
    assert.ok(gate.warnings.some((warning) => /내부링크 대상 반복 주의/u.test(warning)));
  });
});
