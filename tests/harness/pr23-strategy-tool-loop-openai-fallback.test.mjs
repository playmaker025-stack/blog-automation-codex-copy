import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const strategyPlannerSource = readFileSync(
  path.join(ROOT, "lib", "agents", "strategy-planner.ts"),
  "utf8"
).replace(/\r\n/gu, "\n");

describe("PR23 strategy tool-loop fallback recovery", () => {
  test("tool-use 루프/파싱 실패는 OpenAI 키가 있으면 local_fallback 차단 전에 전략 폴백을 시도한다", () => {
    assert.match(strategyPlannerSource, /else if \(hasOpenAIKey\(\)\) \{/u);
    assert.match(strategyPlannerSource, /Anthropic 전략 수립 실패, OpenAI 전략 폴백 시도/u);
    assert.match(strategyPlannerSource, /runOpenAIStrategyFallback\(\{/u);
    assert.match(strategyPlannerSource, /Anthropic 전략 수립 실패 — OpenAI 전략 폴백으로 복구했습니다\./u);
  });

  test("OpenAI 폴백까지 실패하거나 키가 없을 때만 local_fallback writer 차단으로 내려간다", () => {
    assert.match(strategyPlannerSource, /OpenAI 전략 폴백도 실패, 안전 폴백 전략으로 전환/u);
    assert.match(strategyPlannerSource, /AI 전략 수립에 실패했고 OPENAI_API_KEY도 없어 안전 폴백/u);
    assert.match(strategyPlannerSource, /strategySource: "local_fallback"/u);
    assert.match(strategyPlannerSource, /strategyProvider: "local"/u);
  });
});
