import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const strategyPlannerSource = readFileSync(
  path.join(ROOT, "lib", "agents", "strategy-planner.ts"),
  "utf8"
);
const orchestratorSource = readFileSync(
  path.join(ROOT, "lib", "agents", "orchestrator.ts"),
  "utf8"
);
const typesSource = readFileSync(
  path.join(ROOT, "lib", "agents", "types.ts"),
  "utf8"
);

describe("PR16 strategy fallback publish gate", () => {
  test("StrategyPlanResult는 AI 전략과 로컬 폴백 전략 출처를 구분한다", () => {
    assert.match(typesSource, /strategySource\?: "ai" \| "local_fallback"/u);
    assert.match(typesSource, /strategyFallbackReason\?: string/u);
  });

  test("AI 전략 실패 시 폴백은 local_fallback으로 표시되고 발행용 writer 차단 사유를 만든다", () => {
    assert.match(strategyPlannerSource, /strategySource: "ai"/u);
    assert.match(strategyPlannerSource, /strategySource: "local_fallback"/u);
    assert.match(strategyPlannerSource, /strategyFallbackReason: fallbackReason/u);
    assert.match(strategyPlannerSource, /AI 전략 수립 실패로 안전 폴백 전략이 생성되어 발행용 writer 실행을 차단합니다/u);
    assert.match(strategyPlannerSource, /evaluatePublishableStrategyGate\(plan\)/u);
  });

  test("strategy phase는 strategyQualityGate ok=false 전체를 승인 요청 전에 차단한다", () => {
    assert.match(orchestratorSource, /const qualityGateBlocked = strategy\.strategyQualityGate && !strategy\.strategyQualityGate\.ok/u);
    assert.match(orchestratorSource, /if \(qualityGateBlocked\)/u);
    assert.doesNotMatch(orchestratorSource, /duplicateBlocked && params\.duplicateModeOverride/u);
  });
});
