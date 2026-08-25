/**
 * serp-collector — 발행한 글이 지금 몇 위인지 확인해서 관측치로 남긴다.
 *
 * 판정 로직은 serp-parse.ts와 post-outcome.ts에 순수 함수로 있다. 여기는
 * 네트워크와 저장만 한다.
 *
 * 수집 정책:
 * - 재시도하지 않는다. 실패는 실패로 기록하고 다음 회차에 다시 잰다.
 *   실패했다고 바로 다시 때리면 막힐 이유를 스스로 만든다.
 * - 요청 사이에 쉰다. 글 하나당 검색어 1~2개, 하루 몇 건이면 충분하다.
 * - 결과 화면을 못 받았으면 "미노출"이 아니라 request_failed / parse_failed로
 *   남긴다. 실패를 0위로 적으면 나중에 해석이 불가능해진다.
 */

import type { PostingRecord } from "@/lib/types/github-data";
import {
  SCHEMA_VERSION,
  buildObservationId,
  dueCheckpoints,
  hoursSince,
  type PostOutcomeObservation,
} from "./post-outcome.ts";
import { buildMobileSearchUrl, findRank, parseSerp } from "./serp-parse.ts";
import { loadObservations, recordObservation } from "./post-outcome-store";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const REQUEST_TIMEOUT_MS = 20_000;
/** 요청 사이 간격. 서두를 이유가 전혀 없다. */
const REQUEST_GAP_MS = 4_000;
const COLLECTOR_VERSION = "1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSerp(query: string): Promise<{ html: string } | { error: string }> {
  try {
    const response = await fetch(buildMobileSearchUrl(query), {
      headers: { "user-agent": MOBILE_UA, "accept-language": "ko-KR,ko;q=0.9" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { html: await response.text() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface CollectResult {
  postId: string;
  query: string;
  checkpointHours: number;
  status: PostOutcomeObservation["status"];
  rank: number | null;
  note?: string;
}

/** 글 하나의 검색어 하나를 한 번 재고 관측치로 남긴다. */
async function observeOnce(params: {
  post: PostingRecord;
  query: string;
  checkpointHours: number;
}): Promise<CollectResult> {
  const { post, query, checkpointHours } = params;
  const tracking = post.outcomeTracking;
  const capturedAt = new Date().toISOString();

  const base = {
    schemaVersion: SCHEMA_VERSION as 1,
    postId: post.postId,
    source: "serp" as const,
    capturedAt,
    postAgeHours: hoursSince(post.publishedAt, capturedAt),
    collector: { method: "crawler" as const, version: COLLECTOR_VERSION },
    observationId: buildObservationId({ postId: post.postId, source: "serp", capturedAt, query }),
  };

  const fetched = await fetchSerp(query);
  if ("error" in fetched) {
    await recordObservation({ ...base, status: "request_failed", note: fetched.error.slice(0, 200) });
    return { postId: post.postId, query, checkpointHours, status: "request_failed", rank: null, note: fetched.error };
  }

  const parsed = parseSerp(fetched.html);
  if (parsed.blocked) {
    await recordObservation({ ...base, status: "parse_failed", note: "결과 화면을 받지 못했습니다." });
    return { postId: post.postId, query, checkpointHours, status: "parse_failed", rank: null };
  }

  const target = tracking?.canonicalPost;
  if (!target) {
    await recordObservation({ ...base, status: "parse_failed", note: "추적 계약에 글 주소가 없습니다." });
    return { postId: post.postId, query, checkpointHours, status: "parse_failed", rank: null };
  }

  const { rank, searchedResultLimit } = findRank(parsed, target);
  await recordObservation({
    ...base,
    // 못 찾은 것도 성공한 관측이다. "이 시점에 이 검색어에서 안 보였다"는 사실이다.
    status: "ok",
    serp: {
      query,
      device: "mobile",
      rank,
      searchedResultLimit,
      aiBriefing: parsed.aiBriefing,
      cited: parsed.cited,
    },
  });

  return { postId: post.postId, query, checkpointHours, status: "ok", rank };
}

/**
 * 관측할 때가 된 글들을 찾아 한 바퀴 돈다.
 *
 * maxQueries로 한 실행의 요청 수를 묶는다. 밀린 글이 많아도 한 번에 몰아서
 * 때리지 않는다 — 남은 건 다음 실행에서 잰다.
 */
export async function collectDueOutcomes(params: {
  posts: PostingRecord[];
  now?: string;
  maxQueries?: number;
}): Promise<{ collected: CollectResult[]; skipped: number }> {
  const now = params.now ?? new Date().toISOString();
  const maxQueries = params.maxQueries ?? 8;

  const collected: CollectResult[] = [];
  let skipped = 0;

  const candidates = params.posts.filter(
    (post) => post.status === "published" && post.outcomeTracking && post.publishedAt
  );

  for (const post of candidates) {
    if (collected.length >= maxQueries) {
      skipped += 1;
      continue;
    }

    const existing = await loadObservations(post.postId).catch(() => []);
    const due = dueCheckpoints({ publishedAt: post.publishedAt, now, existing });
    if (due.length === 0) continue;

    // 밀린 시점이 여러 개여도 가장 이른 것 하나만 잰다. 지난 시점을 지금 재봐야
    // 그때 순위가 아니다. 몰아서 요청하는 것도 피한다.
    const checkpointHours = due[0];

    for (const keyword of post.outcomeTracking?.targetKeywords ?? []) {
      if (collected.length >= maxQueries) break;
      if (collected.length > 0) await sleep(REQUEST_GAP_MS);
      collected.push(await observeOnce({ post, query: keyword.query, checkpointHours }));
    }
  }

  return { collected, skipped };
}
