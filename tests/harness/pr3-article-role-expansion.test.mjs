import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildArticleContract,
  evaluateStrategyQualityGate,
  inferArticleRole,
} from "../../lib/agents/article-contract-utils.ts";
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
      forbiddenTerms: ["키워드 계약서"],
      limitedKeywords: [
        { keyword: "기본 메인 키워드", min: 4, max: 7, role: "main" },
        { keyword: "보조 키워드", min: 1, max: 3, role: "sub" },
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

function buildPromptWithContract(topic, plan) {
  const contract = buildArticleContract({ topic, plan });
  const gate = evaluateStrategyQualityGate({ articleContract: contract });
  const prompt = buildOpenAIWriterPayloadPreview({
    strategy: { ...plan, articleContract: contract, strategyQualityGate: gate },
    userId: "mansour-test",
  }).input[1].content;

  return { contract, gate, prompt };
}

describe("PR3 article role expansion", () => {
  test("review 역할은 후기/체감/아쉬운 점 책임을 계약과 prompt에 반영한다", () => {
    const topic = makeTopic({
      title: "말론 전담 후기",
      description: "실사용 체감과 아쉬운 점을 함께 다루는 후기 글",
      tags: ["말론 전담 후기", "실사용", "리뷰"],
    });
    const plan = makePlan({
      title: "말론 전담 후기, 실제로 써보면 어떤지 정리",
      keywords: ["말론 전담 후기", "실사용 리뷰"],
      rationale: "후기와 실사용 체감을 찾는 검색 의도",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "review",
        mainKeyword: "말론 전담 후기",
        subKeywords: ["실사용 리뷰"],
      },
    });

    const { contract, gate, prompt } = buildPromptWithContract(topic, plan);

    assert.equal(inferArticleRole(topic, plan), "review");
    assert.equal(contract.articleRole, "review");
    assert.equal(contract.completionMode, "end_here");
    assert.ok(contract.mustResolve.includes("실제 체감 포인트"));
    assert.ok(contract.mustResolve.includes("장점과 아쉬운 점"));
    assert.ok(contract.mustResolve.includes("어떤 사용자에게 맞는지"));
    assert.ok(contract.mustResolve.includes("구매 전 확인할 점"));
    assert.ok(contract.mustNotDefer.includes("실제 체감 포인트"));
    assert.equal(gate.ok, true);
    assert.match(prompt, /Review articles must cover real usage feel, strengths, and drawbacks together/u);
    assert.match(prompt, /Do not write praise-only promotional copy/u);
  });

  test("comparison 역할은 단순 승패 대신 상황별 선택 기준을 계약과 prompt에 반영한다", () => {
    const topic = makeTopic({
      title: "입호흡 폐호흡 차이",
      description: "두 방식의 차이와 어떤 상황에서 맞는지 비교하는 글",
      tags: ["입호흡", "폐호흡", "차이"],
    });
    const plan = makePlan({
      title: "입호흡 폐호흡 차이, 어떤 상황에서 더 잘 맞을까",
      keywords: ["입호흡 폐호흡 차이", "입호흡", "폐호흡"],
      rationale: "입호흡과 폐호흡을 비교해 상황별 선택 기준을 찾는 검색 의도",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "comparison",
        mainKeyword: "입호흡 폐호흡 차이",
        subKeywords: ["입호흡", "폐호흡"],
      },
    });

    const { contract, gate, prompt } = buildPromptWithContract(topic, plan);

    assert.equal(inferArticleRole(topic, plan), "comparison");
    assert.equal(contract.articleRole, "comparison");
    assert.equal(contract.completionMode, "end_here");
    assert.ok(contract.mustResolve.includes("비교 대상별 차이"));
    assert.ok(contract.mustResolve.includes("선택 기준"));
    assert.ok(contract.mustResolve.includes("어떤 상황에서 A/B가 맞는지"));
    assert.ok(contract.mustResolve.includes("단순 승패가 아니라 사용자별 판단 기준"));
    assert.ok(contract.mustNotDefer.includes("핵심 차이와 선택 기준"));
    assert.equal(gate.ok, true);
    assert.match(prompt, /Comparison articles must organize differences and situation-based choice criteria/u);
    assert.match(prompt, /not a simple winner-loser ranking/u);
  });

  test("main_recommendation 역할은 추천 기준과 사용자 유형 분기를 계약과 prompt에 반영한다", () => {
    const topic = makeTopic({
      title: "부평 입호흡 전자담배 추천",
      description: "입문자와 기존 사용자를 나눠 추천 기준을 잡는 메인 추천 글",
      tags: ["부평 입호흡 전자담배 추천", "입문자 추천", "유지비"],
    });
    const plan = makePlan({
      title: "부평 입호흡 전자담배 추천, 처음 고를 때 기준부터 잡기",
      keywords: ["부평 입호흡 전자담배 추천", "부평 전자담배", "입호흡 전자담배"],
      rationale: "추천 제품명보다 먼저 추천 기준과 사용자 유형 분기를 찾는 검색 의도",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "main_recommendation",
        articleStage: "purchase_review",
        mainKeyword: "부평 입호흡 전자담배 추천",
        subKeywords: ["부평 전자담배", "입호흡 전자담배"],
      },
    });

    const { contract, gate, prompt } = buildPromptWithContract(topic, plan);

    assert.equal(inferArticleRole(topic, plan), "main_recommendation");
    assert.equal(contract.articleRole, "main_recommendation");
    assert.equal(contract.completionMode, "end_here");
    assert.ok(contract.mustResolve.includes("추천 기준"));
    assert.ok(contract.mustResolve.includes("사용자 유형별 분기"));
    assert.ok(contract.mustResolve.includes("입문자/기존 사용자 기준"));
    assert.ok(contract.mustResolve.includes("유지비/관리/사용감 기준"));
    assert.ok(contract.mustResolve.includes("방문 전 상담 기준"));
    assert.ok(contract.mustNotDefer.includes("입문자/기존 사용자 분기와 방문 전 상담 기준"));
    assert.equal(gate.ok, true);
    assert.match(prompt, /Main recommendation articles must explain recommendation criteria and user-type branches before listing product names/u);
    assert.match(prompt, /Separate beginner vs existing-user needs/u);
  });

  test("problem_solution 역할 회귀: 원인 그룹과 즉시 점검 기준을 유지한다", () => {
    const topic = makeTopic({
      title: "발라리안 코일 빨리 타는 이유",
      description: "탄맛과 교체주기가 너무 짧을 때 원인을 점검하는 문제해결형 글",
      tags: ["탄맛", "교체주기", "발라리안"],
    });
    const plan = makePlan({
      title: "발라리안 코일 빨리 타는 이유, 교체 전에 먼저 볼 것",
      keywords: ["발라리안 코일 빨리 타는 이유", "탄맛", "교체주기"],
      rationale: "탄맛과 코일 수명 문제를 해결하는 글",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "problem_solution",
        articleStage: "problem_solution",
        mainKeyword: "발라리안 코일 빨리 타는 이유",
        subKeywords: ["탄맛", "교체주기"],
      },
    });

    const { contract, gate, prompt } = buildPromptWithContract(topic, plan);

    assert.equal(inferArticleRole(topic, plan), "problem_solution");
    assert.equal(contract.articleRole, "problem_solution");
    assert.equal(contract.completionMode, "end_here");
    assert.ok(contract.mustResolve.includes("발라리안 코일 빨리 타는 이유의 원인 그룹"));
    assert.ok(contract.mustResolve.includes("즉시 점검 순서와 예방 기준"));
    assert.ok(contract.mustNotDefer.includes("지금 바로 확인할 점검 항목"));
    assert.equal(gate.ok, true);
    assert.match(prompt, /Problem-solution articles must explain the cause groups/u);
  });

  test("prelude 역할 회귀: handoff를 유지하면서 현재 확인 기준을 미루지 않는다", () => {
    const topic = makeTopic({
      title: "부평 고유가 피해 지원금 사용처 전자담배 만수르",
      description: "지원금 사용처와 결제 가능 여부를 먼저 확인하는 prelude 글",
      tags: ["부평 전자담배", "입호흡 전자담배 추천"],
      seriesRole: "prelude",
      targetMainKeyword: "입호흡 전자담배 추천",
    });
    const plan = makePlan({
      title: "부평 고유가 피해 지원금 사용처, 전자담배 매장 방문 전 확인할 점",
      keywords: ["부평 고유가 피해 지원금", "부평 전자담배", "입호흡 전자담배 추천"],
      rationale: "지원금 사용처 확인 후 다음 기기 선택으로 넘어가기 위한 브릿지 글",
      seriesRole: "prelude",
      targetMainKeyword: "입호흡 전자담배 추천",
      keywordContract: {
        ...makePlan().keywordContract,
        articleType: "warmup",
        articleStage: "pre_suasion",
        mainKeyword: "부평 고유가 피해 지원금",
        subKeywords: ["부평 전자담배"],
        bridgeKeywords: ["입호흡 전자담배 추천"],
      },
    });

    const { contract, gate, prompt } = buildPromptWithContract(topic, plan);

    assert.equal(inferArticleRole(topic, plan), "prelude");
    assert.equal(contract.articleRole, "prelude");
    assert.equal(contract.completionMode, "handoff");
    assert.equal(contract.handoffKeyword, "입호흡 전자담배 추천");
    assert.ok(contract.mustResolve.includes("매장 방문 전 결제/사용 가능 여부를 확인하는 방법"));
    assert.ok(contract.mustNotDefer.includes("방문 전 체크해야 할 핵심 판단 기준"));
    assert.equal(gate.ok, true);
    assert.match(prompt, /Prelude articles may hand off to the next article/u);
    assert.match(prompt, /Do not let this article consume the next article's main topic/u);
  });
});
