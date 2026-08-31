import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  applyObservationsToIndex,
  backoffUntil,
  buildOutcomeTracking,
  dueCheckpoint,
  dueCheckpointFromAges,
  emptyOutcomeIndex,
  indexEntryFromObservations,
  isUsableQuery,
  MAX_TARGET_KEYWORDS,
  nextCollectorHealth,
  migrateOutcomeIndex,
  queryStateKey,
  normalizeQuery,
  normalizeTargetKeywords,
  okSerpAges,
  ONGOING_INTERVAL_HOURS,
  summarizeOutcomes,
} from "../../lib/agents/post-outcome.ts";

const HOUR = 3_600_000;
const at = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const NOW = new Date().toISOString();

const SURFACE = "integrated";

/**
 * 관측치 fixture.
 *
 * 실패 관측에는 serp가 없다 — 실제 수집기가 그렇게 만든다. 처음엔 실패에도
 * serp를 넣어뒀는데, 그 탓에 "실패가 검색어 칸에 안 쌓여 백오프가 영영 안
 * 걸리는" 결함을 테스트가 통째로 가렸다. 코덱스 리뷰가 잡았다.
 */
const observation = (overrides = {}) => {
  const status = overrides.status ?? "ok";
  const surface = overrides.surface ?? SURFACE;
  const query = overrides.query ?? "기본검색어";
  const source = overrides.source ?? "serp";

  const base = {
    schemaVersion: 1,
    observationId: overrides.observationId ?? "20260830120000292_serp_test_abc123",
    postId: overrides.postId ?? "post-1",
    source,
    capturedAt: overrides.capturedAt ?? NOW,
    postAgeHours: overrides.postAgeHours ?? 0,
    status,
    collector: { method: "crawler", version: "1" },
  };

  if (source !== "serp") return base;

  // 재려던 대상은 성공이든 실패든 남는다.
  base.target = { surface, query };
  if (status !== "ok") return base;

  return {
    ...base,
    serp: {
      query,
      surface,
      querySource: overrides.querySource ?? "user",
      device: "mobile",
      rank: overrides.rank ?? null,
      searchedResultLimit: 20,
      aiBriefing: "not_rendered",
      cited: "unknown",
    },
  };
};

