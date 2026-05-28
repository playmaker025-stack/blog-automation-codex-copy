import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  canApproveFinalDraft,
  collectFinalDraftCheckMessages,
  getFinalDraftCheckApprovalStatus,
} from "../../lib/agents/final-draft-check.ts";

function makeCheck(overrides = {}) {
  return {
    ok: true,
    blockingReasons: [],
    warnings: [],
    matchedForbiddenPhrases: [],
    keywordStuffingFindings: [],
    deferFindings: [],
    contractCoverageFindings: [],
    overlapFindings: [],
    ...overrides,
  };
}

describe("PR7 final draft check visibility policy", () => {
  test("ok=false이면 approval 상태로 못 넘어간다", () => {
    const check = makeCheck({
      ok: false,
      blockingReasons: ["질문문 안 exact keyword 사용"],
    });

    assert.equal(getFinalDraftCheckApprovalStatus(check), "blocked");
    assert.equal(canApproveFinalDraft(check), false);
  });

  test("warning only이면 warning 표시 대상이지만 승인 가능하다", () => {
    const check = makeCheck({
      ok: true,
      warnings: ["mustResolve 단서 부족"],
      contractCoverageFindings: ["mustResolve 단서 부족: 관리 편의성"],
    });

    assert.equal(getFinalDraftCheckApprovalStatus(check), "warning");
    assert.equal(canApproveFinalDraft(check), true);
    assert.deepEqual(collectFinalDraftCheckMessages(check).warnings, ["mustResolve 단서 부족"]);
  });

  test("blockingReasons가 UI/API 응답에 포함될 수 있게 보존된다", () => {
    const check = makeCheck({
      ok: false,
      blockingReasons: ["금지 표현 감지: 선행포스팅"],
      matchedForbiddenPhrases: ["선행포스팅"],
      keywordStuffingFindings: ["질문문/따옴표 안 exact keyword 사용"],
      deferFindings: ["end_here 글에서 defer 표현 사용: 다음 글에서"],
      overlapFindings: ["high overlap: 기존 제목 유사 위험 1건"],
    });
    const apiResponse = {
      pass: false,
      finalDraftCheck: check,
      recommendations: collectFinalDraftCheckMessages(check).blockingReasons,
    };

    assert.equal(apiResponse.finalDraftCheck.blockingReasons[0], "금지 표현 감지: 선행포스팅");
    assert.deepEqual(collectFinalDraftCheckMessages(apiResponse.finalDraftCheck).matchedForbiddenPhrases, ["선행포스팅"]);
    assert.equal(canApproveFinalDraft(apiResponse.finalDraftCheck), false);
  });
});
