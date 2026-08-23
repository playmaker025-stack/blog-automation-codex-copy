import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeModelId,
  priceUsage,
  rateFor,
  cacheSavingsUsd,
  FALLBACK_RATE,
} from "../../lib/usage/pricing.ts";
import {
  emptyLedger,
  kstDateKey,
  recordSamples,
  pruneLedger,
  markBalance,
  latestMark,
  summarize,
  usageLevel,
} from "../../lib/usage/ledger.ts";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ~${expected}, got ${actual}`
  );

const sample = (overrides = {}) => ({
  at: "2026-08-23T01:00:00Z",
  model: "claude-haiku-4-5",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  usd: 0,
  priced: true,
  ...overrides,
});

// Anthropic이 잔액 API를 주지 않아 앱이 직접 센다. 단가가 틀리면 게이지 전체가
// 거짓말이 되므로 공식 단가표(2026-08-23 확인)에 못 박아 둔다.
describe("PR30 단가 환산", () => {
  test("모델 ID의 날짜 접미사를 뗀다", () => {
    assert.equal(normalizeModelId("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
    assert.equal(normalizeModelId("claude-sonnet-4-6"), "claude-sonnet-4-6");
    assert.equal(normalizeModelId("  Claude-Opus-4-6  "), "claude-opus-4-6");
  });

  test("날짜 붙은 ID도 단가표에서 찾는다", () => {
    const { rate, known } = rateFor("claude-haiku-4-5-20251001");
    assert.equal(known, true);
    assert.equal(rate.input, 1);
    assert.equal(rate.output, 5);
  });

  test("haiku 100만 입력 토큰은 $1", () => {
    const p = priceUsage("claude-haiku-4-5-20251001", { input_tokens: 1_000_000 });
    near(p.usd, 1);
    assert.equal(p.priced, true);
  });

  test("출력 토큰이 입력보다 5배 비싸다", () => {
    const inp = priceUsage("claude-haiku-4-5", { input_tokens: 1_000_000 }).usd;
    const out = priceUsage("claude-haiku-4-5", { output_tokens: 1_000_000 }).usd;
    near(out, inp * 5);
  });

  test("캐시 읽기는 정가의 1/10, 캐시 쓰기는 1.25배", () => {
    const read = priceUsage("claude-sonnet-4-6", { cache_read_input_tokens: 1_000_000 });
    const write = priceUsage("claude-sonnet-4-6", { cache_creation_input_tokens: 1_000_000 });
    near(read.usd, 0.3);
    near(write.usd, 3.75);
  });

  test("cache_creation 세부 분해가 있으면 5m/1h를 구분해 계산한다", () => {
    const p = priceUsage("claude-sonnet-4-6", {
      cache_creation_input_tokens: 1_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 400_000,
        ephemeral_1h_input_tokens: 600_000,
      },
    });
    // 0.4M * $3.75 + 0.6M * $6 = 1.5 + 3.6
    near(p.usd, 5.1);
    assert.equal(p.cacheWriteTokens, 1_000_000);
  });

  test("세부 분해가 없으면 전량 5m으로 본다 (앱 기본 TTL)", () => {
    const p = priceUsage("claude-sonnet-4-6", { cache_creation_input_tokens: 1_000_000 });
    near(p.usd, 3.75);
  });

  // 0으로 계산하면 게이지가 "아직 남았다"고 거짓말한다. 비싼 쪽으로 틀려야 안전하다.
  test("모르는 모델은 0이 아니라 Opus 등급으로 계산하고 priced=false로 표시한다", () => {
    const p = priceUsage("claude-something-new-9", { input_tokens: 1_000_000 });
    assert.equal(p.priced, false);
    near(p.usd, FALLBACK_RATE.input);
    assert.ok(p.usd > 0, "모르는 모델을 공짜로 계산하면 안 된다");
  });

  test("usage가 없거나 비면 0원", () => {
    near(priceUsage("claude-haiku-4-5", null).usd, 0);
    near(priceUsage("claude-haiku-4-5", {}).usd, 0);
  });

  test("음수/NaN 토큰은 0으로 처리한다", () => {
    const p = priceUsage("claude-haiku-4-5", {
      input_tokens: -500,
      output_tokens: Number.NaN,
    });
    near(p.usd, 0);
  });

  test("캐시 절감액은 정가와 캐시가의 차액이다", () => {
    near(cacheSavingsUsd("claude-sonnet-4-6", { cache_read_input_tokens: 1_000_000 }), 2.7);
  });
});

describe("PR30 KST 날짜 경계", () => {
  // 서버는 UTC(Railway), 사용자는 한국. UTC로 자르면 오전 9시에 날이 바뀐다.
  test("UTC 자정 직전도 한국 날짜로 잡는다", () => {
    assert.equal(kstDateKey("2026-08-22T23:00:00Z"), "2026-08-23");
  });

  test("KST 하루의 시작과 끝", () => {
    assert.equal(kstDateKey("2026-08-22T15:00:00Z"), "2026-08-23");
    assert.equal(kstDateKey("2026-08-23T14:59:59Z"), "2026-08-23");
    assert.equal(kstDateKey("2026-08-23T15:00:00Z"), "2026-08-24");
  });

  test("잘못된 시각은 던지지 않는다", () => {
    assert.equal(kstDateKey("nonsense"), "1970-01-01");
  });
});

describe("PR30 장부 누적", () => {
  test("표본을 합치고 원본 장부는 건드리지 않는다", () => {
    const base = emptyLedger();
    const next = recordSamples(base, [sample({ usd: 1.5, inputTokens: 100 })]);
    near(next.lifetimeUsd, 1.5);
    assert.equal(next.lifetimeCalls, 1);
    near(base.lifetimeUsd, 0);
    assert.equal(base.days.length, 0);
  });

  test("같은 날 같은 모델은 한 버킷에 쌓인다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ usd: 1, inputTokens: 10 })]);
    l = recordSamples(l, [sample({ usd: 2, inputTokens: 20 })]);
    assert.equal(l.days.length, 1);
    const bucket = l.days[0].models["claude-haiku-4-5"];
    assert.equal(bucket.calls, 2);
    assert.equal(bucket.inputTokens, 30);
    near(bucket.usd, 3);
    near(l.lifetimeUsd, 3);
  });

  test("단가 미상이 한 번이라도 섞이면 버킷에 표시가 남는다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ usd: 1, priced: true })]);
    l = recordSamples(l, [sample({ usd: 1, priced: false })]);
    assert.equal(l.days[0].models["claude-haiku-4-5"].unpriced, true);
    assert.equal(summarize(l, { now: new Date("2026-08-23T05:00:00Z") }).hasUnpriced, true);
  });

  test("날짜는 오름차순으로 정렬된다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ at: "2026-08-25T01:00:00Z", usd: 1 })]);
    l = recordSamples(l, [sample({ at: "2026-08-21T01:00:00Z", usd: 1 })]);
    assert.deepEqual(
      l.days.map((d) => d.date),
      ["2026-08-21", "2026-08-25"]
    );
  });
});

describe("PR30 잔액 스냅샷", () => {
  test("스냅샷은 그 시점 누적 지출을 기준점으로 저장한다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ usd: 2 })]);
    l = markBalance(l, 20);
    near(latestMark(l).spentAtMarkUsd, 2);
    near(latestMark(l).balanceUsd, 20);
  });

  test("추정 잔액 = 스냅샷 잔액 - 이후 지출", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ usd: 2 })]);
    l = markBalance(l, 20);
    l = recordSamples(l, [sample({ usd: 3 })]);

    const s = summarize(l, { now: new Date("2026-08-23T05:00:00Z") });
    near(s.spentSinceMarkUsd, 3);
    near(s.estimatedRemainingUsd, 17);
    near(s.lifetimeUsd, 5);
  });

  // 이게 "충전액 누적" 방식 대신 스냅샷을 고른 이유다. 어긋나도 재동기화된다.
  test("다시 찍으면 그 값이 새 기준이 된다 (오차 재동기화)", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ usd: 2 })]);
    l = markBalance(l, 20);
    l = recordSamples(l, [sample({ usd: 3 })]);
    // 콘솔에 실제로는 $12만 남아 있었다 — 추정이 $17로 어긋나 있었다.
    l = markBalance(l, 12);
    l = recordSamples(l, [sample({ usd: 1 })]);

    const s = summarize(l, { now: new Date("2026-08-23T05:00:00Z") });
    near(s.spentSinceMarkUsd, 1);
    near(s.estimatedRemainingUsd, 11);
  });

  test("스냅샷이 없으면 추정 잔액은 null이다", () => {
    const s = summarize(recordSamples(emptyLedger(), [sample({ usd: 1 })]));
    assert.equal(s.estimatedRemainingUsd, null);
    assert.equal(s.daysLeft, null);
    assert.equal(usageLevel(s), "unknown");
  });

  // 일별 버킷을 지워도 잔액이 틀어지면 안 된다 — lifetimeUsd가 따로 사는 이유.
  test("오래된 일별 버킷을 정리해도 추정 잔액은 그대로다", () => {
    let l = emptyLedger();
    for (let d = 1; d <= 10; d++) {
      const day = String(d).padStart(2, "0");
      l = recordSamples(l, [sample({ at: `2026-08-${day}T01:00:00Z`, usd: 1 })]);
    }
    l = markBalance(l, 50);
    l = recordSamples(l, [sample({ at: "2026-08-20T01:00:00Z", usd: 4 })]);

    const before = summarize(l, { now: new Date("2026-08-20T05:00:00Z") });
    const pruned = pruneLedger(l, 3);

    assert.equal(pruned.days.length, 3);
    near(pruned.lifetimeUsd, 14);
    const after = summarize(pruned, { now: new Date("2026-08-20T05:00:00Z") });
    near(after.estimatedRemainingUsd, before.estimatedRemainingUsd);
    near(after.estimatedRemainingUsd, 46);
  });

  test("스냅샷 이력은 20개까지만 남는다", () => {
    let l = emptyLedger();
    for (let i = 0; i < 25; i++) {
      l = markBalance(l, i, { at: `2026-08-01T00:${String(i).padStart(2, "0")}:00Z` });
    }
    assert.equal(l.balanceMarks.length, 20);
    near(latestMark(l).balanceUsd, 24);
  });
});

describe("PR30 요약 집계", () => {
  const now = new Date("2026-08-23T05:00:00Z"); // KST 2026-08-23 14:00

  test("오늘/이번 달을 KST 기준으로 나눈다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ at: "2026-08-22T23:30:00Z", usd: 1 })]); // KST 08-23
    l = recordSamples(l, [sample({ at: "2026-08-20T01:00:00Z", usd: 2 })]); // KST 08-20
    l = recordSamples(l, [sample({ at: "2026-07-15T01:00:00Z", usd: 5 })]); // 지난달

    const s = summarize(l, { now });
    near(s.todayUsd, 1);
    near(s.monthUsd, 3);
    near(s.lifetimeUsd, 8);
  });

  // 안 돌린 날까지 나누면 일평균이 낮게 나와 "아직 여유"라고 오판한다.
  test("일평균은 실제로 돌린 날만 나눈다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ at: "2026-08-21T01:00:00Z", usd: 3 })]);
    l = recordSamples(l, [sample({ at: "2026-08-23T01:00:00Z", usd: 3 })]);

    const s = summarize(l, { now });
    near(s.dailyAvgUsd, 3); // 6 / 2일, 7로 나누지 않는다
  });

  test("모델별 지출은 큰 순으로 정렬된다", () => {
    let l = emptyLedger();
    l = recordSamples(l, [sample({ model: "claude-haiku-4-5", usd: 1 })]);
    l = recordSamples(l, [sample({ model: "claude-sonnet-4-6", usd: 5 })]);

    const s = summarize(l, { now });
    assert.deepEqual(
      s.byModel.map((m) => m.model),
      ["claude-sonnet-4-6", "claude-haiku-4-5"]
    );
  });
});

describe("PR30 경보 등급", () => {
  const now = new Date("2026-08-23T05:00:00Z");

  // 금액이 아니라 남은 일수로 판정한다. $5가 많은지는 사용 속도에 달렸다.
  const build = (balance, dailyUsd, spentAfterMark) => {
    let l = emptyLedger();
    l = markBalance(l, balance);
    for (let d = 17; d <= 23; d++) {
      const day = String(d).padStart(2, "0");
      l = recordSamples(l, [sample({ at: `2026-08-${day}T01:00:00Z`, usd: dailyUsd })]);
    }
    if (spentAfterMark) {
      l = recordSamples(l, [sample({ at: "2026-08-23T02:00:00Z", usd: spentAfterMark })]);
    }
    return summarize(l, { now });
  };

  test("하루 $1씩 쓰는데 $20 남으면 여유", () => {
    assert.equal(usageLevel(build(27, 1)), "healthy");
  });

  test("이틀치 미만이면 critical", () => {
    const s = build(8, 1); // 7일치 $7 소진 → 잔액 $1, 일평균 $1
    near(s.estimatedRemainingUsd, 1);
    assert.equal(usageLevel(s), "critical");
  });

  test("일주일치 미만이면 low", () => {
    const s = build(12, 1); // 잔액 $5, 일평균 $1 → 5일
    near(s.estimatedRemainingUsd, 5);
    assert.equal(usageLevel(s), "low");
  });

  test("다 쓰면 empty이고 남은 일수는 0", () => {
    const s = build(7, 1); // 정확히 소진
    assert.equal(usageLevel(s), "empty");
    assert.equal(s.daysLeft, 0);
  });

  test("초과 지출도 empty로 잡는다 (음수 잔액)", () => {
    const s = build(5, 1); // $7 썼는데 $5만 있었다
    assert.ok(s.estimatedRemainingUsd < 0);
    assert.equal(usageLevel(s), "empty");
  });

  test("사용 이력이 없으면 금액만으로 판정한다", () => {
    const s = summarize(markBalance(emptyLedger(), 1), { now });
    assert.equal(s.daysLeft, null);
    assert.equal(usageLevel(s), "critical");
  });
});