describe("PR44 관측 색인은 검색어 단위다", () => {
  // 이 앱이 실제로 겪은 버그: 검색어가 둘인 글에서 첫 번째만 재고 한도가 차면,
  // 그 글이 통째로 "쟀음"이 되어 두 번째 검색어가 영영 안 재졌다.
  test("한 검색어를 쟀다고 다른 검색어까지 잰 걸로 치지 않는다", () => {
    const index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ query: "부평 전자담배 추천", postAgeHours: 1000 }),
    ]);

    const entry = index.posts["post-1"];
    assert.deepEqual(entry.queries[queryStateKey(SURFACE, "부평 전자담배 추천")].okAgeHours, [1000]);
    assert.equal(entry.queries[queryStateKey(SURFACE, "구월동 전자담배")], undefined);

    const publishedAt = at(1000);
    assert.equal(
      dueCheckpointFromAges({
        publishedAt,
        now: NOW,
        okAgeHours: entry.queries[queryStateKey(SURFACE, "부평 전자담배 추천")].okAgeHours,
      }),
      null
    );
    // 안 잰 검색어는 여전히 잴 차례다.
    assert.equal(
      dueCheckpointFromAges({ publishedAt, now: NOW, okAgeHours: [] }),
      672
    );
  });

  test("검색어를 새 말로 바꾸면 곧바로 다시 재기 시작한다", () => {
    const index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ query: "전자담배 액상이 입", postAgeHours: 900 }),
    ]);
    const entry = index.posts["post-1"];

    // 사장님이 제대로 된 말로 바꾼 뒤 — 그 말의 기록은 없으므로 잴 차례다.
    assert.equal(
      dueCheckpointFromAges({
        publishedAt: at(900),
        now: NOW,
        okAgeHours: entry.queries[queryStateKey(SURFACE, "전자담배 액튐 해결")]?.okAgeHours ?? [],
      }),
      672
    );
  });

  test("실패는 시점을 채우지 않고 연속 실패로 쌓인다", () => {
    let index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ status: "request_failed", postAgeHours: 3 }),
    ]);
    index = applyObservationsToIndex(index, [
      observation({ status: "request_failed", postAgeHours: 4, capturedAt: at(-1) }),
    ]);

    const state = index.posts["post-1"].queries[queryStateKey(SURFACE, "기본검색어")];
    assert.deepEqual(state.okAgeHours, []);
    assert.equal(state.consecutiveFailures, 2);
    assert.equal(state.lastStatus, "request_failed");
  });

  test("성공하면 연속 실패가 0으로 돌아간다", () => {
    let index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ status: "parse_failed", postAgeHours: 3 }),
    ]);
    index = applyObservationsToIndex(index, [
      observation({ status: "ok", postAgeHours: 4, capturedAt: at(-1) }),
    ]);
    assert.equal(
      index.posts["post-1"].queries[queryStateKey(SURFACE, "기본검색어")].consecutiveFailures,
      0
    );
  });

  // 사람이 손으로 넣은 옛 관측이 뒤늦게 들어와도 최신 상태를 과거로 덮으면 안 된다.
  test("더 오래된 관측이 나중에 들어와도 최신 상태를 덮지 않는다", () => {
    // 시각은 한 번만 계산해서 붙든다. at()을 두 번 부르면 그 사이 밀리초가
    // 흘러 값이 달라지고, 테스트가 어쩌다 실패한다.
    const recent = at(1);
    const older = at(50);

    let index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ status: "ok", postAgeHours: 10, capturedAt: recent }),
    ]);
    index = applyObservationsToIndex(index, [
      observation({ status: "request_failed", postAgeHours: 5, capturedAt: older }),
    ]);

    const state = index.posts["post-1"].queries[queryStateKey(SURFACE, "기본검색어")];
    assert.equal(state.lastStatus, "ok");
    assert.equal(state.lastCapturedAt, recent);
  });

  test("원본을 고치지 않는다", () => {
    const before = emptyOutcomeIndex();
    applyObservationsToIndex(before, [observation()]);
    assert.deepEqual(before.posts, {});
  });

  test("관측치 원본에서 색인을 다시 만들 수 있다", () => {
    const entry = indexEntryFromObservations([
      observation({ query: "가", postAgeHours: 0 }),
      observation({ query: "나", postAgeHours: 0, capturedAt: at(-1) }),
      observation({ query: "가", postAgeHours: 170, capturedAt: at(-2) }),
    ]);

    assert.deepEqual(entry.queries[queryStateKey(SURFACE, "가")].okAgeHours, [0, 170]);
    assert.deepEqual(entry.queries[queryStateKey(SURFACE, "나")].okAgeHours, [0]);
    assert.equal(entry.total, 3);
  });
});

describe("PR44 실패한 검색어는 잠시 쉰다", () => {
  // 실패는 "쟀다"로 치지 않아 다음 회차에 또 후보가 된다. 앞쪽 몇 건이 계속
  // 실패하면 한 회차 몫을 다 먹어서 뒤쪽 글은 차례가 영영 오지 않는다.
  test("연속 실패가 늘수록 간격이 벌어진다", () => {
    const base = { okAgeHours: [], lastCapturedAt: NOW, total: 1, lastStatus: "request_failed" };
    const after1 = backoffUntil({ ...base, consecutiveFailures: 1, lastAttemptAt: NOW });
    const after3 = backoffUntil({ ...base, consecutiveFailures: 3, lastAttemptAt: NOW });

    assert.ok(after3 > after1);
    assert.equal(after1 - new Date(NOW).getTime(), 1 * HOUR);
    assert.equal(after3 - new Date(NOW).getTime(), 4 * HOUR);
  });

  test("하루를 넘겨 쉬지는 않는다", () => {
    const until = backoffUntil({
      okAgeHours: [],
      lastCapturedAt: NOW,
      total: 20,
      lastStatus: "request_failed",
      consecutiveFailures: 20,
      lastAttemptAt: NOW,
    });
    assert.equal(until - new Date(NOW).getTime(), 24 * HOUR);
  });

  test("성공한 검색어는 쉬지 않는다", () => {
    assert.equal(backoffUntil(undefined), 0);
    assert.equal(
      backoffUntil({
        okAgeHours: [0],
        lastCapturedAt: NOW,
        total: 1,
        lastStatus: "ok",
        consecutiveFailures: 0,
        lastAttemptAt: NOW,
      }),
      0
    );
  });
});

