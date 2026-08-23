import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  runFinalDraftCheck,
  buildFinalDraftRevisionInstructions,
  formatFinalDraftRevisionSection,
  canApproveFinalDraft,
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

// 이전 동작(PR8): 금지어를 빈 문자열로 지우고, 걸린 소제목을 "## 확인 기준 정리"로 갈아끼우고,
// 누락 항목에 "## 추가 확인 기준" 템플릿 문단을 덧붙였다 → 모든 글에 같은 문장이 박혔다.
// 현재 동작: 감지만 하고 본문은 건드리지 않는다. 수정은 master-writer 재작성 라운드가 한다.
describe("발행 본문 자동 수정 제거 — 감지만 하고 본문은 보존한다", () => {
  test("금지 표현이 있어도 본문을 코드가 고치지 않는다", () => {
    const strategy = makeStrategy();
    const content = "이 글은 선행포스팅 흐름입니다. 꼭 확인하세요. 흡입감 기준과 관리 편의성을 정리합니다.";
    const check = runFinalDraftCheck({ title: "테스트", content, strategy });

    assert.equal(check.ok, false);
    assert.ok(check.matchedForbiddenPhrases.includes("선행포스팅"));
    assert.ok(check.matchedForbiddenPhrases.includes("꼭 확인하세요"));
    // 감지 후에도 원문은 그대로여야 한다 — 자동 삭제/치환이 없어야 한다.
    assert.ok(content.includes("선행포스팅"));
  });

  test("차단 사유는 재작성 지시문으로 변환된다", () => {
    const strategy = makeStrategy();
    const content = "이 글은 선행포스팅 흐름입니다. 흡입감 기준과 관리 편의성을 정리합니다.";
    const check = runFinalDraftCheck({ title: "테스트", content, strategy });
    const instructions = buildFinalDraftRevisionInstructions(check);

    assert.ok(instructions.length > 0);
    assert.ok(instructions.some((item) => item.includes("선행포스팅")));
    // 지시문은 "다시 쓰라"는 방향이어야 하고, 고정 대체 문구를 담아서는 안 된다.
    assert.ok(instructions.some((item) => item.includes("다시 쓰세요")));
    assert.equal(instructions.some((item) => item.includes("확인 기준 정리")), false);
    assert.equal(instructions.some((item) => item.includes("추가 확인 기준")), false);
  });

  test("end_here 글의 defer 문장은 답을 본문에 쓰라는 지시가 된다", () => {
    const strategy = makeStrategy();
    const content = "흡입감 기준과 관리 편의성을 정리했습니다. 다음 글에서 더 자세히 다루겠습니다.";
    const check = runFinalDraftCheck({ title: "테스트", content, strategy });
    const instructions = buildFinalDraftRevisionInstructions(check);

    assert.ok(check.deferFindings.length > 0);
    assert.ok(instructions.some((item) => item.includes("실제 답을 본문에 쓰세요")));
  });

  test("차단 초안은 승인 불가 상태를 유지한다", () => {
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
    const check = runFinalDraftCheck({ title: "테스트", content, strategy });

    assert.equal(check.ok, false);
    assert.equal(canApproveFinalDraft(check), false);
    assert.ok(check.blockingReasons.some((reason) => reason.includes("유웰 발라리안 맥스프로")));
  });

  test("차단 사유가 없으면 지시문 섹션은 비어 있다", () => {
    const strategy = makeStrategy();
    const content = "전자담배를 고르기 전에는 예산과 사용 시간을 먼저 생각하면 좋습니다. 흡입감 기준과 관리 편의성도 함께 봅니다.";
    const check = runFinalDraftCheck({ title: "테스트", content, strategy });

    assert.equal(check.blockingReasons.length, 0);
    assert.deepEqual(buildFinalDraftRevisionInstructions(check), []);
    assert.equal(formatFinalDraftRevisionSection(check), "");
  });
});
