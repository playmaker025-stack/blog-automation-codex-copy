import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// tool-executor.ts는 "./client" 같은 확장자 없는 상대 경로(번들러 전용 해석)를 쓰기 때문에
// Node 네이티브 TS 로더로 직접 import할 수 없다 (기존 코드 스타일, 이 커밋에서 새로 만든 문제
// 아님). 이 저장소의 다른 pr16 테스트와 동일하게 소스 패턴 매칭으로 검증한다.
const ROOT = process.cwd();
const toolExecutorSource = readFileSync(
  path.join(ROOT, "lib", "anthropic", "tool-executor.ts"),
  "utf8"
);

describe("PR17 tool-executor Anthropic 연결 오류 재시도", () => {
  test("APIConnectionError / RateLimitError / InternalServerError를 재시도 대상으로 판별한다", () => {
    assert.match(toolExecutorSource, /error instanceof APIConnectionError/u);
    assert.match(toolExecutorSource, /error instanceof RateLimitError/u);
    assert.match(toolExecutorSource, /error instanceof InternalServerError/u);
  });

  test("실제 프로덕션 장애 문구(Premature close)를 재시도 대상 메시지로 포함한다", () => {
    assert.match(toolExecutorSource, /message\.includes\("premature close"\)/u);
    assert.match(toolExecutorSource, /message\.includes\("econnreset"\)/u);
    assert.match(toolExecutorSource, /message\.includes\("socket hang up"\)/u);
    assert.match(toolExecutorSource, /message\.includes\("fetch failed"\)/u);
  });

  test("재시도 불가 오류(신호 취소, 최대 시도 초과)는 즉시 throw한다", () => {
    assert.match(toolExecutorSource, /isRetryableConnectionError\(error\) && !pipelineSignal\?\.aborted/u);
    assert.match(toolExecutorSource, /if \(!canRetry\) throw error;/u);
  });

  test("지수 백오프(2s → 4s)로 최대 3회 재시도한다", () => {
    assert.match(toolExecutorSource, /NETWORK_RETRY_ATTEMPTS = 3/u);
    assert.match(toolExecutorSource, /NETWORK_RETRY_BASE_DELAY_MS = 2_000/u);
    assert.match(toolExecutorSource, /NETWORK_RETRY_BASE_DELAY_MS \* 2 \*\* \(attempt - 1\)/u);
  });

  test("모든 재시도 소진 시 lastError를 그대로 전파한다 (에러가 조용히 사라지지 않는다)", () => {
    assert.match(toolExecutorSource, /throw lastError \?\? new Error/u);
  });
});
