import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// 2026-07-06 실측: 파이프라인 시작(iteration 1)마다 100% 재현되는
// ERR_STREAM_PREMATURE_CLOSE를 Railway 로그에서 직접 확인 — 3회 재시도가 전부
// 1.5~4.5초 안에 동일하게 실패했다(첫 토큰을 오래 기다리다 끊긴 게 아니라 즉시
// 실패). getAnthropicClient()가 모듈 싱글턴으로 모든 API 호출의 소켓 풀을
// 공유하므로 "파이프라인 사이 유휴 시간 동안 죽은 keep-alive 소켓 재사용"이
// 유력한 가설 중 하나이지만, SDK 기본 에이전트(agentkeepalive)의
// freeSocketTimeout이 이미 4초라 이 가설만으론 완전히 설명되지 않는다는
// 반론이 있다(codex-rescue 리뷰, 2026-07-06) — **확정된 root cause 아님**.
// httpAgent keepAlive:false는 "재사용" 변수를 제거해 원인인지 가려내는
// 실험이며, tool-executor.ts에 추가한 phase/firstEventAt 진단 로그가 다음
// 실패 때 두 가설을 더 정밀하게 구분해 줄 것으로 기대한다.
const ROOT = process.cwd();
const clientSource = readFileSync(path.join(ROOT, "lib", "anthropic", "client.ts"), "utf8").replace(/\r\n/gu, "\n");

describe("PR21 Anthropic 클라이언트 stale keep-alive 연결 재사용 방지", () => {
  test("node:https Agent를 keepAlive:false로 생성해 httpAgent로 전달한다", () => {
    assert.match(clientSource, /import https from "node:https"/u);
    assert.match(clientSource, /new https\.Agent\(\{ keepAlive: false \}\)/u);
    assert.match(clientSource, /new Anthropic\(\{ apiKey, timeout: 120_000, maxRetries: 0, httpAgent \}\)/u);
  });
});
