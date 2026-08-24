import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  providerOf,
  priceUsage,
  openAIUsageToTokenUsage,
  extractOpenAIUsage,
} from "../../lib/usage/pricing.ts";
import { emptyLedger, recordSamples, summarize } from "../../lib/usage/ledger.ts";
import {
  noteProviderRoute,
  latestRouteByStage,
  summarizeRoutes,
  resetProviderRoutes,
} from "../../lib/usage/provider-route.ts";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ~${expected}, got ${actual}`
  );

const sample = (overrides = {}) => ({
  at: "2026-08-24T01:00:00Z",
  model: "claude-haiku-4-5",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  usd: 0,
  priced: true,
  ...overrides,
});

describe("PR31 공급자 판별", () => {
  test("모델 이름으로 공급자를 가른다", () => {
    assert.equal(providerOf("claude-sonnet-4-6"), "anthropic");
    assert.equal(providerOf("claude-haiku-4-5-20251001"), "anthropic");
    assert.equal(providerOf("gpt-5.4"), "openai");
    assert.equal(providerOf("gpt-4.1-mini"), "openai");
    assert.equal(providerOf("o3-mini"), "openai");
    assert.equal(providerOf("llama-3"), "unknown");
    assert.equal(providerOf(""), "unknown");
  });
});

describe("PR31 OpenAI 단가", () => {
  test("gpt-5.4 입력 100만 토큰은 $2.50, 출력은 $15", () => {
    near(priceUsage("gpt-5.4", { input_tokens: 1_000_000 }).usd, 2.5);
    near(priceUsage("gpt-5.4", { output_tokens: 1_000_000 }).usd, 15);
  });

  test("gpt-4.1-mini 단가", () => {
    near(priceUsage("gpt-4.1-mini", { input_tokens: 1_000_000 }).usd, 0.4);
    near(priceUsage("gpt-4.1-mini", { output_tokens: 1_000_000 }).usd, 1.6);
  });

  // OpenAI는 캐시 쓰기에 웃돈이 없다. Anthropic 표를 그대로 베끼면 안 된다.
  test("OpenAI 캐시 쓰기는 정가 입력과 같다", () => {
    const write = priceUsage("gpt-5.4", { cache_creation_input_tokens: 1_000_000 }).usd;
    const input = priceUsage("gpt-5.4", { input_tokens: 1_000_000 }).usd;
    near(write, input);
  });

  test("OpenAI 캐시 읽기는 정가의 1/10", () => {
    near(priceUsage("gpt-5.4", { cache_read_input_tokens: 1_000_000 }).usd, 0.25);
  });
});

// 두 API의 input_tokens 정의가 다르다. 이걸 놓치면 OpenAI 비용이 부풀려진다.
describe("PR31 OpenAI usage 변환", () => {
  test("캐시된 토큰을 input_tokens에서 빼낸다", () => {
    const converted = openAIUsageToTokenUsage({
      input_tokens: 1000,
      output_tokens: 200,
      input_tokens_details: { cached_tokens: 400 },
    });
    assert.equal(converted.input_tokens, 600);
    assert.equal(converted.cache_read_input_tokens, 400);
    assert.equal(converted.output_tokens, 200);
  });

  test("변환하지 않으면 과다 청구된다 (회귀 방지)", () => {
    const raw = { input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 800_000 } };
    const naive = priceUsage("gpt-4.1-mini", { input_tokens: raw.input_tokens }).usd;
    const correct = priceUsage("gpt-4.1-mini", openAIUsageToTokenUsage(raw)).usd;
    // 0.2M * $0.40 + 0.8M * $0.10 = 0.08 + 0.08
    near(correct, 0.16);
    near(naive, 0.4);
    assert.ok(correct < naive, "캐시분을 빼지 않으면 비싸게 잡힌다");
  });

  test("캐시 토큰이 입력보다 크다고 보고돼도 음수가 되지 않는다", () => {
    const converted = openAIUsageToTokenUsage({
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 999 },
    });
    assert.equal(converted.input_tokens, 0);
    assert.equal(converted.cache_read_input_tokens, 100);
  });

  test("usage가 없어도 던지지 않는다", () => {
    assert.equal(openAIUsageToTokenUsage(null).input_tokens, 0);
    assert.equal(extractOpenAIUsage(null), null);
    assert.equal(extractOpenAIUsage({}), null);
    assert.equal(extractOpenAIUsage("nonsense"), null);
    assert.deepEqual(extractOpenAIUsage({ usage: { input_tokens: 5 } }), { input_tokens: 5 });
  });
});

describe("PR31 공급자별 집계", () => {
  test("Anthropic과 OpenAI 지출을 나눠 센다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ model: "claude-sonnet-4-6", usd: 3 })]);
    l = recordSamples(l, [sample({ model: "gpt-5.4", usd: 5 })]);
    l = recordSamples(l, [sample({ model: "gpt-4.1-mini", usd: 1 })]);

    const s = summarize(l, { now: new Date("2026-08-24T05:00:00Z") });
    const byProvider = Object.fromEntries(s.byProvider.map((p) => [p.provider, p.usd]));
    near(byProvider.openai, 6);
    near(byProvider.anthropic, 3);
    // 지출 큰 순 정렬
    assert.equal(s.byProvider[0].provider, "openai");
  });

  test("호출 수도 공급자별로 누적된다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ model: "gpt-5.4", usd: 1 })]);
    l = recordSamples(l, [sample({ model: "gpt-5.4", usd: 1 })]);
    const s = summarize(l, { now: new Date("2026-08-24T05:00:00Z") });
    assert.equal(s.byProvider[0].calls, 2);
  });
});

// 7월 사고의 핵심: OpenAI로 도는 것 자체는 정상일 수도, 사고일 수도 있다.
describe("PR31 실행 경로 판정", () => {
  beforeEach(() => resetProviderRoutes());

  test("1순위 실행만 있으면 정상으로 본다", () => {
    noteProviderRoute({ stage: "master-writer", provider: "openai", reason: "primary" });
    noteProviderRoute({ stage: "topic-generator", provider: "openai", reason: "primary" });

    const health = summarizeRoutes();
    assert.equal(health.degraded, false);
    assert.equal(health.creditFallback, false);
    assert.deepEqual(health.activeProviders, ["openai"]);
  });

  test("떠밀린 폴백은 같은 OpenAI라도 degraded로 잡는다", () => {
    noteProviderRoute({ stage: "master-writer", provider: "openai", reason: "primary" });
    noteProviderRoute({ stage: "strategy-planner", provider: "openai", reason: "anthropic_failed" });

    const health = summarizeRoutes();
    assert.equal(health.degraded, true);
    assert.deepEqual(health.degradedStages, ["strategy-planner"]);
  });

  test("크레딧 부족 폴백은 따로 표시한다", () => {
    noteProviderRoute({ stage: "strategy-planner", provider: "openai", reason: "anthropic_credit" });
    const health = summarizeRoutes();
    assert.equal(health.creditFallback, true);
    assert.equal(health.degraded, true);
  });

  test("전부 실패하면 로컬 폴백으로 잡힌다", () => {
    noteProviderRoute({ stage: "strategy-planner", provider: "local", reason: "all_failed" });
    const health = summarizeRoutes();
    assert.equal(health.degraded, true);
    assert.ok(health.activeProviders.includes("local"));
  });

  // 복구되면 경고가 사라져야 한다. 안 그러면 낡은 배너가 계속 남는다.
  test("같은 단계는 최신 경로만 반영한다", () => {
    noteProviderRoute({
      stage: "strategy-planner",
      provider: "openai",
      reason: "anthropic_credit",
      at: "2026-08-24T01:00:00Z",
    });
    assert.equal(summarizeRoutes().degraded, true);

    noteProviderRoute({
      stage: "strategy-planner",
      provider: "anthropic",
      reason: "primary",
      at: "2026-08-24T02:00:00Z",
    });

    const health = summarizeRoutes();
    assert.equal(health.degraded, false);
    assert.equal(latestRouteByStage().length, 1);
  });

  test("이력은 무한정 쌓이지 않는다", () => {
    for (let i = 0; i < 50; i++) {
      noteProviderRoute({ stage: `stage-${i}`, provider: "openai", reason: "primary" });
    }
    assert.ok(latestRouteByStage().length <= 30);
  });
});
