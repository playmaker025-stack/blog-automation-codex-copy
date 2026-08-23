/**
 * pricing — Anthropic 응답의 usage를 USD로 환산하는 순수 로직.
 *
 * 왜 자체 집계인가:
 * Anthropic은 잔액(credit balance) 조회 API를 제공하지 않는다. Admin API에도
 * organizations/{me,users,invites,workspaces,api_keys,usage_report,cost_report}만
 * 있고 balance는 없다. 게다가 usage_report/cost_report는 Admin 키가 필요한데
 * 문서상 "The Admin API is unavailable for individual accounts"라 개인 계정은
 * 그 두 개도 못 쓴다. 남는 방법은 앱이 자기 호출의 usage를 직접 세는 것뿐이다.
 *
 * 단가 출처: platform.claude.com/docs/en/about-claude/pricing (2026-08-23 확인).
 * 단가가 바뀌면 이 표만 고치면 된다.
 */

/** USD per 1M tokens. */
export interface ModelRate {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

/**
 * SDK 응답의 usage 필드. 버전에 따라 cache_creation 세부 분해가 있기도 하고
 * 없기도 해서 전부 optional로 둔다.
 */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

const MTOK = 1_000_000;

/** 정규화된 모델 ID → 단가. 날짜 접미사는 normalizeModelId가 떼고 들어온다. */
export const MODEL_RATES: Record<string, ModelRate> = {
  "claude-fable-5": { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 },
  "claude-mythos-5": { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 },
  "claude-opus-5": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-opus-4-7": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-opus-4-6": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-opus-4-5": { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  "claude-sonnet-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  "claude-sonnet-4-6": { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
  "claude-sonnet-4-5": { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
  "claude-haiku-4-5": { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
};

/**
 * 모르는 모델의 단가. Opus 등급으로 잡는다.
 *
 * 0으로 두면 게이지가 "아직 많이 남았다"고 거짓말을 한다. 잔액 추정에서
 * 과소 청구는 과대 청구보다 위험하다 — 남았다고 믿고 돌렸다가 파이프라인이
 * 중간에 죽는 쪽이 더 아프다. 그래서 비싼 쪽으로 틀린다.
 */
export const FALLBACK_RATE: ModelRate = {
  input: 5,
  cacheWrite5m: 6.25,
  cacheWrite1h: 10,
  cacheRead: 0.5,
  output: 25,
};

/**
 * "claude-haiku-4-5-20251001" → "claude-haiku-4-5"
 *
 * 앱은 MODELS.haiku에 날짜 붙은 ID를 쓰고 응답의 response.model도 날짜가 붙어
 * 돌아온다. 단가표는 별칭 기준이라 접미사를 뗀다.
 */
export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/-\d{8}$/, "");
}

export function rateFor(model: string): { rate: ModelRate; known: boolean } {
  const rate = MODEL_RATES[normalizeModelId(model)];
  return rate ? { rate, known: true } : { rate: FALLBACK_RATE, known: false };
}

export interface PricedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number;
  /** false면 단가표에 없는 모델이라 FALLBACK_RATE로 계산했다는 뜻. */
  priced: boolean;
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

/**
 * usage 한 건을 USD로 환산한다.
 *
 * cache_creation 세부 분해(5m/1h)가 있으면 그걸 쓰고, 없으면 전량 5m으로 본다.
 * 이 앱은 TTL을 지정하지 않아 기본값 5m이라 그 가정이 맞다. 1h를 쓰기 시작하면
 * SDK가 분해 필드를 채워주므로 이 코드는 그대로 둬도 된다.
 */
export function priceUsage(model: string, usage: TokenUsage | null | undefined): PricedUsage {
  const { rate, known } = rateFor(model);
  const u = usage ?? {};

  const inputTokens = num(u.input_tokens);
  const outputTokens = num(u.output_tokens);
  const cacheReadTokens = num(u.cache_read_input_tokens);

  const detailed5m = num(u.cache_creation?.ephemeral_5m_input_tokens);
  const detailed1h = num(u.cache_creation?.ephemeral_1h_input_tokens);
  const hasDetail = detailed5m > 0 || detailed1h > 0;
  const write5m = hasDetail ? detailed5m : num(u.cache_creation_input_tokens);
  const write1h = hasDetail ? detailed1h : 0;

  const usd =
    (inputTokens * rate.input +
      outputTokens * rate.output +
      cacheReadTokens * rate.cacheRead +
      write5m * rate.cacheWrite5m +
      write1h * rate.cacheWrite1h) /
    MTOK;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: write5m + write1h,
    usd,
    priced: known,
  };
}

/**
 * 캐시로 아낀 금액. 캐시 읽기 토큰을 정가로 냈다면 얼마였을지와의 차액이다.
 * 프롬프트 캐싱이 실제로 돈을 아끼고 있는지 UI에서 보여주려고 쓴다.
 */
export function cacheSavingsUsd(model: string, usage: TokenUsage | null | undefined): number {
  const { rate } = rateFor(model);
  const cacheReadTokens = num(usage?.cache_read_input_tokens);
  return (cacheReadTokens * (rate.input - rate.cacheRead)) / MTOK;
}
