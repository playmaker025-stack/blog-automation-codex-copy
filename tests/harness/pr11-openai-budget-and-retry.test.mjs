import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOpenAIWriterPayloadPreview,
  buildOpenAIWriterRevisionPrompt,
} from "../../lib/agents/openai-writer-preview.ts";
import {
  formatOpenAIRateLimitUserMessage,
  parseRateLimitDelayMs,
} from "../../lib/openai/responses.ts";
import { shouldAttemptWriterRevision } from "../../lib/agents/writer-revision-policy.ts";

function makeStrategy(overrides = {}) {
  return {
    title: "입호흡 전자담배 추천 전에 먼저 보는 기준",
    outline: [
      {
        heading: "도입",
        subPoints: ["상황", "질문"],
        contentDirection: "독자가 왜 이 글을 읽는지 먼저 잡는다.",
        estimatedParagraphs: 2,
      },
      {
        heading: "비교 기준",
        subPoints: ["목넘김", "흡입감", "유지비"],
        contentDirection: "선택 기준을 현실적으로 정리한다.",
        estimatedParagraphs: 3,
      },
    ],
    keyPoints: ["입호흡", "기준", "유지비", "초보자", "선택"],
    estimatedLength: 2200,
    tone: "friendly",
    keywords: ["입호흡 전자담배", "전자담배 초보자", "부평 전자담배"],
    suggestedSources: ["네이버 카페", "지식인"],
    rationale: "초보자 기준에서 실제 비교 포인트를 먼저 정리한다.",
    keywordContract: {
      title: "입호흡 전자담배 추천 전에 먼저 보는 기준",
      articleType: "main_recommendation",
      articleStage: "purchase_review",
      searchIntent: "입문자 기준에서 추천 전에 비교 기준을 먼저 알고 싶은 의도",
      topology: "hub",
      bodyRole: "추천글 전에 비교 기준을 먼저 정리하는 허브형 본문",
      mainKeyword: "입호흡 전자담배",
      subKeywords: ["전자담배 초보자", "부평 전자담배"],
      bridgeKeywords: ["입호흡 전자담배 추천"],
      internalLinkAnchors: ["입호흡 전자담배 추천"],
      forbiddenTerms: ["선행포스팅", "SEO 점수"],
      limitedKeywords: [
        { keyword: "입호흡 전자담배", min: 4, max: 7, role: "main" },
        { keyword: "전자담배 초보자", min: 1, max: 3, role: "sub" },
      ],
      excludedTopics: ["제품 TOP5 나열"],
      handoffTopics: ["입호흡 전자담배 추천 본편"],
      differentiationPoints: ["추천 후보 나열보다 기준 설명에 집중"],
      subKeywordRoles: [],
      productCandidates: [],
      comparisonTargets: [],
    },
    articleContract: {
      articleRole: "main_recommendation",
      completionMode: "end_here",
      nodeType: "hub",
      introPattern: "question_first",
      conclusionPattern: "summary_then_next_step",
      mainIntent: "추천 전에 비교 기준을 정리해 선택 실패를 줄인다.",
      readerState: "추천 글은 많이 봤지만 기준이 없어 헷갈리는 상태",
      readerQuestions: ["뭘 먼저 비교해야 하나요?", "입문자는 무엇부터 봐야 하나요?"],
      mustResolve: ["비교 기준 3가지", "입문자 체크포인트", "유지비 판단 기준"],
      mustNotDefer: ["현재 글 안에서 비교 기준 정리", "추천 전에 필요한 기준 설명"],
      ctaMode: "guide_to_next_step",
      handoffKeyword: "입호흡 전자담배 추천",
      keywordUsagePolicy: {
        mainKeywordMin: 4,
        mainKeywordMax: 7,
        subKeywordMin: 1,
        subKeywordMax: 3,
        bridgeKeywordMax: 2,
        avoidSubKeywordStuffingInQuestions: true,
        preferContextualSubKeywordUse: true,
      },
      forbiddenExactPhrases: ["선행포스팅"],
      forbiddenHeadingPatterns: ["체크포인트"],
      forbiddenTonePatterns: ["무조건"],
    },
    topicIntentResolution: {
      intentType: "criteria_recommendation",
      articleType: "main_recommendation",
      articleStage: "purchase_review",
      searchIntent: "입문자 기준에서 추천 전에 비교 기준을 먼저 알고 싶은 의도",
      reason: "추천 전에 비교 기준을 정리하는 주제",
      isProductListRecommendation: false,
      productCandidates: [],
      comparisonTargets: [],
      keywordAssignments: [],
    },
    ...overrides,
  };
}

