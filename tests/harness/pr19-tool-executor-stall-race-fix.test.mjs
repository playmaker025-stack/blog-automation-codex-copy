import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// pr18의 스트리밍 전환을 codex-rescue가 리뷰하며 발견한 버그 2건을 고정한다:
// 1) stall timeout이 나도 실제 스트림을 abort하지 않아, 버려진 이전 시도가 나중에
//    조용히 완료되며 attempt 바깥 finalContent/finalStopReason을 덮어쓸 수 있었음
//    → attemptAbort로 실제 스트림을 끊고, attemptContent/attemptStopReason을
//      시도별 지역 변수로 분리해 Promise.race 성공 시에만 바깥에 반영하도록 수정.
// 2) stall/hard-deadline 타임아웃이 재시도 대상으로 분류되지 않아 1회 실패로 끝났음
//    → StallTimeoutError / APIUserAbortError를 재시도 대상에 추가.
const ROOT = process.cwd();
// CRLF/LF 무관하게 매칭되도록 정규화 (Windows git core.autocrlf + eslint --fix가
// 커밋 훅에서 줄바꿈을 CRLF로 바꿔서, \n 기준 문자열 슬라이싱이 깨지는 걸 방지).
const toolExecutorSource = readFileSync(
  path.join(ROOT, "lib", "anthropic", "tool-executor.ts"),
  "utf8"
).replace(/\r\n/gu, "\n");

describe("PR19 tool-executor stall 레이스 컨디션 수정 (codex-rescue 리뷰 반영)", () => {
  test("시도별 AbortController로 stall 시 실제 스트림을 끊는다", () => {
    assert.match(toolExecutorSource, /const attemptAbort = new AbortController\(\)/u);
    assert.match(toolExecutorSource, /attemptAbort\.abort\(\)/u);
    assert.match(toolExecutorSource, /signals = \[attemptAbort\.signal, hardDeadline\]/u);
  });

  test("stall 타이머 발동 시 stallReject보다 먼저(또는 함께) attemptAbort를 호출한다", () => {
    const timerBody = toolExecutorSource.slice(
      toolExecutorSource.indexOf("stallTimer = setTimeout(() => {"),
      toolExecutorSource.indexOf("}, ms);")
    );
    const abortIdx = timerBody.indexOf("attemptAbort.abort()");
    const rejectIdx = timerBody.indexOf("stallReject!(");
    assert.notEqual(abortIdx, -1);
    assert.notEqual(rejectIdx, -1);
    assert.ok(abortIdx < rejectIdx, "attemptAbort.abort()가 stallReject보다 먼저 호출돼야 한다");
  });

  test("attemptContent/attemptStopReason은 시도별 지역 변수이고, race 성공 시에만 바깥 상태에 반영된다", () => {
    assert.match(toolExecutorSource, /let attemptContent: ContentBlock\[\] \| null = null/u);
    assert.match(toolExecutorSource, /let attemptStopReason: string \| null = null/u);
    // async IIFE 안에서는 attemptContent/attemptStopReason에만 쓰고, finalContent에는 직접 안 쓴다
    const raceBlockStart = toolExecutorSource.indexOf("await Promise.race([");
    const raceBlockEnd = toolExecutorSource.indexOf("stallPromise,\n        ]);") + "stallPromise,\n        ]);".length;
    const raceBlock = toolExecutorSource.slice(raceBlockStart, raceBlockEnd);
    assert.doesNotMatch(raceBlock, /\bfinalContent = /u);
    assert.doesNotMatch(raceBlock, /\bfinalStopReason = /u);
    // race 이후 성공 경로에서만 바깥 변수에 반영
    const afterRace = toolExecutorSource.slice(raceBlockEnd, raceBlockEnd + 300);
    assert.match(afterRace, /finalContent = attemptContent/u);
    assert.match(afterRace, /finalStopReason = attemptStopReason/u);
  });

  test("catch 블록에서도 attemptAbort를 호출해 실패한 시도의 스트림을 정리한다", () => {
    const catchIdx = toolExecutorSource.indexOf("} catch (error) {");
    const catchBody = toolExecutorSource.slice(catchIdx, catchIdx + 200);
    assert.match(catchBody, /attemptAbort\.abort\(\)/u);
  });

  test("StallTimeoutError / APIUserAbortError는 재시도 대상이다", () => {
    assert.match(toolExecutorSource, /class StallTimeoutError extends Error/u);
    assert.match(toolExecutorSource, /error instanceof StallTimeoutError/u);
    assert.match(toolExecutorSource, /error instanceof APIUserAbortError/u);
    assert.match(toolExecutorSource, /import \{ APIConnectionError, APIUserAbortError, InternalServerError, RateLimitError \} from "@anthropic-ai\/sdk"/u);
  });
});
