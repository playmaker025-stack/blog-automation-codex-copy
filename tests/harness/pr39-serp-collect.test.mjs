import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { parseSerp, findRank, looksBlocked, buildMobileSearchUrl } from "../../lib/agents/serp-parse.ts";
import { dueCheckpoints, CHECKPOINT_HOURS } from "../../lib/agents/post-outcome.ts";

// 실측(2026-08-25): 한 글의 링크가 화면에 9번씩 반복됐다. 중복을 안 지우면
// 1위 글이 1~9위를 다 차지한 것처럼 보인다.
const repeated = (blogId, logNo, times) =>
  Array.from({ length: times }, () => `<a href="https://blog.naver.com/${blogId}/${logNo}">글</a>`).join("");

const BODY = "x".repeat(6000);
const SERP =
  BODY +
  repeated("alswl3331694", "224341615602", 9) +
  repeated("vapemarket_jy", "224377729060", 3) +
  repeated("mansur_vape", "224340378304", 4);

describe("PR39 순위 추출", () => {
  test("같은 글이 여러 번 나와도 한 번만 센다", () => {
    const parsed = parseSerp(SERP);
    assert.equal(parsed.blogOrder.length, 3);
    assert.equal(parsed.blogOrder[0].blogId, "alswl3331694");
  });

  test("첫 등장 순서가 순위가 된다", () => {
    const parsed = parseSerp(SERP);
    assert.deepEqual(findRank(parsed, { blogId: "mansur_vape", logNo: "224340378304" }), {
      rank: 3,
      searchedResultLimit: 3,
    });
  });

  // 15위까지만 실린 화면에서 못 찾은 것과 100위까지 봐도 없는 것은 다른 사실이다.
  test("못 찾으면 rank는 null이고 몇 개까지 봤는지를 남긴다", () => {
    const parsed = parseSerp(SERP);
    const found = findRank(parsed, { blogId: "없는블로그", logNo: "1" });
    assert.equal(found.rank, null);
    assert.equal(found.searchedResultLimit, 3);
  });
});

describe("PR39 AI 브리핑 판정", () => {
  test("브리핑 마커가 있으면 rendered", () => {
    const html = BODY + '<div data-meta-ssuid-extra="fender_renderer-ai_briefing"></div>';
    assert.equal(parseSerp(html).aiBriefing, "rendered");
  });

  test("마커가 없으면 not_rendered", () => {
    assert.equal(parseSerp(SERP).aiBriefing, "not_rendered");
  });

  // 브리핑 본문·출처는 JS로 나중에 로드된다. 정적 HTML로는 알 수 없다.
  test("인용 여부는 항상 unknown이다 — no로 적으면 거짓이 된다", () => {
    const html = BODY + '<div class="fds-aib-header-title-text">AI 브리핑</div>';
    const parsed = parseSerp(html);
    assert.equal(parsed.aiBriefing, "rendered");
    assert.equal(parsed.cited, "unknown");
  });
});

describe("PR39 결과 화면을 못 받은 경우", () => {
  test("너무 짧으면 막힌 것으로 본다", () => {
    assert.equal(looksBlocked("<html></html>"), true);
    assert.equal(parseSerp("<html></html>").blocked, true);
  });

  test("제한 문구가 있으면 막힌 것으로 본다", () => {
    assert.equal(looksBlocked(BODY + "일시적으로 제한되었습니다"), true);
  });

  // 막힌 화면을 "브리핑 없음"으로 저장하면 데이터가 거짓이 된다.
  test("막혔으면 브리핑 판정도 unknown", () => {
    assert.equal(parseSerp("<html></html>").aiBriefing, "unknown");
  });

  test("정상 화면은 막힘이 아니다", () => {
    assert.equal(parseSerp(SERP).blocked, false);
  });
});

describe("PR39 관측 시점", () => {
  const obs = (hours) => ({
    schemaVersion: 1,
    observationId: String(hours),
    postId: "p",
    source: "serp",
    capturedAt: "2026-08-25T00:00:00.000Z",
    postAgeHours: hours,
    status: "ok",
    collector: { method: "crawler", version: "1" },
  });

  test("발행 직후부터 잰다", () => {
    const due = dueCheckpoints({
      publishedAt: "2026-08-25T00:00:00Z",
      now: "2026-08-25T01:00:00Z",
      existing: [],
    });
    assert.deepEqual(due, [0]);
  });

  test("시간이 지나면 지난 시점들이 밀려서 나온다", () => {
    const due = dueCheckpoints({
      publishedAt: "2026-08-01T00:00:00Z",
      now: "2026-08-29T00:00:00Z",
      existing: [],
    });
    assert.deepEqual(due, [...CHECKPOINT_HOURS]);
  });

  test("이미 잰 구간은 건너뛴다", () => {
    const due = dueCheckpoints({
      publishedAt: "2026-08-01T00:00:00Z",
      now: "2026-08-09T00:00:00Z",
      existing: [obs(2), obs(170)],
    });
    assert.deepEqual(due, []);
  });

  // 실패했으면 그 시점을 아직 못 잰 것이다. 건너뛰면 영원히 빈칸으로 남는다.
  test("실패 관측은 건너뛰기 근거가 아니다", () => {
    const failed = { ...obs(2), status: "request_failed" };
    const due = dueCheckpoints({
      publishedAt: "2026-08-25T00:00:00Z",
      now: "2026-08-25T03:00:00Z",
      existing: [failed],
    });
    assert.deepEqual(due, [0]);
  });

  test("발행일이 없으면 잴 시점이 없다", () => {
    assert.deepEqual(dueCheckpoints({ publishedAt: null, now: "2026-08-25T00:00:00Z", existing: [] }), []);
  });
});

describe("PR39 검색 주소", () => {
  test("모바일 통합검색 주소를 만든다", () => {
    const url = buildMobileSearchUrl("부천 전자담배 액상");
    assert.ok(url.startsWith("https://m.search.naver.com/search.naver?where=m&query="));
    assert.ok(url.includes(encodeURIComponent("부천 전자담배 액상")));
  });
});
