import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// 2026-07-06 실측: strategy-planner 실패 사유가 "tool-use 루프가 8회 반복 한계에
// 도달했습니다"로 찍혔는데, Railway 로그를 보니 실제로는 iteration 4에서
// stop_reason=max_tokens로 응답이 잘려 tool_use 없이 while 루프를 조기 break한
// 것이었다(도구 호출 자체는 iteration 1~3에서 정상 완료). 어떤 이유로 루프를
// 빠져나오든 항상 같은 "반복 한계 도달" 메시지를 던지고 있어서, 실제 원인
// (4096 토큰이 최종 전략 JSON 출력엔 부족함)이 완전히 가려졌었다. 두 가지를
// 고정한다: max_tokens를 8192로 올리고, 진짜 반복 한계 도달과 그 외 조기
// 종료(예: max_tokens)를 다른 메시지로 구분한다.
const ROOT = process.cwd();
const toolExecutorSource = readFileSync(path.join(ROOT, "lib", "anthropic", "tool-executor.ts"), "utf8").replace(/\r\n/gu, "\n");

describe("PR22 tool-executor max_tokens 상향 + 정확한 조기종료 사유 메시지", () => {
  test("max_tokens을 4096에서 8192로 올린다", () => {
    assert.match(toolExecutorSource, /const MAX_OUTPUT_TOKENS = 8192;/u);
    assert.match(toolExecutorSource, /max_tokens: MAX_OUTPUT_TOKENS/u);
    assert.doesNotMatch(toolExecutorSource, /max_tokens: 4096/u);
  });

  test("iterations가 maxIterations에 실제로 도달한 경우에만 '반복 한계 도달' 메시지를 던진다", () => {
    assert.match(toolExecutorSource, /if \(iterations >= maxIterations\) \{/u);
    assert.match(toolExecutorSource, /throw new Error\(`tool-use 루프가 \$\{maxIterations\}회 반복 한계에 도달했습니다\.`\);/u);
  });

  test("그 외 조기 종료(예: max_tokens)는 실제 stop_reason을 그대로 알려준다", () => {
    assert.match(toolExecutorSource, /let lastStopReason: string \| null = null/u);
    assert.match(toolExecutorSource, /lastStopReason = finalStopReason;/u);
    assert.match(toolExecutorSource, /AI 응답이 예상치 못한 사유\(stop_reason=\$\{lastStopReason \?\? "unknown"\}\)로 중단되었습니다/u);
  });

  test("실패 시점의 phase(pre_first_event/streaming/finalizing)와 단계별 시각을 로그에 남긴다", () => {
    // phase 이름은 "connecting"이 아니라 "pre_first_event"다 — 이 SDK stream()의
    // 첫 이벤트를 아직 못 받았다는 뜻일 뿐, "응답 바이트를 전혀 못 받음"을
    // 보장하지 않는다는 codex-rescue 지적(2026-07-06)을 반영해 이름을 정정했다.
    assert.match(toolExecutorSource, /let phase: "pre_first_event" \| "streaming" \| "finalizing" = "pre_first_event";/u);
    assert.match(toolExecutorSource, /phase = "streaming";/u);
    assert.match(toolExecutorSource, /phase = "finalizing";/u);
    assert.match(toolExecutorSource, /timeToFirstEventMs: firstEventAt \? firstEventAt - attemptStartedAt : null/u);
    assert.match(toolExecutorSource, /timeInFinalizingMs: finalizingStartedAt \? Date\.now\(\) - finalizingStartedAt : null/u);
  });

  test("cause가 Error 인스턴스가 아니어도 code/errno를 놓치지 않는다", () => {
    assert.match(toolExecutorSource, /cause && typeof cause === "object"/u);
    assert.match(toolExecutorSource, /causeCode: causeObj\?\.code/u);
    assert.match(toolExecutorSource, /causeErrno: causeObj\?\.errno/u);
  });
});
