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
    assert.match(typesSource, /strategyProvider\?: "anthropic" \| "openai" \| "local"/u);
    assert.match(typesSource, /strategyFallbackReason\?: string/u);
  });

  test("Anthropic 크레딧 부족은 OpenAI 키가 있으면 전략 폴백으로 복구한다", () => {
    assert.match(strategyPlannerSource, /hasOpenAIKey\(\)/u);
    assert.match(strategyPlannerSource, /runOpenAIStrategyFallback/u);
    assert.match(strategyPlannerSource, /strategyProvider: "openai"/u);
    assert.match(strategyPlannerSource, /situationLabel\} — OpenAI 전략 폴백으로 복구했습니다\./u);
  });

  test("OpenAI 키가 없을 때만 치명적 provider 오류를 즉시 중단한다", () => {
    // pr20에서 isFatalStrategyProviderError(boolean) → classifyFatalStrategyProviderError
    // (confirmed_credit | masked_400_unknown_cause | null)로 바뀌었다. ANTHROPIC_CREDIT_BLOCK_MESSAGE
    // 상수도 상황별 situationLabel로 대체됐다 — 크레딧 문제로 확인 안 된 masked 400을
    // 무조건 "크레딧 부족"이라 단정하지 않기 위함(codex-rescue 리뷰, 2026-07-03).
    assert.match(strategyPlannerSource, /const fatalClassification = classifyFatalStrategyProviderError\(error\)/u);
    assert.match(strategyPlannerSource, /credit balance is too low/u);
    assert.match(strategyPlannerSource, /OPENAI_API_KEY도 없어 OpenAI 폴백을 사용할 수 없습니다/u);
    assert.match(strategyPlannerSource, /throw new Error\(`\$\{situationLabel\}\. 원문: \$\{fallbackReason\}`\)/u);
  });

  test("일반 AI 전략 실패 폴백은 local_fallback으로 표시되고 발행용 writer 차단 사유를 만든다", () => {
    assert.match(strategyPlannerSource, /strategySource: "ai"/u);
    assert.match(strategyPlannerSource, /strategyProvider: "anthropic"/u);
    assert.match(strategyPlannerSource, /strategySource: "local_fallback"/u);
    assert.match(strategyPlannerSource, /strategyProvider: "local"/u);
    assert.match(strategyPlannerSource, /strategyFallbackReason: fallbackReason/u);
    assert.match(strategyPlannerSource, /evaluatePublishableStrategyGate\(plan\)/u);
  });

  test("strategyQualityGate 실패 상태에서는 전략 완료 로그를 먼저 찍지 않는다", () => {
    const failureLogIndex = strategyPlannerSource.indexOf("전략 수립 실패:");
    const completionLogIndex = strategyPlannerSource.indexOf("전략 수립 완료:");

    assert.notEqual(failureLogIndex, -1);
    assert.notEqual(completionLogIndex, -1);
    assert.ok(failureLogIndex < completionLogIndex);
  });

  test("strategy phase는 strategyQualityGate ok=false 전체를 승인 요청 전에 차단한다", () => {
    assert.match(orchestratorSource, /const qualityGateBlocked = strategy\.strategyQualityGate && !strategy\.strategyQualityGate\.ok/u);
    assert.match(orchestratorSource, /if \(qualityGateBlocked\)/u);
    assert.doesNotMatch(orchestratorSource, /duplicateBlocked && params\.duplicateModeOverride/u);
  });
});