describe("PR44 노린 검색어는 사람이 정한다", () => {
  test("여러 개를 넣을 수 있다", () => {
    const keywords = normalizeTargetKeywords([
      "부평 전자담배",
      "부평 전자담배 매장",
      "부평역 전자담배",
    ]);
    assert.equal(keywords.length, 3);
    assert.equal(keywords[0].role, "primary");
    assert.equal(keywords[1].role, "secondary");
  });

  test("중복과 빈 값은 떨어진다", () => {
    const keywords = normalizeTargetKeywords(["부평 전자담배", " 부평  전자담배 ", "", "  "]);
    assert.deepEqual(keywords.map((k) => k.query), ["부평 전자담배"]);
  });

  test("문장부호만 남은 조각은 검색어가 아니다", () => {
    assert.equal(isUsableQuery("전자담배 관리법 :"), true); // 부호를 떼면 말이 남는다
    assert.equal(normalizeQuery("전자담배 관리법 :"), "전자담배 관리법");
    assert.equal(isUsableQuery(" : "), false);
    assert.equal(isUsableQuery("가"), false);
  });

  test("개수에 상한이 있다 — 검색어 하나가 요청 하나다", () => {
    const many = Array.from({ length: 20 }, (_, i) => `검색어${i}`);
    assert.equal(normalizeTargetKeywords(many).length, MAX_TARGET_KEYWORDS);
  });

  test("사람이 정하면 계약에 그 시각이 남는다", () => {
    const tracking = buildOutcomeTracking({
      naverPostUrl: "https://blog.naver.com/mansur_vape/224340378304",
      title: "부평 전자담배 추천",
      content: "본문",
      targetKeywords: [{ query: "부평 전자담배", role: "primary", source: "user" }],
      at: NOW,
    });
    assert.equal(tracking.keywordsRevisedAt, NOW);
    assert.equal(tracking.targetKeywords[0].source, "user");
  });
});

describe("PR44 추측한 검색어는 성적으로 치지 않는다", () => {
  test("추측 검색어만 있으면 아직 판단하지 않는다", () => {
    const summary = summarizeOutcomes([
      observation({ querySource: "title_guess", rank: null, postAgeHours: 0 }),
      observation({ querySource: "title_guess", rank: null, postAgeHours: 1 }),
    ]);

    assert.equal(summary.okCount, 2);
    assert.equal(summary.declaredOkCount, 0);
    assert.equal(summary.guessedOnly, true);
    assert.equal(summary.confident, false);
  });

  test("사람이 정한 검색어로 재면 성적이 된다", () => {
    const summary = summarizeOutcomes([
      observation({ querySource: "user", rank: 7, postAgeHours: 0 }),
      observation({ querySource: "user", rank: 5, postAgeHours: 170 }),
    ]);

    assert.equal(summary.declaredOkCount, 2);
    assert.equal(summary.guessedOnly, false);
    assert.equal(summary.confident, true);
    assert.equal(summary.bestRank, 5);
  });
});

describe("PR44 색인만으로 판정해도 결과가 같다", () => {
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
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      const publishedAt = at(testCase.publishedHoursAgo);
      assert.equal(
        dueCheckpointFromAges({
          publishedAt,
          now: NOW,
          okAgeHours: okSerpAges(testCase.existing),
        }),
        dueCheckpoint({ publishedAt, now: NOW, existing: testCase.existing })
      );
    });
  }

  test("한 번 재고 나면 28일 뒤에 다시 잰다", () => {
    const publishedAt = at(13_000);
    const index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ postAgeHours: 13_000 }),
    ]);
    const ages = index.posts["post-1"].queries[queryStateKey(SURFACE, "기본검색어")].okAgeHours;

    assert.equal(dueCheckpointFromAges({ publishedAt, now: NOW, okAgeHours: ages }), null);
    assert.equal(
      dueCheckpointFromAges({
        publishedAt,
        now: new Date(Date.now() + ONGOING_INTERVAL_HOURS * HOUR).toISOString(),
        okAgeHours: ages,
      }),
      672
    );
  });
});

