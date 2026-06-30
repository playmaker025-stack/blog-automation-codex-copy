import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("strategy phase blocks any failed strategy quality gate before approval", () => {
  const source = readFileSync("lib/agents/orchestrator.ts", "utf-8");
  const contractSource = readFileSync("lib/agents/article-contract-utils.ts", "utf-8");

  assert.match(source, /qualityGateBlocked/u);
  assert.match(source, /strategy\.strategyQualityGate && !strategy\.strategyQualityGate\.ok/u);
  assert.ok(source.includes('blockingReasons.join(" / ")'));

  // High duplicate risk is converted to a warning when the user explicitly forces it.
  assert.match(contractSource, /duplicateMode === "force_duplicate"/u);
  assert.match(contractSource, /warnings\.push/u);
  assert.doesNotMatch(source, /duplicateBlocked/u);
});
