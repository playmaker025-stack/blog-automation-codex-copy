import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const approvalDialogSource = readFileSync(
  path.join(ROOT, "components", "pipeline", "approval-dialog.tsx"),
  "utf8"
);
const pipelinePageSource = readFileSync(
  path.join(ROOT, "app", "pipeline", "page.tsx"),
  "utf8"
);

describe("PR 전략 수정 요청 가시성", () => {
  test("승인 다이얼로그는 사용자 수정 요청의 반영 상태를 별도 박스로 표시한다", () => {
    assert.match(approvalDialogSource, /사용자 수정 요청 반영됨/u);
    assert.match(approvalDialogSource, /사용자 수정 요청 반영 중/u);
    assert.match(approvalDialogSource, /사용자 수정 요청 반영 실패/u);
    assert.match(approvalDialogSource, /변경된 제목, 근거, 아웃라인을 다시 확인해 주세요/u);
  });

  test("승인 다이얼로그는 수정 요청 반영 후 제목과 수정 관련 근거를 강조한다", () => {
    assert.match(approvalDialogSource, /text-rose-700/u);
    assert.match(approvalDialogSource, /item\.includes\("수정"\)/u);
    assert.match(approvalDialogSource, /\/수정\|반영\|추천 이유\|추천 대상\//u);
  });

  test("파이프라인 페이지는 재전략 수립 요청의 submitting\/applied\/error 상태를 유지한다", () => {
    assert.match(pipelinePageSource, /const \[approvalModificationFeedback, setApprovalModificationFeedback\]/u);
    assert.match(pipelinePageSource, /status: "submitting"/u);
    assert.match(pipelinePageSource, /status: "applied"/u);
    assert.match(pipelinePageSource, /status: "error"/u);
    assert.match(pipelinePageSource, /modificationFeedback=\{approvalModificationFeedback\}/u);
  });
});
