import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { resolveTopicIntent } from "../../lib/agents/topic-intent-resolver.ts";
import { buildArticleContract, inferArticleRole } from "../../lib/agents/article-contract-utils.ts";
import { buildOpenAIWriterPayloadPreview } from "../../lib/agents/openai-writer-preview.ts";

function makeTopic(overrides = {}) {
  return {
    topicId: "topic-direct-1",
    title: "기본 제목",
    description: "기본 설명",
    category: "direct-run",
    tags: [],
    source: "direct",
    feasibility: null,
    relatedSources: [],
    status: "draft",
    assignedUserId: "user-a",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  return {
    title: "기본 전략 제목",
    outline: [
      {
        heading: "도입",
        subPoints: ["질문"],
        contentDirection: "문제 상황을 먼저 연결합니다.",
        estimatedParagraphs: 2,
      },
    ],
    keyPoints: ["핵심 기준"],
    estimatedLength: 1800,
    tone: "friendly",
    keywords: ["기본 메인 키워드", "보조 키워드"],
    suggestedSources: [],
    rationale: "기본 전략 근거",
    keywordContract: {
      title: "기본 전략 제목",
      articleType: "general_info",
      articleStage: "info_summary",
      searchIntent: "기본 정보형 의도",
      topology: "leaf",
      bodyRole: "기본 본문 역할",
      mainKeyword: "기본 메인 키워드",
      subKeywords: ["보조 키워드"],
      bridgeKeywords: [],
      internalLinkAnchors: [],
      forbiddenTerms: [],
      limitedKeywords: [
        { keyword: "기본 메인 키워드", min: 4, max: 7, role: "main" },
        { keyword: "보조 키워드", min: 1, max: 3, role: "sub" },
      ],
      excludedTopics: [],
      handoffTopics: [],
      differentiationPoints: ["기본 분리 포인트"],
      subKeywordRoles: [],
      productCandidates: [],
      comparisonTargets: [],
    },
    ...overrides,
  };
}

describe("PR10 TopicIntentResolver", () => {
  test("TOP/베스트/제품 후보 3개 이상이면 product_list_recommendation으로 판정한다", () => {
    const resolved = resolveTopicIntent({
      title: "커피머신 추천 TOP5",
      description: "집에서 쓰기 좋은 커피머신 추천 제품 정리",
      mainKeyword: "커피머신 추천",
      subKeywords: ["드롱기 마그니피카", "브레빌 바리스타 프로", "필립스 라떼고"],
    });

    assert.equal(resolved.intentType, "product_list_recommendation");
    assert.equal(resolved.articleType, "product_list_recommendation");
    assert.equal(resolved.articleStage, "purchase_review");
    assert.equal(resolved.isProductListRecommendation, true);
    assert.deepEqual(
      resolved.productCandidates,
      ["드롱기 마그니피카", "브레빌 바리스타 프로", "필립스 라떼고"]
    );
  });

  test("추천이지만 기준/선택 중심이면 criteria_recommendation으로 판정한다", () => {
    const resolved = resolveTopicIntent({
      title: "노트북 추천 전에 먼저 보는 선택 기준",
      description: "학생용과 직장인용을 나누기 전 판단 기준 정리",
      mainKeyword: "노트북 추천",
      subKeywords: ["학생용 노트북", "직장인 노트북"],
    });

    assert.equal(resolved.intentType, "criteria_recommendation");
    assert.equal(resolved.articleType, "main_recommendation");
  });

  test("비교/후기/문제해결/prelude/일반정보를 각각 구분한다", () => {
    assert.equal(
      resolveTopicIntent({
        title: "에어프라이어 vs 오븐 차이",
        mainKeyword: "에어프라이어 오븐 차이",
      }).intentType,
      "comparison"
    );
    assert.equal(
      resolveTopicIntent({
        title: "말론 전담 후기",
        mainKeyword: "말론 전담 후기",
      }).intentType,
      "review"
    );
    assert.equal(
      resolveTopicIntent({
        title: "발라리안 코일 빨리 타는 이유",
        mainKeyword: "발라리안 코일 빨리 타는 이유",
      }).intentType,
      "problem_solution"
    );
    assert.equal(
      resolveTopicIntent({
        title: "전자담배 처음 고르기 전 체크포인트",
        mainKeyword: "전자담배 고르는법",
        seriesRole: "prelude",
      }).intentType,
      "prelude"
    );
    assert.equal(
      resolveTopicIntent({
        title: "에스프레소 머신 구조 정리",
        mainKeyword: "에스프레소 머신 구조",
      }).intentType,
      "general_info"
    );
  });

  test("product_list_recommendation 계약과 writer 프롬프트는 제품별 섹션 구조를 강제한다", () => {
    const topic = makeTopic({
      title: "커피머신 추천 TOP5",
      description: "후보 제품을 각각 비교하는 direct input 주제",
    });
    const plan = makePlan({
      title: "커피머신 추천 TOP5, 사용자별로 보기 쉽게 정리",
      keywords: ["커피머신 추천", "드롱기 마그니피카", "브레빌 바리스타 프로"],
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "product_list_recommendation",
        articleStage: "purchase_review",
        mainKeyword: "커피머신 추천",
        subKeywords: ["드롱기 마그니피카", "브레빌 바리스타 프로", "필립스 라떼고"],
        productCandidates: ["드롱기 마그니피카", "브레빌 바리스타 프로", "필립스 라떼고"],
      },
    });

    const contract = buildArticleContract({ topic, plan });
    const prompt = buildOpenAIWriterPayloadPreview({
      strategy: { ...plan, articleContract: contract },
      userId: "user-a",
    }).input[1].content;

    assert.equal(inferArticleRole(topic, plan), "product_list_recommendation");
    assert.equal(contract.articleRole, "product_list_recommendation");
    assert.ok(contract.mustResolve.some((item) => item.includes("후보별 추천 이유")));
    assert.match(prompt, /Product list recommendation articles must dedicate one section per product or candidate/u);
    assert.match(prompt, /recommendation reason, the user it fits, and what to verify before purchase/u);
  });
});