describe("PR44 수집기 건강 상태", () => {
  const RAN = "2026-08-31T02:00:00.000Z";

  // 처음에 이걸 틀렸다. 밀린 게 다 끝나고 잴 것이 없어지자 정상인 상태에서
  // "연속 실패 31회"가 찍혔다. 늘 켜져 있는 경보는 경보가 아니다.
  test("잴 것이 없던 회차는 실패로 세지 않는다", () => {
    const health = nextCollectorHealth(
      { lastRunAt: "2026-08-30T00:00:00.000Z", lastOkAt: "2026-08-30T00:00:00.000Z", consecutiveFailedRuns: 0 },
      { ranAt: RAN, attempted: 0, anyOk: false }
    );

    assert.equal(health.consecutiveFailedRuns, 0);
    assert.equal(health.lastRunAt, RAN);
    // 잰 게 없으니 마지막 성공 시각은 그대로다.
    assert.equal(health.lastOkAt, "2026-08-30T00:00:00.000Z");
  });

  test("재려고 했는데 다 실패하면 센다", () => {
    const health = nextCollectorHealth(
      { lastRunAt: "2026-08-30T00:00:00.000Z", consecutiveFailedRuns: 2 },
      { ranAt: RAN, attempted: 12, anyOk: false }
    );
    assert.equal(health.consecutiveFailedRuns, 3);
  });

  test("한 건이라도 성공하면 0으로 돌아간다", () => {
    const health = nextCollectorHealth(
      { lastRunAt: "2026-08-30T00:00:00.000Z", consecutiveFailedRuns: 9 },
      { ranAt: RAN, attempted: 12, anyOk: true }
    );
    assert.equal(health.consecutiveFailedRuns, 0);
    assert.equal(health.lastOkAt, RAN);
  });
});

describe("PR45 통합검색과 블로그 탭은 따로 잰다", () => {
  // 화면을 키에 넣지 않으면, 통합검색을 잰 순간 "이 검색어는 쟀음"이 되어
  // 블로그 탭은 영영 안 재진다. 검색어 단위로 바꾸기 전에 겪은 것과 같은 결함이
  // 화면 축에서 되풀이되는 자리다.
  test("한 화면을 쟀다고 다른 화면까지 잰 걸로 치지 않는다", () => {
    const index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ query: "인천 전자담배", surface: "integrated", postAgeHours: 900 }),
    ]);
    const queries = index.posts["post-1"].queries;

    assert.deepEqual(queries[queryStateKey("integrated", "인천 전자담배")].okAgeHours, [900]);
    assert.equal(queries[queryStateKey("blog_tab", "인천 전자담배")], undefined);
  });

  test("화면 표시가 없는 옛 관측은 통합검색으로 본다", () => {
    const old = observation({ query: "인천 전자담배", postAgeHours: 900 });
    delete old.serp.surface;

    const index = applyObservationsToIndex(emptyOutcomeIndex(), [old]);
    assert.ok(index.posts["post-1"].queries[queryStateKey("integrated", "인천 전자담배")]);
  });
});

