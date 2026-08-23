/**
 * usage-recorder — 모든 Anthropic 호출의 usage를 모아 장부에 흘려보낸다.
 *
 * 왜 버퍼링하나:
 * 장부는 GitHub 파일이라 쓰기 한 번이 커밋 한 번이다. 글 한 편 쓰는 데
 * 호출이 수십 번 나는데 매번 커밋하면 히스토리가 사용량 커밋으로 덮인다.
 * 모아서 한 번에 쓴다.
 *
 * 프로세스가 죽으면 버퍼는 날아간다. 그건 감수한다 — 사용량 집계는 청구
 * 근거가 아니라 "언제 충전해야 하나"를 가늠하는 용도고, 플러시 간격이
 * 짧아서 손실은 마지막 몇 호출뿐이다. 정확한 금액은 콘솔이 권위다.
 *
 * 이 모듈의 어떤 함수도 예외를 던지지 않는다. 집계 실패가 글쓰기를 막으면
 * 주객이 전도된다.
 */

import { priceUsage, type TokenUsage } from "@/lib/usage/pricing";
import type { UsageSample } from "@/lib/usage/ledger";
import { appendUsageSamples } from "@/lib/usage/store";
import { noteApiFailure, noteApiSuccess } from "./account-health";

const FLUSH_AT_SAMPLES = 12;
const FLUSH_AFTER_MS = 45_000;

let buffer: UsageSample[] = [];
let lastFlushAt = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

/**
 * 호출 하나의 usage를 기록한다. 성공한 호출이므로 계정 상태도 정상으로 표시한다.
 *
 * usage가 없거나 토큰이 0이면 무시한다 — 스트림이 중간에 끊긴 경우 등.
 */
export function recordUsage(
  model: string | null | undefined,
  usage: TokenUsage | null | undefined,
  label?: string
): void {
  try {
    noteApiSuccess();
    if (!usage) return;

    const priced = priceUsage(model ?? "unknown", usage);
    const touched =
      priced.inputTokens + priced.outputTokens + priced.cacheReadTokens + priced.cacheWriteTokens;
    if (touched === 0) return;

    buffer.push({
      at: new Date().toISOString(),
      model: model ?? "unknown",
      ...(label ? { label } : {}),
      inputTokens: priced.inputTokens,
      outputTokens: priced.outputTokens,
      cacheReadTokens: priced.cacheReadTokens,
      cacheWriteTokens: priced.cacheWriteTokens,
      usd: priced.usd,
      priced: priced.priced,
    });

    scheduleFlush();
  } catch (error) {
    console.warn("[usage-recorder] 기록 실패:", String(error));
  }
}

/** 호출이 실패했다. 계정 단위 거부면 배너 상태로 승격된다. */
export function recordApiFailure(error: unknown, label?: string): void {
  try {
    noteApiFailure(error, label);
  } catch {
    // 상태 갱신 실패는 무시한다.
  }
}

/**
 * 호출을 감싸서 실패 시 계정 상태만 기록하고 그대로 다시 던진다.
 *
 * try/catch를 각 호출부에 흩뿌리지 않으려고 헬퍼로 뺐다. 에러는 재던지므로
 * 기존 예외 흐름(상위 재시도, 폴백)은 전혀 바뀌지 않는다.
 */
export async function createOrRecord<T>(call: () => Promise<T>, label: string): Promise<T> {
  try {
    return await call();
  } catch (error) {
    recordApiFailure(error, label);
    throw error;
  }
}

function scheduleFlush(): void {
  const overdue = Date.now() - lastFlushAt >= FLUSH_AFTER_MS;
  if (buffer.length >= FLUSH_AT_SAMPLES || overdue) {
    void flushUsage();
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushUsage();
  }, FLUSH_AFTER_MS);
  // 타이머가 프로세스 종료를 붙잡지 않게 한다.
  timer.unref?.();
}

/**
 * 버퍼를 장부에 쓴다. 파이프라인 끝과 사용량 조회 직전에 명시적으로 부른다.
 *
 * 동시 호출은 진행 중인 플러시에 합류시킨다. 두 개가 같이 읽고 같이 쓰면
 * sha 충돌로 한쪽이 재시도를 돌게 되는데, 애초에 한 번만 돌리는 게 낫다.
 */
export async function flushUsage(): Promise<void> {
  if (inFlight) return inFlight;
  if (buffer.length === 0) {
    lastFlushAt = Date.now();
    return;
  }

  const pending = buffer;
  buffer = [];
  lastFlushAt = Date.now();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  inFlight = (async () => {
    const ok = await appendUsageSamples(pending);
    if (!ok) {
      // 저장 실패분은 버퍼 앞에 되돌려 다음 기회에 다시 시도한다.
      // 무한정 쌓이지 않게 상한을 둔다.
      buffer = [...pending, ...buffer].slice(-200);
    }
  })()
    .catch((error) => {
      console.warn("[usage-recorder] 플러시 실패:", String(error));
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** 아직 장부에 안 들어간 표본 수. 디버깅용. */
export function pendingUsageCount(): number {
  return buffer.length;
}
