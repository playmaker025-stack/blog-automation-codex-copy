/**
 * store — 사용량 장부의 GitHub 저장/불러오기 (I/O 담당).
 *
 * 병합 로직은 ledger.ts에 순수 함수로 있다. 여기는 읽고, 합치고, 쓰는 것만 한다.
 * (하네스 테스트가 "@/" 런타임 import를 못 읽어서 순수/IO를 나눈다.)
 *
 * 쓰기 충돌: 파이프라인 여러 개가 동시에 플러시하면 sha가 어긋나 쓰기가 실패한다.
 * recordSamples가 순수 병합이라 재시도가 안전하다 — 다시 읽고 다시 합쳐서 쓴다.
 */

import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import {
  DEFAULT_KEEP_DAYS,
  emptyLedger,
  markBalance,
  pruneLedger,
  recordSamples,
  type UsageLedger,
  type UsageSample,
} from "./ledger";

const WRITE_ATTEMPTS = 3;

export async function loadUsageLedger(): Promise<{ data: UsageLedger; sha: string | null }> {
  const path = Paths.usageLedger();
  if (!(await fileExists(path))) return { data: emptyLedger(), sha: null };
  try {
    const { data, sha } = await readJsonFile<UsageLedger>(path);
    return { data: normalize(data), sha };
  } catch {
    // 장부가 깨졌다고 파이프라인을 막을 이유는 없다. 빈 장부로 다시 시작한다.
    return { data: emptyLedger(), sha: null };
  }
}

/** 예전 버전 파일이나 손상된 필드를 안전한 기본값으로 채운다. */
function normalize(raw: Partial<UsageLedger> | null): UsageLedger {
  const base = emptyLedger();
  if (!raw || typeof raw !== "object") return base;
  return {
    version: base.version,
    lifetimeUsd: Number.isFinite(raw.lifetimeUsd) ? Number(raw.lifetimeUsd) : 0,
    lifetimeCalls: Number.isFinite(raw.lifetimeCalls) ? Number(raw.lifetimeCalls) : 0,
    days: Array.isArray(raw.days) ? raw.days : [],
    balanceMarks: Array.isArray(raw.balanceMarks) ? raw.balanceMarks : [],
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

/**
 * 표본을 장부에 반영한다. sha 충돌이면 다시 읽어서 재병합한다.
 * 실패해도 예외를 던지지 않는다 — 집계 실패가 글쓰기를 막으면 안 된다.
 */
export async function appendUsageSamples(samples: UsageSample[]): Promise<boolean> {
  if (samples.length === 0) return true;

  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    try {
      const { data, sha } = await loadUsageLedger();
      const next = pruneLedger(recordSamples(data, samples), DEFAULT_KEEP_DAYS);
      await writeJsonFile<UsageLedger>(
        Paths.usageLedger(),
        next,
        `chore(usage): +${samples.length} calls`,
        sha
      );
      return true;
    } catch (error) {
      if (attempt === WRITE_ATTEMPTS) {
        console.warn("[usage/store] 장부 저장 실패:", String(error));
        return false;
      }
    }
  }
  return false;
}

/** 콘솔에서 확인한 잔액을 찍는다. 이건 사용자 명시 동작이라 실패를 던진다. */
export async function saveBalanceMark(
  balanceUsd: number,
  note?: string
): Promise<UsageLedger> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    try {
      const { data, sha } = await loadUsageLedger();
      const next = markBalance(data, balanceUsd, note ? { note } : {});
      await writeJsonFile<UsageLedger>(
        Paths.usageLedger(),
        next,
        `chore(usage): balance mark ${balanceUsd.toFixed(2)} USD`,
        sha
      );
      return next;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
