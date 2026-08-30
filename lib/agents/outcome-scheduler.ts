/**
 * outcome-scheduler — 발행 글 순위 관측을 사람이 누르지 않아도 돌게 한다.
 *
 * 왜 앱 안에서 도는가: 이 앱은 Railway에서 상주하는 Node 프로세스다. 별도
 * 크론 서비스를 두면 대시보드 설정이 코드 밖에 생기고, 그게 맞는지 확인할
 * 방법이 배포 화면밖에 없다. 여기 두면 배포와 같이 움직인다.
 *
 * 대신 지켜야 할 것 세 가지:
 * - 겹쳐 돌지 않는다. 한 바퀴가 늦어져도 다음 타이머가 또 시작하면 안 된다.
 * - 실패해도 죽지 않는다. 네이버가 한 번 막아도 다음 회차가 있다.
 * - 끌 수 있어야 한다. 이상하면 환경변수 하나로 멈춘다.
 */

import { readJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { PostingIndex } from "@/lib/types/github-data";
import { collectDueOutcomes, type CollectResult } from "./serp-collector";

const DEFAULT_INTERVAL_MINUTES = 20;
/** 배포 직후 몰리지 않게 조금 두고 시작한다. */
const FIRST_RUN_DELAY_MS = 90_000;
const DEFAULT_MAX_QUERIES = 12;

export interface CollectorRunSummary {
  startedAt: string;
  finishedAt: string;
  collected: number;
  ok: number;
  failed: number;
  found: number;
  /** 이번에 못 돈 것까지 합쳐 관측할 때가 된 글 수. 밀린 양이 보인다. */
  due: number;
  error?: string;
}

export interface CollectorState {
  enabled: boolean;
  reason?: string;
  intervalMinutes: number;
  maxQueries: number;
  startedAt?: string;
  running: boolean;
  lastRun?: CollectorRunSummary;
  runCount: number;
}

/**
 * 상태를 모듈 변수가 아니라 프로세스 전역에 둔다.
 *
 * Next는 instrumentation과 라우트 핸들러를 각각 다른 번들로 묶는다. 같은 파일을
 * import해도 사본이 갈라져서, 타이머는 instrumentation 쪽 사본에서 돌고 상태
 * 조회는 라우트 쪽 사본을 읽는다. 실제로 첫 배포에서 수집기가 도는데도 화면에는
 * "꺼짐"으로 나왔다. 개발 서버가 모듈을 다시 읽을 때 타이머가 겹쳐 쌓이는 것도
 * 같은 이유로 여기서 막힌다.
 */
const STATE_KEY = Symbol.for("blog-automation.outcome-scheduler.state");

interface SchedulerRuntime extends CollectorState {
  timerStarted: boolean;
}

function runtime(): SchedulerRuntime {
  const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: SchedulerRuntime };
  if (!globalState[STATE_KEY]) {
    globalState[STATE_KEY] = {
      enabled: false,
      intervalMinutes: DEFAULT_INTERVAL_MINUTES,
      maxQueries: DEFAULT_MAX_QUERIES,
      running: false,
      runCount: 0,
      timerStarted: false,
    };
  }
  return globalState[STATE_KEY];
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 런타임 타입이 브라우저 타이머로 잡히는 곳이 있어 좁혀서 부른다. */
function unref(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

export function getCollectorState(): CollectorState {
  const { timerStarted: _timerStarted, ...state } = runtime();
  return state;
}

/** 한 바퀴. 스케줄러도 이걸 부르고 수동 실행 API도 이걸 부른다. */
export async function runCollectorOnce(options?: {
  maxQueries?: number;
}): Promise<CollectorRunSummary> {
  const state = runtime();
  const startedAt = new Date().toISOString();
  state.running = true;

  try {
    const { data: index } = await readJsonFile<PostingIndex>(Paths.postingListIndex());
    const result = await collectDueOutcomes({
      posts: index.posts,
      maxQueries: options?.maxQueries ?? state.maxQueries,
    });

    const summary = summarize(startedAt, result.collected, result.due);
    state.lastRun = summary;
    state.runCount += 1;
    return summary;
  } catch (error) {
    const summary: CollectorRunSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      collected: 0,
      ok: 0,
      failed: 0,
      found: 0,
      due: 0,
      error: error instanceof Error ? error.message : String(error),
    };
    state.lastRun = summary;
    state.runCount += 1;
    return summary;
  } finally {
    state.running = false;
  }
}

function summarize(
  startedAt: string,
  collected: CollectResult[],
  due: number
): CollectorRunSummary {
  const ok = collected.filter((item) => item.status === "ok");
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    collected: collected.length,
    ok: ok.length,
    failed: collected.length - ok.length,
    found: ok.filter((item) => item.rank !== null).length,
    due,
  };
}

/**
 * 스케줄러를 켠다. 여러 번 불러도 타이머는 하나만 생긴다.
 *
 * 기본은 프로덕션에서만 돈다. 개발 서버에서까지 돌면 같은 저장소에 관측치를
 * 두 곳에서 쓰게 되고, 무엇이 언제 재진 건지 나중에 못 가린다.
 */
export function startOutcomeCollector(): CollectorState {
  const state = runtime();
  const mode = process.env.OUTCOME_COLLECTOR?.trim().toLowerCase();
  if (mode === "off") {
    state.enabled = false;
    state.reason = "OUTCOME_COLLECTOR=off";
    return getCollectorState();
  }
  if (process.env.NODE_ENV !== "production" && mode !== "on") {
    state.enabled = false;
    state.reason = "개발 환경에서는 돌지 않습니다 (OUTCOME_COLLECTOR=on으로 켤 수 있습니다).";
    return getCollectorState();
  }

  if (state.timerStarted) {
    state.enabled = true;
    return getCollectorState();
  }
  state.timerStarted = true;

  state.enabled = true;
  state.reason = undefined;
  state.startedAt = new Date().toISOString();
  state.intervalMinutes = positiveNumber(
    process.env.OUTCOME_COLLECT_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES
  );
  state.maxQueries = positiveNumber(process.env.OUTCOME_COLLECT_MAX_QUERIES, DEFAULT_MAX_QUERIES);

  const tick = () => {
    // 겹쳐 돌지 않는다. 앞 바퀴가 아직이면 이번 회차는 건너뛴다.
    if (state.running) return;
    void runCollectorOnce().then((summary) => {
      if (summary.error) {
        console.error(`[outcome] 수집 실패: ${summary.error}`);
        return;
      }
      console.log(
        `[outcome] ${summary.collected}건 관측 (노출 ${summary.found} · 실패 ${summary.failed} · 대기 ${summary.due})`
      );
    });
  };

  // 타이머가 프로세스를 붙잡지 않게 한다. 서버가 내려가면 같이 끝나야 한다.
  unref(setTimeout(tick, FIRST_RUN_DELAY_MS));
  unref(setInterval(tick, state.intervalMinutes * 60_000));

  console.log(
    `[outcome] 수집기 시작 — ${state.intervalMinutes}분마다 최대 ${state.maxQueries}건`
  );
  return getCollectorState();
}
