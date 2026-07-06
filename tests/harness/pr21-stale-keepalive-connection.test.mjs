import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// 2026-07-06 실측: 파이프라인 시작(iteration 1)마다 100% 재현되는
// ERR_STREAM_PREMATURE_CLOSE를 Railway 로그에서 직접 확인 — 3회 재시도가 전부
// 동일하게 실패했다(진짜 flaky 네트워크라면 재시도마다 갈려야 정상). getAnthropicClient()가
// 모듈 싱글턴으로 모든 API 호출(strategy-planner, master-writer 등)의 소켓 풀을
// 공유하는데, 파이프라인 사이 유휴 시간 동안 죽은 keep-alive 소켓을 Node가 재사용하며
// 매 파이프라인의 첫 호출(iteration 1)에서 반복 재현된 것으로 진단했다.
// httpAgent keepAlive:false로 매 요청 새 연결을 열게 해 구조적으로 제거한다.
const ROOT = process.cwd();
const clientSource = readFileSync(path.join(ROOT, "lib", "anthropic", "client.ts"), "utf8").replace(/\r\n/gu, "\n");

describe("PR21 Anthropic 클라이언트 stale keep-alive 연결 재사용 방지", () => {
  test("node:https Agent를 keepAlive:false로 생성해 httpAgent로 전달한다", () => {
    assert.match(clientSource, /import https from "node:https"/u);
    assert.match(clientSource, /new https\.Agent\(\{ keepAlive: false \}\)/u);
    assert.match(clientSource, /new Anthropic\(\{ apiKey, timeout: 120_000, maxRetries: 0, httpAgent \}\)/u);
  });
});
