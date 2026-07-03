import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// pr17의 재시도 로직만으로는 "Premature close"가 계속 재현됐다(2026-07-02~07-03,
// 재시도 배포 이후에도 반복). non-streaming client.messages.create()는 응답이 끝날
// 때까지 바이트가 안 흐르니 중간에 끊기기 쉽다는 게 원인이라 client.messages.stream()으로
// 전환했다. 이 파일이 그 전환을 소스 패턴으로 고정한다 (tool-executor.ts는 확장자 없는
// 상대 import를 써서 Node 네이티브 TS 로더로 직접 import 불가 — pr16/pr17과 동일 이유).
const ROOT = process.cwd();
const toolExecutorSource = readFileSync(
  path.join(ROOT, "lib", "anthropic", "tool-executor.ts"),
  "utf8"
);

describe("PR18 tool-executor 스트리밍 전환 (Premature close 근본 수정)", () => {
  test("non-streaming create()가 아니라 streaming stream()을 사용한다", () => {
    assert.match(toolExecutorSource, /const stream = client\.messages\.stream\(/u);
    assert.doesNotMatch(toolExecutorSource, /= await client\.messages\.create\(/u);
  });

  test("첫 이벤트 전/후 스톨을 분리 감지하는 타이머를 둔다 (INITIAL/STALL)", () => {
    assert.match(toolExecutorSource, /INITIAL_TIMEOUT_MS = 150_000/u);
    assert.match(toolExecutorSource, /STALL_TIMEOUT_MS = 90_000/u);
    assert.match(toolExecutorSource, /firstEventReceived \? STALL_TIMEOUT_MS : INITIAL_TIMEOUT_MS/u);
  });

  test("stall 타이머 실패 대비 하드 데드라인으로 연결을 강제 종료한다", () => {
    assert.match(toolExecutorSource, /HARD_DEADLINE_MS = 160_000/u);
    assert.match(toolExecutorSource, /AbortSignal\.timeout\(HARD_DEADLINE_MS\)/u);
  });

  test("스트림 이벤트마다 스톨 타이머를 리셋한다 (토큰이 흐르는 한 타임아웃되지 않음)", () => {
    assert.match(toolExecutorSource, /for await \(const event of stream\)/u);
    assert.match(toolExecutorSource, /resetStallTimer\(\)/u);
  });

  test("연결 레벨 재시도(pr17)는 스트리밍 전환 후에도 유지된다", () => {
    assert.match(toolExecutorSource, /isRetryableConnectionError\(error\)/u);
    assert.match(toolExecutorSource, /NETWORK_RETRY_ATTEMPTS = 3/u);
  });
});
