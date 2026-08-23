/**
 * ledger — 사용량 장부의 순수 병합/집계 로직.
 *
 * 잔액을 "충전액 누적"이 아니라 "잔액 스냅샷"으로 다루는 이유:
 * 충전액을 더해가는 방식은 시작 잔액을 0으로 가정해야 맞다. 이미 얼마 남은
 * 상태에서 충전하면 그 차이가 영구 오차로 남고, 충전 기록을 한 번 빠뜨리면
 * 영영 어긋난다. 대신 "이 시점 콘솔에서 본 잔액이 얼마였다"를 찍어두면 그 뒤
 * 지출만 빼면 되고, 어긋났다 싶을 때 콘솔 보고 다시 찍으면 즉시 재동기화된다.
 *
 * 스냅샷에 그 시점의 누적 지출(spentAtMarkUsd)을 같이 저장하는 게 핵심이다.
 * 일별 버킷은 오래된 것부터 지우는데, 누적 지출은 절대 지우지 않으므로
 * 정리(prune) 후에도 잔액 계산이 틀어지지 않는다.
 */

export const LEDGER_VERSION = 2;

/** 하루치 모델별 집계. */
export interface ModelBucket {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number;
  /** 단가표에 없는 모델이 섞였는지. UI가 "추정치" 표시를 붙이는 근거. */
  unpriced: boolean;
}

export interface DayBucket {
  /** YYYY-MM-DD (KST 기준). */
  date: string;
  models: Record<string, ModelBucket>;
}

export interface BalanceMark {
  /** ISO timestamp. */
  at: string;
  /** 그 시점 콘솔에서 확인한 잔액(USD). */
  balanceUsd: number;
  /** 그 시점까지의 앱 누적 지출(USD). 이후 지출만 빼기 위한 기준점. */
  spentAtMarkUsd: number;
  note?: string;
}

export interface UsageLedger {
  version: number;
  /** 절대 줄어들지 않는 누적 지출. prune의 영향을 받지 않는다. */
  lifetimeUsd: number;
  lifetimeCalls: number;
  /** 최근 N일 상세. 오래된 것부터 정리된다. */
  days: DayBucket[];
  balanceMarks: BalanceMark[];
  updatedAt: string;
}

export interface UsageSample {
  /** ISO timestamp. */
  at: string;
  model: string;
  /** 어느 단계에서 난 호출인지 (topic-generator, master-writer 등). */
  label?: string;
  calls?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number;
  priced: boolean;
}

export const DEFAULT_KEEP_DAYS = 90;

export function emptyLedger(now: Date = new Date()): UsageLedger {
  return {
    version: LEDGER_VERSION,
    lifetimeUsd: 0,
    lifetimeCalls: 0,
    days: [],
    balanceMarks: [],
    updatedAt: now.toISOString(),
  };
}

/**
 * KST 기준 YYYY-MM-DD.
 *
 * 서버가 UTC로 도는데(Railway) 사용자는 한국에 있다. UTC로 자르면 한국 시간
 * 오전 9시에 날짜가 바뀌어서 "오늘 쓴 돈"이 엉뚱하게 보인다.
 */
export function kstDateKey(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "1970-01-01";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function emptyBucket(): ModelBucket {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usd: 0,
    unpriced: false,
  };
}

