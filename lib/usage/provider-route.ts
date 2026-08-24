/**
 * provider-route — 각 단계가 실제로 어느 공급자로 돌았는지 기록한다.
 *
 * 왜 필요한가 (2026-08-24 사고):
 * 7월 13일에 Anthropic 크레딧이 소진됐는데 6주 동안 아무도 몰랐다. 코드가
 * 크레딧 부족을 정확히 감지하고 OpenAI로 복구한 뒤 성공 처리했기 때문이다.
 * 흔적은 서버 로그의 console.warn과 진행 로그의 "복구했습니다" 한 줄뿐이었고,
 * 파이프라인은 멀쩡히 글을 뽑아냈다.
 *
 * 그래서 "어느 공급자로 돌았나"만으로는 부족하다. OpenAI로 간 게
 *   - 원래 1순위라서(primary)인지
 *   - Anthropic이 죽어서 떠밀려 간(fallback) 것인지
 * 를 갈라야 한다. 앞은 정상이고 뒤는 사고다.
 *
 * 메모리에만 둔다. account-health와 같은 이유로, 재시작 뒤 낡은 경고가
 * 남아 있으면 거짓말이 된다.
 */

import type { Provider } from "./pricing";

export type RouteReason =
  /** 설정상 이 공급자가 1순위다. 정상. */
  | "primary"
  /** Anthropic이 실패해 떠밀려 왔다. 조사 대상. */
  | "anthropic_failed"
  /** Anthropic 크레딧 부족으로 떠밀려 왔다. 충전 필요. */
  | "anthropic_credit"
  /** 폴백까지 실패해 로컬 안전 전략으로 내려갔다. */
  | "all_failed";

export interface ProviderRoute {
  stage: string;
  provider: Provider | "local";
  reason: RouteReason;
  at: string;
  model?: string;
  detail?: string;
}

const MAX_HISTORY = 30;

let history: ProviderRoute[] = [];

export function noteProviderRoute(route: Omit<ProviderRoute, "at"> & { at?: string }): void {
  const entry: ProviderRoute = { ...route, at: route.at ?? new Date().toISOString() };
  history = [...history, entry].slice(-MAX_HISTORY);
}

export function getProviderRoutes(): ProviderRoute[] {
  return history;
}

/** 단계별 최신 경로. 화면에 "지금 무엇이 어디로 도는지"를 보여주는 데 쓴다. */
export function latestRouteByStage(): ProviderRoute[] {
  const byStage = new Map<string, ProviderRoute>();
  for (const route of history) byStage.set(route.stage, route);
  return [...byStage.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export interface RouteHealth {
  /** 떠밀려서 폴백된 단계가 있는가. 있으면 화면에 경고를 띄운다. */
  degraded: boolean;
  /** 크레딧 부족이 원인인 폴백이 있는가. */
  creditFallback: boolean;
  /** 폴백된 단계 이름들. */
  degradedStages: string[];
  /** 최근 실제로 쓰인 공급자들. */
  activeProviders: Array<Provider | "local">;
}

const FALLBACK_REASONS: RouteReason[] = ["anthropic_failed", "anthropic_credit", "all_failed"];

export function summarizeRoutes(): RouteHealth {
  const latest = latestRouteByStage();
  const degradedRoutes = latest.filter((r) => FALLBACK_REASONS.includes(r.reason));
  return {
    degraded: degradedRoutes.length > 0,
    creditFallback: degradedRoutes.some((r) => r.reason === "anthropic_credit"),
    degradedStages: degradedRoutes.map((r) => r.stage),
    activeProviders: [...new Set(latest.map((r) => r.provider))],
  };
}

/** 테스트용. 프로덕션 코드에서 부르지 않는다. */
export function resetProviderRoutes(): void {
  history = [];
}
