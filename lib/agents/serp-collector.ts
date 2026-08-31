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
  backoffUntil,
  buildObservationId,
  dueCheckpointFromAges,
  hoursSince,
  queryStateKey,
  type PostOutcomeObservation,
  type SerpSurface,
  type TargetKeyword,
} from "./post-outcome.ts";
import {
  buildBlogTabSearchUrl,
  buildMobileSearchUrl,
  findOurs,
  findRank,
  parseSerp,
} from "./serp-parse.ts";
import { ensureOutcomeIndex, recordObservations } from "./post-outcome-store";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const REQUEST_TIMEOUT_MS = 20_000;
/** 요청 사이 간격. 서두를 이유가 전혀 없다. */
const REQUEST_GAP_MS = 4_000;
const COLLECTOR_VERSION = "1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 두 화면을 다 잰다. 같은 검색어라도 통합검색과 블로그 탭은 다른 사실이다. */
export const SERP_SURFACES: SerpSurface[] = ["integrated", "blog_tab"];

function urlFor(surface: SerpSurface, query: string): string {
  return surface === "blog_tab" ? buildBlogTabSearchUrl(query) : buildMobileSearchUrl(query);
}

async function fetchSerp(
  surface: SerpSurface,
  query: string
): Promise<{ html: string } | { error: string }> {
  try {
    const response = await fetch(urlFor(surface, query), {
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
  surface: SerpSurface;
  checkpointHours: number;
  status: PostOutcomeObservation["status"];
  rank: number | null;
  note?: string;
}

/**
 * 글 하나의 검색어 하나를 한 번 잰다.
 *
 * 저장은 하지 않고 관측치를 돌려준다. 저장은 한 바퀴가 끝난 뒤 한 번에 한다 —
 * 여기서 건건이 쓰면 커밋이 관측 수만큼 생긴다.
 */
async function observeOnce(params: {
  post: PostingRecord;
  keyword: TargetKeyword;
  surface: SerpSurface;
  checkpointHours: number;
  ourBlogIds: ReadonlySet<string>;
}): Promise<{ result: CollectResult; observation: PostOutcomeObservation }> {
  const { post, keyword, surface, checkpointHours, ourBlogIds } = params;
  const query = keyword.query;
  const tracking = post.outcomeTracking;
  const capturedAt = new Date().toISOString();

  const base = {
    schemaVersion: SCHEMA_VERSION as 1,
    postId: post.postId,
    source: "serp" as const,
    capturedAt,
    postAgeHours: hoursSince(post.publishedAt, capturedAt),
    collector: { method: "crawler" as const, version: COLLECTOR_VERSION },
    observationId: buildObservationId({
      postId: post.postId,
      source: "serp",
      capturedAt,
      query: `${surface}-${query}`,
    }),
    // 실패해도 무엇을 재려 했는지는 남는다. 이게 없으면 그 검색어의 실패가
    // 색인에 붙지 않아 "계속 실패하면 쉬게 한다"가 작동하지 않는다.
    target: { surface, query },
  };

  const failed = (
    status: PostOutcomeObservation["status"],
    note: string
  ): { result: CollectResult; observation: PostOutcomeObservation } => ({
    observation: { ...base, status, note: note.slice(0, 200) },
    result: { postId: post.postId, query, surface, checkpointHours, status, rank: null, note },
  });

  const fetched = await fetchSerp(surface, query);
  if ("error" in fetched) return failed("request_failed", fetched.error);

  const parsed = parseSerp(fetched.html);
  if (parsed.blocked) return failed("parse_failed", "결과 화면을 받지 못했습니다.");

  const target = tracking?.canonicalPost;
  if (!target) return failed("parse_failed", "추적 계약에 글 주소가 없습니다.");

  const { rank, searchedResultLimit } = findRank(parsed, target);
  return {
    observation: {
      ...base,
      // 못 찾은 것도 성공한 관측이다. "이 시점에 이 검색어에서 안 보였다"는 사실이다.
      status: "ok",
      serp: {
        query,
        surface,
        // 사람이 정한 말인지 앱이 제목에서 추측한 말인지. 성적 해석이 여기서 갈린다.
        querySource: keyword.source ?? "title_guess",
        device: "mobile",
        rank,
        searchedResultLimit,
        // 추적 글이 없어도 우리 블로그의 다른 글이 잡혔을 수 있다. 그게 더 중요한 사실이다.
        ours: findOurs(parsed, ourBlogIds),
        aiBriefing: parsed.aiBriefing,
        cited: parsed.cited,
      },
    },
    result: { postId: post.postId, query, surface, checkpointHours, status: "ok", rank },
  };
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
}): Promise<{
  collected: CollectResult[];
  skipped: number;
  due: number;
  waiting: number;
  commitSha: string;
}> {
  const now = params.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const maxQueries = params.maxQueries ?? 8;

  // 색인 한 번. 예전에는 글마다 폴더를 열어봤고, 306건이면 그것만으로 왕복 600번이었다.
  const index = await ensureOutcomeIndex();

  const candidates = params.posts.filter(
    (post) => post.status === "published" && post.outcomeTracking && post.publishedAt
  );

  interface DueItem {
    post: PostingRecord;
    keyword: TargetKeyword;
    surface: SerpSurface;
    checkpointHours: number;
    lastAttemptAt: string;
  }

  // 우리 블로그 목록. 추적 계약의 주소에서 모은다 — 따로 설정할 것이 없다.
  const ourBlogIds = new Set(
    candidates
      .map((post) => post.outcomeTracking?.canonicalPost.blogId)
      .filter((blogId): blogId is string => Boolean(blogId))
  );

  const dueItems: DueItem[] = [];
  let waiting = 0;

  for (const post of candidates) {
    for (const keyword of post.outcomeTracking?.targetKeywords ?? []) {
      for (const surface of SERP_SURFACES) {
        const state =
          index.posts[post.postId]?.queries?.[queryStateKey(surface, keyword.query)];
        const checkpointHours = dueCheckpointFromAges({
          publishedAt: post.publishedAt,
          now,
          okAgeHours: state?.okAgeHours ?? [],
        });
        if (checkpointHours === null) continue;

        // 계속 실패한 검색어는 쉬게 둔다. 안 그러면 앞쪽 실패가 한 회차를 다 먹는다.
        if (backoffUntil(state) > nowMs) {
          waiting += 1;
          continue;
        }

        dueItems.push({
          post,
          keyword,
          surface,
          checkpointHours,
          lastAttemptAt: state?.lastAttemptAt ?? "",
        });
      }
    }
  }

  // 오래 안 재본 것부터. 한 번도 안 잰 것(빈 문자열)이 맨 앞에 온다.
  // 목록 순서대로 돌면 앞쪽 글만 계속 재고 뒤쪽은 차례가 오지 않는다.
  dueItems.sort((left, right) => left.lastAttemptAt.localeCompare(right.lastAttemptAt));

  const collected: CollectResult[] = [];
  const observations: PostOutcomeObservation[] = [];

  for (const item of dueItems.slice(0, maxQueries)) {
    if (collected.length > 0) await sleep(REQUEST_GAP_MS);
    const observed = await observeOnce({
      post: item.post,
      keyword: item.keyword,
      surface: item.surface,
      checkpointHours: item.checkpointHours,
      ourBlogIds,
    });
    collected.push(observed.result);
    observations.push(observed.observation);
  }

  // 한 바퀴 = 커밋 하나. 쓰다가 실패하면 관측치는 버린다 — 다음 회차에 다시 재면 된다.
  const { commitSha } = await recordObservations(observations, {
    ranAt: now,
    // 몇 건을 재려고 했는지. 0이면 "잴 게 없던 회차"라 실패로 세지 않는다.
    attempted: collected.length,
    anyOk: collected.some((item) => item.status === "ok"),
  });

  return {
    collected,
    skipped: Math.max(dueItems.length - collected.length, 0),
    due: dueItems.length,
    waiting,
    commitSha,
  };
}