/** 표본들을 장부에 합친다. 입력 장부는 변형하지 않는다. */
export function recordSamples(ledger: UsageLedger, samples: UsageSample[]): UsageLedger {
  if (samples.length === 0) return ledger;

  const days = ledger.days.map((d) => ({ date: d.date, models: { ...d.models } }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  let lifetimeUsd = ledger.lifetimeUsd;
  let lifetimeCalls = ledger.lifetimeCalls;

  for (const sample of samples) {
    const date = kstDateKey(sample.at);
    let day = byDate.get(date);
    if (!day) {
      day = { date, models: {} };
      byDate.set(date, day);
      days.push(day);
    }

    const key = sample.model || "unknown";
    const prev = day.models[key] ?? emptyBucket();
    const calls = sample.calls ?? 1;
    day.models[key] = {
      calls: prev.calls + calls,
      inputTokens: prev.inputTokens + sample.inputTokens,
      outputTokens: prev.outputTokens + sample.outputTokens,
      cacheReadTokens: prev.cacheReadTokens + sample.cacheReadTokens,
      cacheWriteTokens: prev.cacheWriteTokens + sample.cacheWriteTokens,
      usd: prev.usd + sample.usd,
      unpriced: prev.unpriced || !sample.priced,
    };

    lifetimeUsd += sample.usd;
    lifetimeCalls += calls;
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

  return {
    ...ledger,
    version: LEDGER_VERSION,
    lifetimeUsd,
    lifetimeCalls,
    days,
    updatedAt: new Date().toISOString(),
  };
}

/** 오래된 일별 버킷을 버린다. lifetimeUsd는 건드리지 않는다. */
export function pruneLedger(ledger: UsageLedger, keepDays: number = DEFAULT_KEEP_DAYS): UsageLedger {
  if (ledger.days.length <= keepDays) return ledger;
  return { ...ledger, days: ledger.days.slice(-keepDays) };
}

/**
 * 잔액 스냅샷을 찍는다. 지금까지의 누적 지출을 기준점으로 함께 저장한다.
 * 이력은 최근 20개만 남긴다 — 감사용이지 계산에는 최신 것만 쓴다.
 */
export function markBalance(
  ledger: UsageLedger,
  balanceUsd: number,
  options: { at?: string; note?: string } = {}
): UsageLedger {
  const mark: BalanceMark = {
    at: options.at ?? new Date().toISOString(),
    balanceUsd,
    spentAtMarkUsd: ledger.lifetimeUsd,
    ...(options.note ? { note: options.note } : {}),
  };
  const balanceMarks = [...ledger.balanceMarks, mark]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-20);
  return { ...ledger, balanceMarks, updatedAt: new Date().toISOString() };
}

export function latestMark(ledger: UsageLedger): BalanceMark | null {
  if (ledger.balanceMarks.length === 0) return null;
  return ledger.balanceMarks[ledger.balanceMarks.length - 1];
}

export interface ModelSummary {
  model: string;
  calls: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface UsageSummary {
  todayUsd: number;
  todayCalls: number;
  monthUsd: number;
  last7DaysUsd: number;
  lifetimeUsd: number;
  lifetimeCalls: number;
  /** 데이터가 있는 날만 평균낸다. 안 돌린 날까지 나누면 소진 예상일이 부풀려진다. */
  dailyAvgUsd: number;
  byModel: ModelSummary[];
  /** 잔액 스냅샷이 없으면 null — 게이지 대신 "잔액을 입력하세요"를 띄운다. */
  estimatedRemainingUsd: number | null;
  spentSinceMarkUsd: number | null;
  markedAt: string | null;
  markedBalanceUsd: number | null;
  /** 남은 일수. 잔액이나 일평균이 없으면 null, 잔액이 0 이하면 0. */
  daysLeft: number | null;
  /** 단가 미상 모델이 섞였는지. */
  hasUnpriced: boolean;
  /** 최근 일별 지출 (스파크라인용). */
  daily: Array<{ date: string; usd: number; calls: number }>;
}

function bucketTotals(day: DayBucket): { usd: number; calls: number } {
  let usd = 0;
  let calls = 0;
  for (const b of Object.values(day.models)) {
    usd += b.usd;
    calls += b.calls;
  }
  return { usd, calls };
}

export function summarize(
  ledger: UsageLedger,
  options: { now?: Date; avgWindowDays?: number; dailyWindowDays?: number } = {}
): UsageSummary {
  const now = options.now ?? new Date();
  const avgWindow = options.avgWindowDays ?? 7;
  const dailyWindow = options.dailyWindowDays ?? 30;

  const todayKey = kstDateKey(now);
  const monthPrefix = todayKey.slice(0, 7);

  let todayUsd = 0;
  let todayCalls = 0;
  let monthUsd = 0;
  let hasUnpriced = false;

  const modelAcc = new Map<string, ModelSummary>();
  const daily: Array<{ date: string; usd: number; calls: number }> = [];

  for (const day of ledger.days) {
    const totals = bucketTotals(day);
    daily.push({ date: day.date, usd: totals.usd, calls: totals.calls });

    if (day.date === todayKey) {
      todayUsd = totals.usd;
      todayCalls = totals.calls;
    }
    if (day.date.startsWith(monthPrefix)) monthUsd += totals.usd;

    for (const [model, b] of Object.entries(day.models)) {
      if (b.unpriced) hasUnpriced = true;
      const acc = modelAcc.get(model) ?? {
        model,
        calls: 0,
        usd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
      };
      acc.calls += b.calls;
      acc.usd += b.usd;
      acc.inputTokens += b.inputTokens;
      acc.outputTokens += b.outputTokens;
      acc.cacheReadTokens += b.cacheReadTokens;
      modelAcc.set(model, acc);
    }
  }

  const recent = daily.slice(-avgWindow);
  const last7DaysUsd = recent.reduce((sum, d) => sum + d.usd, 0);
  const activeDays = recent.filter((d) => d.usd > 0).length;
  const dailyAvgUsd = activeDays > 0 ? last7DaysUsd / activeDays : 0;

  const mark = latestMark(ledger);
  let estimatedRemainingUsd: number | null = null;
  let spentSinceMarkUsd: number | null = null;
  let daysLeft: number | null = null;

  if (mark) {
    spentSinceMarkUsd = Math.max(0, ledger.lifetimeUsd - mark.spentAtMarkUsd);
    estimatedRemainingUsd = mark.balanceUsd - spentSinceMarkUsd;
    if (estimatedRemainingUsd <= 0) {
      daysLeft = 0;
    } else if (dailyAvgUsd > 0) {
      daysLeft = estimatedRemainingUsd / dailyAvgUsd;
    }
  }

  return {
    todayUsd,
    todayCalls,
    monthUsd,
    last7DaysUsd,
    lifetimeUsd: ledger.lifetimeUsd,
    lifetimeCalls: ledger.lifetimeCalls,
    dailyAvgUsd,
    byModel: [...modelAcc.values()].sort((a, b) => b.usd - a.usd),
    estimatedRemainingUsd,
    spentSinceMarkUsd,
    markedAt: mark?.at ?? null,
    markedBalanceUsd: mark?.balanceUsd ?? null,
    daysLeft,
    hasUnpriced,
    daily: daily.slice(-dailyWindow),
  };
}

export type UsageLevel = "unknown" | "healthy" | "low" | "critical" | "empty";

/**
 * 게이지 색깔을 정한다. 금액이 아니라 남은 일수로 판정하는 이유:
 * 5달러가 많은지 적은지는 얼마나 자주 돌리느냐에 달렸다. 매일 돌리는 사람에겐
 * 이틀치고, 주말에만 돌리는 사람에겐 한 달치다. "며칠 남았나"가 사용자가
 * 실제로 알고 싶은 것이다.
 */
export function usageLevel(summary: UsageSummary): UsageLevel {
  const remaining = summary.estimatedRemainingUsd;
  if (remaining === null) return "unknown";
  if (remaining <= 0) return "empty";
  if (summary.daysLeft === null) {
    // 잔액은 아는데 사용 이력이 없어 속도를 모른다. 금액으로만 대충 나눈다.
    return remaining < 2 ? "critical" : remaining < 5 ? "low" : "healthy";
  }
  if (summary.daysLeft < 2) return "critical";
  if (summary.daysLeft < 7) return "low";
  return "healthy";
}
