// Next.js 환경에서 SDK가 web-runtime을 사용하는 문제 방지
// globalThis.fetch가 있으면 SDK가 브라우저로 착각해 node:https agent를 사용하지 않아 "Connection error." 발생
import "@anthropic-ai/sdk/shims/node";
import Anthropic from "@anthropic-ai/sdk";
import https from "node:https";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다.");
  }

  // maxRetries: 0 — SDK 내부 재시도 비활성화.
  // 재시도 시 조용한 대기(최대 수십초)가 발생해 stall timer가 오작동함.
  // 에러 즉시 노출 → 상위 stall timer / race timeout이 처리.
  //
  // 2026-07-06 실측 (원인 미확정 — "재사용 제거 실험"): 파이프라인 시작마다
  // (=매 실행의 iteration 1) 100% 재현되는 ERR_STREAM_PREMATURE_CLOSE를 Railway
  // 로그에서 확인 — 3회 재시도가 전부 1.5~4.5초 안에 동일하게 실패했다(첫 토큰을
  // 오래 기다리다 끊긴 게 아니라 연결 자체가 거의 즉시 실패). 유력한 가설 중
  // 하나는 stale keep-alive 소켓 재사용(모듈 싱글턴 client가 파이프라인 사이
  // 유휴 시간 동안 죽은 pooled 소켓을 재사용)이지만, SDK 기본 에이전트
  // (agentkeepalive)의 freeSocketTimeout이 이미 4초라 이 가설만으론 완전히
  // 설명되지 않는다(codex-rescue 리뷰 지적, 2026-07-06). keepAlive:false는
  // "재사용" 자체를 변수에서 제거해 실제 원인인지 가려내기 위한 시도이지,
  // 확정된 root cause fix가 아니다 — 배포 후에도 이 증상이 계속되면 다른
  // 원인(예: Railway 아웃바운드 네트워크 자체의 문제)을 봐야 한다. 비용은
  // 요청마다 새 TCP/TLS 핸드셰이크(수십~수백ms, LLM 응답 시간 대비 무시할 수준).
  const httpAgent = new https.Agent({ keepAlive: false });
  _client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 0, httpAgent });
  return _client;
}

export const MODELS = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  opus: "claude-opus-4-6",
} as const;

export type ModelName = keyof typeof MODELS;
