import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("strategy phase blocks high overlap before approval unless force_duplicate is selected", () => {
  const source = readFileSync("lib/agents/orchestrator.ts", "utf-8");

  assert.match(source, /duplicateBlocked/u);
  assert.match(source, /params\.duplicateModeOverride !== "force_duplicate"/u);
  assert.match(source, /전략 계약서가 불완전해 writer 실행을 차단합니다/u);
});