function makeCorpusSummary(multiplier = 1) {
  const longExcerpt = "실사용 기준과 상담 흐름을 자연스럽게 설명합니다. ".repeat(200 * multiplier);
  return {
    styleProfile: {
      dominantTone: "실용형 상담 문체",
      avgWordCount: 1800,
      openingPattern: "질문형 도입",
      structurePattern: "기준 정리 후 사례 설명",
      signatureExpressions: ["실제로 많이 묻는 부분", "먼저 봐야 하는 기준"],
    },
    exemplarExcerpts: [
      {
        title: "기준 정리 예시",
        styleNotes: "상담형 설명",
        excerpt: longExcerpt,
      },
    ],
    representativeExcerpts: [longExcerpt, longExcerpt],
  };
}

describe("PR11 OpenAI budget and retry guards", () => {
  test("큰 writer 입력은 compact mode로 전환된다", () => {
    const payload = buildOpenAIWriterPayloadPreview({
      strategy: makeStrategy(),
      userId: "user-a",
      corpusSummary: makeCorpusSummary(3),
      harnessBriefing: "반복 표현을 줄이고 질문형 도입을 유지하세요. ".repeat(80),
    });

    assert.equal(payload.compactMode, true);
    assert.match(payload.input[1].content, /Compact mode is active because the writer prompt exceeded the token budget/u);
    assert.doesNotMatch(payload.input[1].content, /Corpus\/style reference:/u);
    assert.ok(payload.estimatedInputTokens > 0);
  });

  test("revision prompt에는 전체 strategy/corpus/overlap 전문이 들어가지 않는다", () => {
    const prompt = buildOpenAIWriterRevisionPrompt({
      strategy: makeStrategy(),
      userId: "user-a",
      firstDraft: "초안 본문",
      harnessBriefing: "질문형 도입 유지",
      revisionInstructions: "메인 키워드 반복을 줄이고 결론을 더 직접적으로 정리하세요.",
    });

    assert.match(prompt, /Draft to revise:/u);
    assert.match(prompt, /Failed evaluator instructions:/u);
    assert.doesNotMatch(prompt, /Corpus\/style reference:/u);
    assert.doesNotMatch(prompt, /Expanded outline:/u);
    assert.doesNotMatch(prompt, /Target search combinations:/u);
  });

  test("429 응답 문구에서 retry delay를 반영한다", () => {
    const errorText = 'Rate limit reached for gpt-4.1. Please try again in 14.85s.';
    assert.equal(parseRateLimitDelayMs(errorText, null, 0), 15350);
    assert.equal(
      formatOpenAIRateLimitUserMessage(errorText, null),
      "AI 요청량 제한에 걸렸습니다. 약 15초 후 다시 시도해 주세요."
    );
  });

  test("1차 통과 시 2차/3차 자동 보강을 생략한다", () => {
    const evalResult = {
      pass: true,
      aggregateScore: 78,
      seoEvaluation: {
        score: 78,
        keywordReport: { items: [], overallRisk: "low", paragraphWarnings: [] },
      },
      naverLogicEvaluation: { completenessScore: 76 },
    };
    const writerResult = {
      finalDraftCheck: { blockingReasons: [] },
    };

    assert.equal(shouldAttemptWriterRevision(evalResult, writerResult), false);
  });

  test("차단 사유가 남아 있으면 2차 보강 대상이 된다", () => {
    const evalResult = {
      pass: true,
      aggregateScore: 78,
      seoEvaluation: {
        score: 78,
        keywordReport: { items: [], overallRisk: "low", paragraphWarnings: [] },
      },
      naverLogicEvaluation: { completenessScore: 76 },
    };
    const writerResult = {
      finalDraftCheck: { blockingReasons: ["금지 표현 감지"] },
    };

    assert.equal(shouldAttemptWriterRevision(evalResult, writerResult), true);
  });
});
