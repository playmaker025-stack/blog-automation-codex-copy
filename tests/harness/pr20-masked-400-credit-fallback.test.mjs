import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// 2026-07-03 실측: 프로덕션에서 4번 연속 "400 Invalid response body ... Premature
// close"가 재현됐다. 로컬에서 동일 요청(topic-344a56f6, user a)을 그대로
// Anthropic API에 보내 재현해보니 진짜 에러는 "Your credit balance is too
// low..."였다 — Railway 환경에서만 그 400 에러 본문을 읽는 것 자체가 실패해
// "Premature close"로 가려졌다. codex-rescue 리뷰 2건을 반영해 다음을 고정한다:
// 1) tool-executor.ts: 이 SDK(core.js shouldRetry)가 원래 재시도 대상으로 보는
//    408/409/429/5xx는 그대로 두고, 진짜 확정적 거부(400/401/403/404/422)만
//    재시도에서 제외한다 (동일 요청을 재시도해도 항상 같은 결과이기 때문).
// 2) strategy-planner.ts: "본문을 못 읽은 400"을 전부 크레딧 문제로 단정하지
//    않는다 — confirmed_credit과 masked_400_unknown_cause를 구분해서 분류하고,
//    둘 다 OpenAI 폴백은 시도하되(운영 복구) 로그/진행 메시지는 확인된 사실만
//    말한다(실제로는 우리 쪽 malformed request 버그일 수도 있으므로).
const ROOT = process.cwd();
const toolExecutorSource = readFileSync(path.join(ROOT, "lib", "anthropic", "tool-executor.ts"), "utf8").replace(/\r\n/gu, "\n");
const strategyPlannerSource = readFileSync(path.join(ROOT, "lib", "agents", "strategy-planner.ts"), "utf8").replace(/\r\n/gu, "\n");

describe("PR20 마스킹된 400(크레딧 소진) 재시도 정밀화 + OpenAI 폴백 감지", () => {
  test("tool-executor: 400/401/403/404/422만 재시도 대상에서 제외하고, 408/409는 제외하지 않는다", () => {
    assert.match(toolExecutorSource, /NON_RETRYABLE_4XX = new Set\(\[400, 401, 403, 404, 422\]\)/u);
    assert.doesNotMatch(toolExecutorSource, /NON_RETRYABLE_4XX = new Set\(\[[^\]]*\b408\b/u);
    assert.doesNotMatch(toolExecutorSource, /NON_RETRYABLE_4XX = new Set\(\[[^\]]*\b409\b/u);
  });

  test("tool-executor: RateLimitError/InternalServerError/StallTimeoutError/APIUserAbortError는 status 배제 로직보다 먼저 재시도 대상으로 확정된다", () => {
    const bodyStart = toolExecutorSource.indexOf("function isRetryableConnectionError");
    const bodyEnd = toolExecutorSource.indexOf("\n}", bodyStart);
    const body = toolExecutorSource.slice(bodyStart, bodyEnd);
    const rateLimitIdx = body.indexOf("error instanceof RateLimitError");
    const statusCheckIdx = body.indexOf("NON_RETRYABLE_4XX.has(status)");
    assert.notEqual(rateLimitIdx, -1);
    assert.notEqual(statusCheckIdx, -1);
    assert.ok(rateLimitIdx < statusCheckIdx, "RateLimitError 등 instanceof 체크가 status 배제 로직보다 먼저 와야 한다");
  });

  test("strategy-planner: confirmed_credit과 masked_400_unknown_cause를 구분해서 분류한다", () => {
    assert.match(strategyPlannerSource, /type FatalStrategyProviderClassification = "confirmed_credit" \| "masked_400_unknown_cause" \| null/u);
    assert.match(strategyPlannerSource, /return "confirmed_credit";/u);
    assert.match(strategyPlannerSource, /return "masked_400_unknown_cause";/u);
  });

  test("strategy-planner: 두 분류 모두 OpenAI 폴백을 시도하지만, 진행 메시지는 분류별로 다르게 말한다", () => {
    assert.match(strategyPlannerSource, /const fatalClassification = classifyFatalStrategyProviderError\(error\)/u);
    assert.match(strategyPlannerSource, /사유 확인 불가 — 크레딧 문제일 수도, 다른 요청 오류일 수도 있음/u);
  });

  test("strategy-planner: 기존 credit balance 직접 매칭도 그대로 유지된다", () => {
    assert.match(strategyPlannerSource, /message\.includes\("credit balance is too low"\)/u);
  });
});
