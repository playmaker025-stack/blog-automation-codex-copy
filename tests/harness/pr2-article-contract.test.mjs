import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildArticleContract,
  evaluateStrategyQualityGate,
  findQuestionKeywordStuffingViolations,
  inferArticleRole,
  sanitizeReaderQuestions,
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
      reason: "현재 검색의도 해결",
      searchIntent: "현재 검색의도 해결",
      bodyPlacement: "직접 응답",
      requiredSections: ["질문", "기준", "마무리"],
      internalLinkTargets: [],
    },
    ...overrides,
  };
}

describe("PR2 ArticleContract", () => {
  test("일반 글 contract는 end_here와 mustResolve/mustNotDefer를 채운다", () => {
    const topic = makeTopic({
      title: "부평 전자담배 액상 고르는 기준",
      description: "부평에서 전자담배 액상을 고를 때 먼저 볼 기준을 정리하는 일반 글",
      tags: ["부평 전자담배", "전자담배 액상 기준"],
    });
    const plan = makePlan({
      title: "부평 전자담배 액상 고르는 기준, 방문 전에 먼저 볼 것",
      keywords: ["부평 전자담배 액상 기준", "부평 전자담배"],
      keywordContract: {
        ...makePlan().keywordContract,
        title: "부평 전자담배 액상 고르는 기준, 방문 전에 먼저 볼 것",
        mainKeyword: "부평 전자담배 액상 기준",
        subKeywords: ["부평 전자담배", "입호흡 전자담배 추천"],
        limitedKeywords: [
          { keyword: "부평 전자담배 액상 기준", min: 4, max: 7, role: "main" },
          { keyword: "부평 전자담배", min: 1, max: 3, role: "sub" },
          { keyword: "입호흡 전자담배 추천", min: 1, max: 3, role: "sub" },
        ],
      },
    });

    const contract = buildArticleContract({ topic, plan });
    const gate = evaluateStrategyQualityGate({ articleContract: contract });
    const prompt = buildOpenAIWriterPayloadPreview({
      strategy: { ...plan, articleContract: contract, strategyQualityGate: gate },
      userId: "mansour-test",
    }).input[1].content;

    assert.equal(contract.articleRole, "general");
    assert.equal(contract.completionMode, "end_here");
    assert.ok(contract.mustResolve.some((item) => item.includes("선택 기준")));
    assert.ok(contract.mustResolve.some((item) => item.includes("비교/상담 기준")));
    assert.ok(contract.mustNotDefer.length >= 2);
    assert.ok(contract.readerQuestions.every((question) => !question.includes("부평 전자담배 액상 기준")));
    assert.ok(contract.readerQuestions.every((question) => !question.includes("입호흡 전자담배 추천")));
    assert.equal(contract.keywordUsagePolicy.avoidSubKeywordStuffingInQuestions, true);
    assert.equal(gate.ok, true);
    assert.match(prompt, /Article contract:/u);
    assert.match(prompt, /Never place mainKeyword or subKeywords as exact phrases inside quoted customer questions/u);
    assert.match(prompt, /Customer questions must sound like real spoken customer questions/u);
  });

  test("prelude contract는 handoff를 가지되 현재 글의 확인 기준을 미루지 않는다", () => {
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
      seriesRole: "prelude",
      targetMainKeyword: "입호흡 전자담배 추천",
      keywordContract: {
        ...makePlan().keywordContract,
        title: "부평 고유가 피해 지원금 사용처, 전자담배 매장 방문 전 확인할 점",
        mainKeyword: "부평 고유가 피해 지원금",
        subKeywords: ["부평 전자담배"],
        bridgeKeywords: ["입호흡 전자담배 추천"],
        handoffTopics: ["입호흡 전자담배 추천"],
        limitedKeywords: [
          { keyword: "부평 고유가 피해 지원금", min: 2, max: 4, role: "main" },
          { keyword: "부평 전자담배", min: 1, max: 3, role: "sub" },
          { keyword: "입호흡 전자담배 추천", min: 1, max: 2, role: "bridge" },
        ],
      },
    });

    const contract = buildArticleContract({ topic, plan });
    const gate = evaluateStrategyQualityGate({ articleContract: contract });
    const prompt = buildOpenAIWriterPayloadPreview({
      strategy: { ...plan, articleContract: contract, strategyQualityGate: gate },
      userId: "mansour-test",
    }).input[1].content;

    assert.equal(contract.articleRole, "prelude");
    assert.equal(contract.completionMode, "handoff");
    assert.equal(contract.handoffKeyword, "입호흡 전자담배 추천");
    assert.ok(contract.mustResolve.some((item) => item.includes("확인 기준")));
    assert.ok(contract.mustNotDefer.length >= 1);
    assert.ok(contract.readerQuestions.every((question) => !question.includes("부평 고유가 피해 지원금")));
    assert.equal(gate.ok, true);
    assert.match(prompt, /Prelude articles may hand off to the next article/u);
    assert.match(prompt, /Do not defer these items to another post/u);
  });

  test("문제해결형 contract는 확장된 증상 키워드로 판정되고 질문이 증상형으로 정리된다", () => {
    const topic = makeTopic({
      title: "발라리안 코일 빨리 타는 이유",
      description: "탄맛과 코일 교체주기가 너무 짧을 때 보는 문제해결형 글",
      tags: ["탄맛", "교체주기", "발라리안"],
    });
    const plan = makePlan({
      title: "발라리안 코일 빨리 타는 이유, 교체 전에 먼저 볼 점",
      keywords: ["발라리안 코일 빨리 타는 이유", "탄맛", "교체주기"],
      rationale: "탄맛, 교체주기, 코일 수명 문제를 해결하는 글",
      keywordContract: {
        ...makePlan().keywordContract,
        title: "발라리안 코일 빨리 타는 이유, 교체 전에 먼저 볼 점",
        mainKeyword: "발라리안 코일 빨리 타는 이유",
        subKeywords: ["탄맛", "교체주기"],
        limitedKeywords: [
          { keyword: "발라리안 코일 빨리 타는 이유", min: 4, max: 7, role: "main" },
          { keyword: "탄맛", min: 1, max: 3, role: "sub" },
          { keyword: "교체주기", min: 1, max: 3, role: "sub" },
        ],
      },
    });

    const role = inferArticleRole(topic, plan);
    const contract = buildArticleContract({ topic, plan });
    const gate = evaluateStrategyQualityGate({ articleContract: contract });
    const prompt = buildOpenAIWriterPayloadPreview({
      strategy: { ...plan, articleContract: contract, strategyQualityGate: gate },
      userId: "mansour-test",
    }).input[1].content;

    assert.equal(role, "problem_solution");
    assert.equal(contract.articleRole, "problem_solution");
    assert.equal(contract.completionMode, "end_here");
    assert.ok(contract.mustResolve.some((item) => item.includes("원인 그룹")));
    assert.ok(contract.mustResolve.some((item) => item.includes("예방 기준")));
    assert.ok(contract.mustNotDefer.some((item) => item.includes("점검 항목")));
    assert.ok(contract.readerQuestions.includes("코일이 왜 이렇게 빨리 타죠?"));
    assert.ok(contract.readerQuestions.every((question) => !question.includes("발라리안 코일 빨리 타는 이유")));
    assert.equal(gate.ok, true);
    assert.match(prompt, /Problem-solution articles must explain the cause groups/u);
  });

  test("readerQuestions sanitize는 exact keyword 질문을 제거하고 fallback으로 채운다", () => {
    const result = sanitizeReaderQuestions({
      questions: [
        "부평 전자담배 액상 추천 기준으로 뭘 먼저 보면 되나요?",
        "입호흡 전자담배 추천 제품도 궁금한데요?",
      ],
      mainKeyword: "부평 전자담배 액상 추천",
      subKeywords: ["부평 전자담배", "입호흡 전자담배 추천"],
      keywordUsagePolicy: {
        avoidSubKeywordStuffingInQuestions: true,
        preferContextualSubKeywordUse: true,
      },
      articleRole: "general",
    });

    assert.ok(result.length >= 2);
    assert.ok(result.every((question) => !question.includes("부평 전자담배 액상 추천")));
    assert.ok(result.every((question) => !question.includes("입호흡 전자담배 추천")));
    assert.ok(result.some((question) => question.includes("요즘 뭐가 제일 잘 나가요?")));
  });

  test("질문문 경량 검사는 따옴표와 질문 섹션의 서브 키워드 exact phrase를 잡아낸다", () => {
    const violations = findQuestionKeywordStuffingViolations({
      content: [
        "## 요즘 손님들이 가장 많이 묻는 질문부터",
        "",
        "“입호흡 전자담배 추천 제품도 궁금한데요?”",
        "",
        "이 문단은 설명입니다.",
      ].join("\n"),
      subKeywords: ["입호흡 전자담배 추천"],
    });

    assert.ok(violations.length >= 1);
    assert.match(violations.join(" / "), /입호흡 전자담배 추천/u);
  });

  test("prelude에 handoffKeyword가 없으면 quality gate가 차단한다", () => {
    const contract = {
      articleRole: "prelude",
      completionMode: "handoff",
      mainIntent: "현재 글 기준 정리",
      readerState: "방문 전 확인이 필요한 상태",
      readerQuestions: ["방문 전에 어떤 걸 확인하면 되나요?"],
      mustResolve: ["현재 확인 기준"],
      mustNotDefer: ["방문 전 확인 기준"],
      handoffKeyword: null,
      forbiddenExactPhrases: ["한 번에 정리"],
      forbiddenHeadingPatterns: ["마무리 정리"],
      forbiddenTonePatterns: ["도움이 되었길 바랍니다"],
      ctaMode: "현재 글 기준 정리 후 handoff",
      keywordUsagePolicy: {
        avoidSubKeywordStuffingInQuestions: true,
        preferContextualSubKeywordUse: true,
      },
    };

    const gate = evaluateStrategyQualityGate({ articleContract: contract });
    assert.equal(gate.ok, false);
    assert.match(gate.blockingReasons.join(" / "), /handoffKeyword/u);
  });
});
