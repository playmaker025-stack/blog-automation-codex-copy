import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  parseNaverPostUrl,
  isSamePost,
  summarizeOutcomes,
  rankByOutcome,
  hashContent,
  hoursSince,
  buildObservationId,
} from "../../lib/agents/post-outcome.ts";

const obs = (o = {}) => ({
  schemaVersion: 1,
  observationId: "x",
  postId: "post-1",
  source: "serp",
  capturedAt: "2026-08-25T00:00:00.000Z",
  postAgeHours: 168,
  status: "ok",
  collector: { method: "crawler", version: "1" },
  ...o,
});

const serp = (o = {}) => ({
  query: "부천 전자담배 액상",
  // 기본값은 사장님이 정한 검색어다. 추측 검색어로 잰 관측은 성적에 안 들어간다
  // (PR44). 여기 테스트는 순위 규칙을 보는 것이라 사람이 정한 값으로 둔다.
  querySource: "user",
  device: "mobile",
  rank: 5,
  searchedResultLimit: 30,
  aiBriefing: "not_rendered",
  cited: "no",
  ...o,
});

describe("PR38 네이버 글 주소 정규화", () => {
  test("모바일·PC·PostView 주소가 같은 글로 모인다", () => {
    const expected = "https://blog.naver.com/mansur_vape/224340378304";
    for (const url of [
      "https://blog.naver.com/mansur_vape/224340378304",
      "https://m.blog.naver.com/mansur_vape/224340378304",
      "https://blog.naver.com/PostView.naver?blogId=mansur_vape&logNo=224340378304&redirect=Dlog",
    ]) {
      assert.equal(parseNaverPostUrl(url)?.canonicalUrl, expected, url);
    }
  });

  test("같은 글이면 표기가 달라도 같다고 본다", () => {
    assert.equal(
      isSamePost(
        "https://m.blog.naver.com/a/123",
        "https://blog.naver.com/PostView.naver?blogId=a&logNo=123"
      ),
      true
    );
    assert.equal(isSamePost("https://blog.naver.com/a/123", "https://blog.naver.com/a/124"), false);
  });

  test("네이버 글이 아니면 null", () => {
    assert.equal(parseNaverPostUrl("https://example.com/1"), null);
    assert.equal(parseNaverPostUrl(null), null);
    assert.equal(isSamePost(null, "https://blog.naver.com/a/1"), false);
  });
});

// 실패를 값으로 저장하면 나중에 해석이 불가능해진다.
describe("PR38 실패 관측 보존", () => {
  test("실패 관측은 성공 집계에 안 들어간다", () => {
    const s = summarizeOutcomes([
      obs({ status: "request_failed" }),
      obs({ status: "parse_failed" }),
      obs({ status: "ok", serp: serp({ rank: 3 }) }),
    ]);
    assert.equal(s.observationCount, 3);
    assert.equal(s.okCount, 1);
    assert.equal(s.bestRank, 3);
  });

  test("순위를 못 찾은 성공 관측은 최고순위 계산에서 빠진다", () => {
    const s = summarizeOutcomes([
      obs({ status: "ok", serp: serp({ rank: null }) }),
      obs({ status: "ok", serp: serp({ rank: 7 }) }),
    ]);
    assert.equal(s.bestRank, 7);
  });

  test("관측이 없으면 전부 null이고 판단하지 않는다", () => {
    const s = summarizeOutcomes([]);
    assert.equal(s.bestRank, null);
    assert.equal(s.latestViews, null);
    assert.equal(s.confident, false);
  });
});

// 브리핑이 안 뜬 검색어와 떴는데 밀린 것은 완전히 다른 이야기다.
describe("PR38 AI 브리핑 두 갈래", () => {
  test("브리핑이 안 뜬 것은 인용 실패가 아니다", () => {
    const s = summarizeOutcomes([
      obs({ status: "ok", serp: serp({ aiBriefing: "not_rendered", cited: "no" }) }),
    ]);
    assert.equal(s.briefingEverRendered, false);
    assert.equal(s.everCited, false);
  });

  test("떴고 인용된 것을 잡아낸다", () => {
    const s = summarizeOutcomes([
      obs({ status: "ok", serp: serp({ aiBriefing: "rendered", cited: "yes" }) }),
    ]);
    assert.equal(s.briefingEverRendered, true);
    assert.equal(s.everCited, true);
  });

  test("unknown은 인용으로 세지 않는다", () => {
    const s = summarizeOutcomes([
      obs({ status: "ok", serp: serp({ aiBriefing: "unknown", cited: "unknown" }) }),
    ]);
    assert.equal(s.everCited, false);
    assert.equal(s.briefingEverRendered, false);
  });
});

describe("PR38 성과 줄세우기", () => {
  const withSummary = (id, observations) => ({ id, summary: summarizeOutcomes(observations) });
  const twice = (o) => [obs({ status: "ok", serp: serp(o) }), obs({ status: "ok", serp: serp(o) })];

  test("관측이 모자란 글은 후보에서 뺀다", () => {
    const ranked = rankByOutcome([withSummary("한번만", [obs({ status: "ok", serp: serp({ rank: 1 }) })])]);
    assert.equal(ranked.length, 0);
  });

  test("AI 인용이 순위보다 앞선다", () => {
    const ranked = rankByOutcome([
      withSummary("1위지만_미인용", twice({ rank: 1 })),
      withSummary("9위지만_인용", twice({ rank: 9, aiBriefing: "rendered", cited: "yes" })),
    ]);
    assert.equal(ranked[0].id, "9위지만_인용");
  });

  test("같은 조건이면 순위가 높은 글이 앞선다", () => {
    const ranked = rankByOutcome([
      withSummary("8위", twice({ rank: 8 })),
      withSummary("2위", twice({ rank: 2 })),
    ]);
    assert.equal(ranked[0].id, "2위");
  });

  // 앱이 제목을 잘라 만든 말로 1위가 나와도 그건 글의 성적이 아니다.
  // 사람이 검색하지 않는 말이면 1위에 아무 의미가 없다.
  test("추측한 검색어로만 잰 글은 줄세우기에서 뺀다", () => {
    const ranked = rankByOutcome([
      withSummary("추측_1위", twice({ rank: 1, querySource: "title_guess" })),
      withSummary("사람이정한_9위", twice({ rank: 9 })),
    ]);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, "사람이정한_9위");
  });
});

describe("PR38 보조", () => {
  test("본문이 바뀌면 지문이 바뀐다", () => {
    assert.notEqual(hashContent("원래 본문입니다."), hashContent("고친 본문입니다."));
  });

  test("공백만 다르면 같은 글로 본다", () => {
    assert.equal(hashContent("가  나\n다"), hashContent("가 나 다"));
  });

  test("발행 후 경과 시간을 센다", () => {
    assert.equal(hoursSince("2026-08-18T00:00:00Z", "2026-08-25T00:00:00Z"), 168);
    assert.equal(hoursSince(null, "2026-08-25T00:00:00Z"), null);
  });

  test("관측 아이디는 시점과 검색어로 구분된다", () => {
    const a = buildObservationId({ postId: "p", source: "serp", capturedAt: "2026-08-25T01:00:00Z", query: "가 나" });
    const b = buildObservationId({ postId: "p", source: "serp", capturedAt: "2026-08-25T01:00:00Z", query: "다" });
    assert.notEqual(a, b);
    assert.ok(a.includes("serp"));
  });
});
