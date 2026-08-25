import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyLedger,
  recordSamples,
  markBalance,
  summarize,
  usageLevel,
  pruneLedger,
} from "../../lib/usage/ledger.ts";

const sample = (model, usd, at = "2026-08-25T01:00:00Z") => ({
  at,
  model,
  calls: 1,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  usd,
  priced: true,
});

const NOW = new Date("2026-08-25T05:00:00Z");

// 실측(2026-08-25): 스냅샷 $5(Anthropic 콘솔 기준)를 찍은 뒤 OpenAI로만 60건이
// 나갔는데, 게이지는 그 지출만큼 Anthropic 잔액이 줄어든 것으로 표시했다.
describe("PR36 공급자별 잔액", () => {
  test("Anthropic 잔액이 OpenAI 지출로 줄지 않는다", () => {
    let ledger = markBalance(emptyLedger(), 5, { provider: "anthropic" });
    ledger = recordSamples(ledger, [sample("gpt-4.1-mini", 0.5)]);

    const summary = summarize(ledger, { now: NOW });
    assert.equal(summary.markedProvider, "anthropic");
    assert.equal(summary.spentSinceMarkUsd, 0);
    assert.equal(summary.estimatedRemainingUsd, 5);
  });

  test("같은 공급자 지출은 정상적으로 차감된다", () => {
    let ledger = markBalance(emptyLedger(), 5, { provider: "anthropic" });
    ledger = recordSamples(ledger, [sample("claude-haiku-4-5", 1.5)]);

    const summary = summarize(ledger, { now: NOW });
    assert.equal(summary.spentSinceMarkUsd, 1.5);
    assert.equal(summary.estimatedRemainingUsd, 3.5);
  });

  // 스냅샷 이전 지출이 딸려 들어오면 안 된다. 일별 버킷을 훑던 초안이 이걸 틀렸다.
  test("스냅샷 이전 지출은 차감하지 않는다", () => {
    let ledger = recordSamples(emptyLedger(), [sample("claude-haiku-4-5", 2)]);
    ledger = markBalance(ledger, 5, { provider: "anthropic" });
    ledger = recordSamples(ledger, [sample("claude-haiku-4-5", 1)]);

    assert.equal(summarize(ledger, { now: NOW }).estimatedRemainingUsd, 4);
  });

  test("오래된 버킷을 정리해도 잔액이 그대로다", () => {
    let ledger = markBalance(emptyLedger(), 5, { provider: "anthropic" });
    for (let day = 1; day <= 100; day += 1) {
      const date = `2026-05-${String(day).padStart(2, "0")}T01:00:00Z`;
      ledger = recordSamples(ledger, [sample("claude-haiku-4-5", 0.01, date)]);
    }
    const before = summarize(ledger, { now: NOW }).estimatedRemainingUsd;
    const after = summarize(pruneLedger(ledger, 10), { now: NOW }).estimatedRemainingUsd;
    assert.equal(after, before);
  });
});

// 거절된 호출은 요금이 0원이라 "차단됨"과 "안 씀"이 지출 0으로 똑같이 보인다.
describe("PR36 조용한 공급자 감지", () => {
  test("다른 공급자만 돌면 정상이라고 하지 않는다", () => {
    let ledger = markBalance(emptyLedger(), 5, { provider: "anthropic" });
    ledger = recordSamples(ledger, [sample("gpt-4.1-mini", 0.5)]);

    const summary = summarize(ledger, { now: NOW });
    assert.equal(summary.markedProviderCalls, 0);
    assert.equal(summary.markedProviderSilent, true);
    assert.equal(usageLevel(summary), "silent");
  });

  test("그 공급자가 실제로 돌면 조용하다고 하지 않는다", () => {
    let ledger = markBalance(emptyLedger(), 5, { provider: "anthropic" });
    ledger = recordSamples(ledger, [
      sample("claude-haiku-4-5", 0.1),
      sample("gpt-4.1-mini", 0.5),
    ]);

    const summary = summarize(ledger, { now: NOW });
    assert.equal(summary.markedProviderSilent, false);
    assert.notEqual(usageLevel(summary), "silent");
  });

  // 아무것도 안 돌린 상태는 장애가 아니다. 겁주면 배너를 무시하게 된다.
  test("아무 호출도 없으면 조용하다고 하지 않는다", () => {
    const summary = summarize(markBalance(emptyLedger(), 5, { provider: "anthropic" }), {
      now: NOW,
    });
    assert.equal(summary.markedProviderSilent, false);
  });

  test("스냅샷이 없으면 판정하지 않는다", () => {
    const ledger = recordSamples(emptyLedger(), [sample("gpt-4.1-mini", 0.5)]);
    const summary = summarize(ledger, { now: NOW });
    assert.equal(summary.markedProvider, null);
    assert.equal(summary.markedProviderSilent, false);
    assert.equal(usageLevel(summary), "unknown");
  });
});
