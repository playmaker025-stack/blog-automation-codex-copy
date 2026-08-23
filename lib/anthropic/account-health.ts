/**
 * account-health — Anthropic 계정 단위 장애를 앱 전체가 공유하는 상태로 들고 있는다.
 *
 * 왜 필요한가:
 * 크레딧이 떨어지면 지금까지는 파이프라인을 돌려봐야 알 수 있었다. 그것도
 * 주제 생성 로그 맨 아래에 원문 JSON으로 찍혔다. CLAUDE.md의 [2026-07-03]
 * 항목이 "이 증상이면 코드 파기 전에 잔액부터 확인하라"고 적어둔 이유가
 * 그거다 — 증상만 보고는 코드 버그와 구분이 안 됐다.
 *
 * 판정 로직 자체는 demand-error.ts에 순수 함수로 있다. 여기는 그 판정을
 * 앱 전역 상태로 승격시키는 얇은 층이다.
 *
 * 메모리에만 둔다. 프로세스가 재시작되면 지워지는 게 맞다 — 배포로 재시작된
 * 뒤에도 "예전에 크레딧 없었음"을 빨간 배너로 계속 띄우면 거짓말이 된다.
 * 다음 호출이 성공하면 스스로 초기화되고, 여전히 문제면 즉시 다시 잡힌다.
 */

import { isAccountLevelFailure, describeExtractionError } from "../agents/demand-error";

export { isAccountLevelFailure, describeExtractionError };

export type AccountHealthState = "unknown" | "ok" | "blocked";

export interface AccountHealth {
  state: AccountHealthState;
  /** 사람이 읽을 수 있는 조치 문구. blocked일 때만 채워진다. */
  message: string | null;
  /** 마지막으로 계정 단위 거부를 본 시각. */
  blockedAt: string | null;
  /** 마지막으로 호출이 성공한 시각. */
  lastOkAt: string | null;
  /** 어느 단계에서 막혔는지. */
  label: string | null;
}

let state: AccountHealthState = "unknown";
let message: string | null = null;
let blockedAt: string | null = null;
let lastOkAt: string | null = null;
let label: string | null = null;

/** 호출이 성공했다. 막힘 상태를 푼다. */
export function noteApiSuccess(): void {
  state = "ok";
  message = null;
  blockedAt = null;
  label = null;
  lastOkAt = new Date().toISOString();
}

/**
 * 호출이 실패했다. 계정 단위 거부일 때만 상태를 바꾼다.
 *
 * 네트워크 오류나 429는 여기서 걸러진다. 그런 걸로 "크레딧을 충전하세요"를
 * 띄우면 사용자가 엉뚱한 곳을 보게 된다.
 */
export function noteApiFailure(error: unknown, source?: string): boolean {
  if (!isAccountLevelFailure(error)) return false;
  state = "blocked";
  message = describeExtractionError(error);
  blockedAt = new Date().toISOString();
  label = source ?? null;
  return true;
}

export function getAccountHealth(): AccountHealth {
  return { state, message, blockedAt, lastOkAt, label };
}

/** 테스트용. 프로덕션 코드에서 부르지 않는다. */
export function resetAccountHealth(): void {
  state = "unknown";
  message = null;
  blockedAt = null;
  lastOkAt = null;
  label = null;
}