describe("PR45 색인 판 올리기는 그 자리에서 한다", () => {
  // 판이 바뀔 때마다 글 폴더 330개를 다시 읽게 했더니, 요청마다 왕복 1,000번이
  // 되어 GitHub API 한도를 태우고 앱 전체가 멈췄다(2026-08-31). 키 모양만
  // 바뀌는 일이라 읽지 않고도 된다.
  test("2판의 검색어 키를 통합검색 키로 옮긴다", () => {
    const old = {
      schemaVersion: 2,
      updatedAt: "2026-08-30T00:00:00.000Z",
      posts: {
        "post-1": {
          queries: {
            "인천 전자담배": {
              okAgeHours: [900],
              lastCapturedAt: "2026-08-30T00:00:00.000Z",
              total: 1,
              lastStatus: "ok",
              consecutiveFailures: 0,
              lastAttemptAt: "2026-08-30T00:00:00.000Z",
            },
          },
          lastCapturedAt: "2026-08-30T00:00:00.000Z",
          total: 1,
        },
      },
    };

    const migrated = migrateOutcomeIndex(old);
    const queries = migrated.posts["post-1"].queries;

    assert.deepEqual(queries[queryStateKey("integrated", "인천 전자담배")].okAgeHours, [900]);
    assert.equal(queries["인천 전자담배"], undefined);
    // 판을 올렸으니 다음에 또 옮기지 않는다.
    assert.equal(migrateOutcomeIndex(migrated), migrateOutcomeIndex(migrated));
  });

  test("이미 최신 판이면 그대로 둔다", () => {
    const current = emptyOutcomeIndex();
    assert.equal(migrateOutcomeIndex(current), current);
  });

  test("모양을 모르는 낡은 판은 빈 색인으로 시작한다", () => {
    const ancient = { schemaVersion: 1, updatedAt: "", posts: { "post-1": { okAgeHours: [1] } } };
    assert.deepEqual(migrateOutcomeIndex(ancient).posts, {});
  });
});

describe("PR45 실패도 그 검색어에 쌓인다", () => {
  // 실패 관측에는 serp가 없다. 색인 키를 serp에서만 뽑았더니 실패가 전부
  // "검색어 없음" 칸에 쌓였고, 정작 그 검색어의 연속 실패는 0인 채였다.
  // 그래서 "계속 실패하면 쉬게 한다"가 한 번도 작동하지 않았다.
  test("실패가 검색어 칸에 붙는다", () => {
    const index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ status: "request_failed", query: "인천 전자담배", postAgeHours: 3 }),
    ]);

    const key = queryStateKey(SURFACE, "인천 전자담배");
    assert.equal(index.posts["post-1"].queries[key].consecutiveFailures, 1);
    assert.equal(index.posts["post-1"].queries[""], undefined);
  });

  test("실패가 쌓이면 그 검색어가 쉬게 된다", () => {
    let index = emptyOutcomeIndex();
    for (let i = 0; i < 3; i += 1) {
      index = applyObservationsToIndex(index, [
        observation({
          status: "request_failed",
          query: "인천 전자담배",
          postAgeHours: 3 + i,
          capturedAt: new Date(Date.now() + i * 1000).toISOString(),
        }),
      ]);
    }

    const state = index.posts["post-1"].queries[queryStateKey(SURFACE, "인천 전자담배")];
    assert.equal(state.consecutiveFailures, 3);
    assert.ok(backoffUntil(state) > Date.now(), "쉬는 시각이 잡혀야 한다");
  });

  test("같은 검색어라도 화면이 다르면 따로 쌓인다", () => {
    const index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ status: "request_failed", surface: "integrated", query: "가" }),
      observation({
        status: "request_failed",
        surface: "blog_tab",
        query: "가",
        capturedAt: new Date(Date.now() + 1000).toISOString(),
      }),
    ]);

    const queries = index.posts["post-1"].queries;
    assert.equal(queries[queryStateKey("integrated", "가")].consecutiveFailures, 1);
    assert.equal(queries[queryStateKey("blog_tab", "가")].consecutiveFailures, 1);
  });

  test("늦게 도착한 옛 실패가 최신 성공을 뒤엎지 않는다", () => {
    const recent = new Date(Date.now()).toISOString();
    const older = new Date(Date.now() - 3_600_000).toISOString();

    let index = applyObservationsToIndex(emptyOutcomeIndex(), [
      observation({ status: "ok", postAgeHours: 10, capturedAt: recent }),
    ]);
    index = applyObservationsToIndex(index, [
      observation({ status: "request_failed", postAgeHours: 5, capturedAt: older }),
    ]);

    const state = index.posts["post-1"].queries[queryStateKey(SURFACE, "기본검색어")];
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(backoffUntil(state), 0);
  });
});
