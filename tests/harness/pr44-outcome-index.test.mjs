import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  applyObservationsToIndex,
  dueCheckpoint,
  dueCheckpointFromAges,
  emptyOutcomeIndex,
  indexEntryFromObservations,
  okSerpAges,
  ONGOING_INTERVAL_HOURS,
} from "../../lib/agents/post-outcome.ts";

const HOUR = 3_600_000;
const at = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const NOW = new Date().toISOString();

const observation = (overrides = {}) => ({
  schemaVersion: 1,
  observationId: overrides.observationId ?? "20260830120000_serp_test",
  postId: overrides.postId ?? "post-1",
  source: overrides.source ?? "serp",
  capturedAt: overrides.capturedAt ?? NOW,
  postAgeHours: overrides.postAgeHours ?? 0,
  status: overrides.status ?? "ok",
  collector: { method: "crawler", version: "1" },
  ...(overrides.serp ? { serp: overrides.serp } : {}),
  ...(overrides.note ? { note: overrides.note } : {}),
});

describe("PR44 관측 색인", () => {
  test("성공한 serp 관측 시점만 담는다", () => {
    const entry = indexEntryFromObservations([
      observation({ postAgeHours: 0 }),
      observation({ postAgeHours: 5, status: "request_failed" }),
      observation({ postAgeHours: 9, source: "naver_stats" }),
      observation({ postAgeHours: 170 }),
    ]);

    assert.deepEqual(entry.okAgeHours, [0, 170]);
    assert.equal(entry.total, 4);
  });

  test("같은 시점이 두 번 들어와도 부풀지 않는다", () => {
    const first = applyObservationsToIndex(emptyOutcomeIndex(), [observation({ postAgeHours: 0 })]);
    const second = applyObservationsToIndex(first, [observation({ postAgeHours: 0 })]);

    assert.deepEqual(second.posts["post-1"].okAgeHours, [0]);
    // 관측 자체는 두 번 있었다는 사실은 남긴다.
    assert.equal(second.posts["post-1"].total, 2);
  });

  test("실패 관측은 시점을 채우지 않는다 — 아직 못 잰 것이다", () => {
    const index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ postAgeHours: 3, status: "request_failed" }),
    ]);

    assert.deepEqual(index.posts["post-1"].okAgeHours, []);
    assert.equal(index.posts["post-1"].lastStatus, "request_failed");
  });

  test("원본을 고치지 않는다", () => {
    const before = emptyOutcomeIndex();
    applyObservationsToIndex(before, [observation({ postAgeHours: 0 })]);
    assert.deepEqual(before.posts, {});
  });
});

describe("PR44 색인만으로 판정해도 결과가 같다", () => {
  // 색인은 캐시다. 캐시로 낸 판정이 원본으로 낸 판정과 다르면 캐시가 아니라 버그다.
  const cases = [
    { name: "발행 직후, 아직 안 잼", publishedHoursAgo: 1, existing: [] },
    {
      name: "발행 직후에 쟀음",
      publishedHoursAgo: 2,
      existing: [observation({ postAgeHours: 0 })],
    },
    {
      name: "7일 구간에 들어왔는데 직후 관측만 있음",
      publishedHoursAgo: 200,
      existing: [observation({ postAgeHours: 0 })],
    },
    {
      name: "28일 지난 글을 최근에 쟀음",
      publishedHoursAgo: 800,
      existing: [observation({ postAgeHours: 700 })],
    },
    {
      name: "28일 지난 글을 오래 안 쟀음",
      publishedHoursAgo: 2000,
      existing: [observation({ postAgeHours: 700 })],
    },
    {
      name: "실패만 쌓인 글",
      publishedHoursAgo: 300,
      existing: [observation({ postAgeHours: 250, status: "parse_failed" })],
    },
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      const publishedAt = at(testCase.publishedHoursAgo);
      const fromObservations = dueCheckpoint({
        publishedAt,
        now: NOW,
        existing: testCase.existing,
      });
      const fromIndex = dueCheckpointFromAges({
        publishedAt,
        now: NOW,
        okAgeHours: okSerpAges(testCase.existing),
      });

      assert.equal(fromIndex, fromObservations);
    });
  }

  test("소급 추적한 옛날 글은 한 번 재고 나면 다음 주기까지 조용하다", () => {
    const publishedAt = at(13_000);
    const first = dueCheckpointFromAges({ publishedAt, now: NOW, okAgeHours: [] });
    assert.equal(first, 672);

    const measured = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ postAgeHours: 13_000 }),
    ]);
    const second = dueCheckpointFromAges({
      publishedAt,
      now: NOW,
      okAgeHours: measured.posts["post-1"].okAgeHours,
    });
    assert.equal(second, null);

    // 28일 뒤에는 다시 잰다.
    const later = new Date(Date.now() + ONGOING_INTERVAL_HOURS * HOUR).toISOString();
    assert.equal(
      dueCheckpointFromAges({
        publishedAt,
        now: later,
        okAgeHours: measured.posts["post-1"].okAgeHours,
      }),
      672
    );
  });
});
