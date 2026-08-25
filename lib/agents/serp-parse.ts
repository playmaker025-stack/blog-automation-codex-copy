/**
 * serp-parse — 네이버 검색 결과 HTML에서 우리 글 위치를 읽는 순수 로직.
 *
 * 실측(2026-08-25, 모바일 통합검색)으로 확인한 것:
 *
 * - 블로그 글 링크는 한 글당 여러 번 반복된다(썸네일·제목·더보기가 같은 주소를
 *   가리킨다). 그래서 **첫 등장 순서로 중복을 제거**해야 순위가 나온다.
 * - AI 브리핑은 `fender_renderer-ai_briefing` 컨테이너와 `AI 브리핑` 제목으로
 *   렌더 여부를 알 수 있다.
 * - 그러나 브리핑 **본문과 출처는 JS로 나중에 불러온다.** 정적 HTML에는 광고
 *   링크만 있다. 그래서 "우리 글이 인용됐는지"는 이 방식으로 알 수 없고,
 *   반드시 unknown으로 남겨야 한다. no로 적으면 거짓이 된다.
 *
 * 네트워크는 serp-collector가 담당한다. 여기는 문자열만 다룬다.
 */

import type { BriefingState, Tristate } from "./post-outcome.ts";

/** 브리핑이 떴는지 판정하는 마커. 하나라도 있으면 렌더된 것으로 본다. */
const BRIEFING_MARKERS = [
  "fender_renderer-ai_briefing",
  "fds-aib-header-title-text",
];

/** 검색이 막혔거나 결과 화면이 아닐 때 나타나는 신호. */
const BLOCKED_MARKERS = [
  "일시적으로 제한",
  "비정상적인 검색",
  "자동입력 방지",
];

const POST_LINK = /blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)/g;

export interface SerpParseResult {
  /** 첫 등장 순서로 중복 제거한 블로그 글 목록. 앞에서부터 1위. */
  blogOrder: Array<{ blogId: string; logNo: string }>;
  aiBriefing: BriefingState;
  /** 정적 HTML로는 판정 불가. 항상 unknown이다 — 착각하지 말라고 값으로 남긴다. */
  cited: Tristate;
  blocked: boolean;
}

/** 결과 화면 자체를 못 받았는지. 이걸 "미노출"로 저장하면 데이터가 거짓이 된다. */
export function looksBlocked(html: string): boolean {
  if (html.length < 5000) return true;
  return BLOCKED_MARKERS.some((marker) => html.includes(marker));
}

export function parseSerp(html: string): SerpParseResult {
  const blocked = looksBlocked(html);

  const seen = new Set<string>();
  const blogOrder: Array<{ blogId: string; logNo: string }> = [];
  POST_LINK.lastIndex = 0;
  for (const match of html.matchAll(POST_LINK)) {
    const [, blogId, logNo] = match;
    const key = `${blogId}/${logNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blogOrder.push({ blogId, logNo });
  }

  return {
    blogOrder,
    aiBriefing: blocked
      ? "unknown"
      : BRIEFING_MARKERS.some((marker) => html.includes(marker))
        ? "rendered"
        : "not_rendered",
    // 브리핑 출처는 JS 렌더라 정적 HTML에 없다. 모르는 건 모른다고 적는다.
    cited: "unknown",
    blocked,
  };
}

/**
 * 우리 글이 몇 위인지.
 *
 * 못 찾았을 때 null을 주는 것과 "찾은 데까지 몇 개를 봤는지"를 같이 남기는 게
 * 중요하다. 15위까지만 실린 화면에서 못 찾은 것과 100위까지 봐도 없는 것은
 * 완전히 다른 사실이다.
 */
export function findRank(
  parsed: SerpParseResult,
  target: { blogId: string; logNo: string }
): { rank: number | null; searchedResultLimit: number } {
  const index = parsed.blogOrder.findIndex(
    (item) => item.blogId === target.blogId && item.logNo === target.logNo
  );
  return {
    rank: index === -1 ? null : index + 1,
    searchedResultLimit: parsed.blogOrder.length,
  };
}

export function buildMobileSearchUrl(query: string): string {
  return `https://m.search.naver.com/search.naver?where=m&query=${encodeURIComponent(query.trim())}`;
}
