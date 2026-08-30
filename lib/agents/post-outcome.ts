/**
 * post-outcome — 발행한 글이 실제로 어떻게 됐는지 기록하는 순수 로직.
 *
 * 왜 필요한가: 지금까지 이 앱의 "학습"은 자기가 매긴 점수(evalScore)를 성과로
 * 취급했다. 실제로 몇 위에 올랐는지, AI 브리핑에 인용됐는지, 사람이 들어왔는지를
 * 앱이 전혀 몰랐다. 그래서 "가장 잘한 글"도 자기 채점 1등일 뿐이었다.
 *
 * 설계 원칙 세 가지:
 *
 * 1. 관측치는 덧붙이기만 한다(append-only). 고쳐 쓰지 않는다. 발행 목록 파일을
 *    통째로 읽고 쓰는 기존 구조에 관측 배열을 넣으면 수집기끼리 서로 덮어쓴다.
 * 2. 실패를 값으로 저장하지 않는다. 순위를 못 찾은 것과 요청이 실패한 것과
 *    화면 구조가 바뀐 것은 전부 다르다. `0위`나 `false`로 뭉개면 나중에 해석이
 *    불가능해진다.
 * 3. AI 브리핑은 "안 떴다"와 "떴는데 우리가 아니다"를 나눈다. 추천·비교형
 *    검색어에는 브리핑 자체가 잘 안 뜬다 — 그건 글의 실패가 아니다.
 */

/** 관측이 성공했는지. 실패도 사유별로 남긴다. */
export type ObservationStatus = "ok" | "not_found" | "request_failed" | "parse_failed";

/** 셋 다 필요하다. unknown을 false로 접으면 관측 실패가 미노출로 둔갑한다. */
export type Tristate = "yes" | "no" | "unknown";
export type BriefingState = "rendered" | "not_rendered" | "unknown";

export interface SerpObservation {
  query: string;
  device: "mobile" | "desktop";
  /** 블로그 영역에서 몇 번째인지. 못 찾았으면 null이고 status가 사유를 말한다. */
  rank: number | null;
  /** 몇 위까지 확인했는지. 이게 없으면 "20위 밖"인지 "3위까지만 봤는지" 모른다. */
  searchedResultLimit: number;
  aiBriefing: BriefingState;
  cited: Tristate;
}

export interface StatsObservation {
  /** 누적인지 그 기간치인지. 섞이면 합계가 거짓말이 된다. */
  viewScope: "cumulative" | "period";
  views: number;
  referrers: Array<{ source: string; ratio: number }>;
  searchQueries: Array<{ query: string; ratio: number }>;
  /** 화면이 상위 N개만 보여줬는지. 그러면 합이 100%가 안 된다. */
  truncated: boolean;
}

export interface PostOutcomeObservation {
  schemaVersion: 1;
  observationId: string;
  postId: string;
  source: "serp" | "naver_stats";
  capturedAt: string;
  /** 발행 후 몇 시간 뒤 관측인지. 날짜만으로는 시점 비교가 안 된다. */
  postAgeHours: number | null;
  status: ObservationStatus;
  collector: { method: "crawler" | "bookmarklet" | "manual"; version: string };
  serp?: SerpObservation;
  stats?: StatsObservation;
  note?: string;
}

/** 발행 시점에 고정하는 추적 계약. 나중에 주제가 바뀌어도 뭘 측정했는지 남는다. */
export interface OutcomeTracking {
  canonicalPost: { blogId: string; logNo: string; canonicalUrl: string };
  targetKeywords: Array<{ query: string; role: "primary" | "secondary" }>;
  /** 발행 당시 제목. 나중에 고쳐도 관측을 원래 글에 귀속시킨다. */
  publishedTitle: string;
  /** 본문 지문. 글이 수정되면 이전 관측과 섞으면 안 된다. */
  contentHash: string;
  trackedFrom: string;
  /**
   * 이미 발행된 글에 나중에 붙인 계약인지.
   * 소급분은 발행 당시 본문을 모르므로 수정 여부를 판단할 수 없고, 지나간
   * 관측 시점도 영영 못 잰다. 나중에 데이터를 볼 때 구분해야 한다.
   */
  backfilled?: boolean;
}

export const SCHEMA_VERSION = 1;
/** 이만큼 성공 관측이 쌓여야 학습에 쓴다. 한 번 보고 승자를 정하면 잡음을 배운다. */
export const MIN_CONFIDENT_OBSERVATIONS = 2;

// ── 네이버 글 주소 정규화 ──────────────────────────────────

const URL_PATTERNS: RegExp[] = [
  /blog\.naver\.com\/([^/?#]+)\/(\d+)/i,
  /blog\.naver\.com\/PostView\.naver\?[^#]*blogId=([^&]+)[^#]*logNo=(\d+)/i,
];

/**
 * 모바일 주소, PostView 주소, 리디렉션 주소가 전부 같은 글을 가리킨다.
 * 정규화하지 않으면 AI 브리핑 출처가 우리 글인지 대조할 수 없다.
 */
export function parseNaverPostUrl(
  url: string | null | undefined
): { blogId: string; logNo: string; canonicalUrl: string } | null {
  if (!url) return null;
  const cleaned = url.trim().replace(/^https?:\/\/m\./i, "https://");
  for (const pattern of URL_PATTERNS) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const [, blogId, logNo] = match;
    return {
      blogId,
      logNo,
      canonicalUrl: `https://blog.naver.com/${blogId}/${logNo}`,
    };
  }
  return null;
}

/** 두 주소가 같은 글인지. 표기가 달라도 같으면 같다고 봐야 한다. */
export function isSamePost(left: string | null, right: string | null): boolean {
  const a = parseNaverPostUrl(left);
  const b = parseNaverPostUrl(right);
  if (!a || !b) return false;
  return a.blogId === b.blogId && a.logNo === b.logNo;
}

export function buildObservationId(params: {
  postId: string;
  source: string;
  capturedAt: string;
  query?: string;
}): string {
  const stamp = params.capturedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const slug = (params.query ?? "").replace(/\s+/g, "-").slice(0, 24);
  return [stamp, params.source, slug].filter(Boolean).join("_");
}

export function hoursSince(publishedAt: string | null, at: string): number | null {
  if (!publishedAt) return null;
  const from = new Date(publishedAt).getTime();
  const to = new Date(at).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 3_600_000));
}

// ── 관측 시점 ─────────────────────────────────────────────

/**
 * 발행 직후 / 7일 / 14일 / 28일.
 *
 * 두 점(7일·28일)만 재려다 늘렸다. 두 점으로는 색인 지연, 순위 급등락, 경쟁 글
 * 등장이 전부 뒤섞여 원인을 못 가린다. 특히 발행 직후 관측이 있어야 "처음부터
 * 안 잡힌 것"과 "잡혔다가 밀린 것"이 구분된다.
 */
export const CHECKPOINT_HOURS = [0, 168, 336, 672] as const;
/** 28일이 지난 뒤에도 이 간격으로 계속 지켜본다. 순위는 나중에도 움직인다. */
export const ONGOING_INTERVAL_HOURS = 672;

/**
 * 지금 재야 할 시점 하나. 없으면 null.
 *
 * 각 시점에는 "그 구간 안에서만 유효하다"는 창이 있다. 7일차 관측을 21일에
 * 재면 그건 7일차가 아니다. 수집기가 며칠 멈췄거나 오래된 글을 소급 추적할 때
 * 지나간 시점을 지금 채우면 라벨과 실제가 어긋난 데이터가 쌓인다. 놓친 구간은
 * 놓친 채로 두는 게 맞다.
 *
 * 28일을 넘긴 글은 어느 구간에도 안 들어가므로, 마지막 성공 관측이 28일보다
 * 오래됐으면 다시 잰다. 소급 추적한 옛날 글도 이 경로로 잡힌다.
 *
 * 실패 관측은 "쟀다"로 치지 않는다. 실패했으면 아직 못 잰 것이다.
 */
export function dueCheckpoint(params: {
  publishedAt: string | null;
  now: string;
  existing: PostOutcomeObservation[];
}): number | null {
  return dueCheckpointFromAges({
    publishedAt: params.publishedAt,
    now: params.now,
    okAgeHours: okSerpAges(params.existing),
  });
}

/** 관측치 원본에서 판정에 쓰는 값만 뽑는다. 색인에 담는 것도 이것뿐이다. */
export function okSerpAges(observations: PostOutcomeObservation[]): number[] {
  return observations
    .filter((item) => item.status === "ok" && item.source === "serp")
    .map((item) => item.postAgeHours)
    .filter((hours): hours is number => typeof hours === "number");
}

/**
 * 위와 같은 판정을, 관측치 원본 대신 "성공적으로 잰 시점들"만으로 한다.
 *
 * 수집기는 글 한 건씩 폴더를 열어보는 대신 색인 하나를 읽는다. 306건이면
 * 왕복 600번이 1번이 된다. 판정 규칙은 한 곳(아래)에만 둔다.
 */
export function dueCheckpointFromAges(params: {
  publishedAt: string | null;
  now: string;
  okAgeHours: number[];
}): number | null {
  const age = hoursSince(params.publishedAt, params.now);
  if (age === null) return null;

  const measured = params.okAgeHours;

  for (let i = 0; i < CHECKPOINT_HOURS.length; i += 1) {
    const checkpoint = CHECKPOINT_HOURS[i];
    // 마지막 구간의 창을 무한대로 두면 그 뒤 모든 관측이 "이미 쟀다"로 잡혀
    // 아래 지속 관측 경로가 영영 실행되지 않는다.
    const windowEnd = CHECKPOINT_HOURS[i + 1] ?? checkpoint + ONGOING_INTERVAL_HOURS;
    if (age < checkpoint || age >= windowEnd) continue;
    const covered = measured.some((hours) => hours >= checkpoint && hours < windowEnd);
    return covered ? null : checkpoint;
  }

  // 마지막 구간을 넘긴 글. 한동안 안 쟀으면 다시 잰다.
  const lastMeasured = measured.length > 0 ? Math.max(...measured) : null;
  if (lastMeasured === null || age - lastMeasured >= ONGOING_INTERVAL_HOURS) {
    return CHECKPOINT_HOURS[CHECKPOINT_HOURS.length - 1];
  }
  return null;
}

// ── 관측 색인 ─────────────────────────────────────────────

/**
 * 글 하나가 지금까지 어떻게 관측됐는지의 요약. 순위값은 담지 않는다.
 *
 * 담는 것은 "다음에 언제 재야 하는가"를 판정하는 데 필요한 것뿐이다. 순위나
 * 인용 여부까지 여기 넣으면 관측치 파일과 같은 사실을 두 곳에 적는 꼴이 되고,
 * 둘이 어긋나는 순간 어느 쪽이 맞는지 알 수 없다. 사실의 원본은 관측치 파일이다.
 */
export interface OutcomeIndexEntry {
  /** 성공적으로 잰 시점들(발행 후 몇 시간차). 판정에 쓰는 값. */
  okAgeHours: number[];
  lastCapturedAt: string;
  /** 실패까지 포함한 관측 수. 계속 실패만 쌓이는 글을 눈으로 찾을 때 쓴다. */
  total: number;
  lastStatus: ObservationStatus;
}

export interface OutcomeIndex {
  schemaVersion: 1;
  updatedAt: string;
  posts: Record<string, OutcomeIndexEntry>;
}

export function emptyOutcomeIndex(): OutcomeIndex {
  return { schemaVersion: SCHEMA_VERSION as 1, updatedAt: new Date(0).toISOString(), posts: {} };
}

/** 색인이 없거나 깨졌을 때 관측치 원본에서 다시 만든다. 원본이 항상 우선이다. */
export function indexEntryFromObservations(
  observations: PostOutcomeObservation[]
): OutcomeIndexEntry | null {
  if (observations.length === 0) return null;
  const sorted = [...observations].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const last = sorted[sorted.length - 1];
  return {
    okAgeHours: okSerpAges(sorted),
    lastCapturedAt: last.capturedAt,
    total: sorted.length,
    lastStatus: last.status,
  };
}

/**
 * 새 관측치를 색인에 얹는다. 원본을 고치지 않고 새 객체를 낸다.
 *
 * 같은 시점을 두 번 적지 않는다 — 재시도나 중복 실행으로 같은 관측이 다시
 * 들어와도 okAgeHours가 부풀지 않아야 판정이 흔들리지 않는다.
 */
export function applyObservationsToIndex(
  index: OutcomeIndex,
  observations: PostOutcomeObservation[],
  at: string = new Date().toISOString()
): OutcomeIndex {
  const posts: Record<string, OutcomeIndexEntry> = { ...index.posts };

  for (const observation of observations) {
    const previous = posts[observation.postId];
    const ages = new Set(previous?.okAgeHours ?? []);
    for (const age of okSerpAges([observation])) ages.add(age);

    posts[observation.postId] = {
      okAgeHours: [...ages].sort((a, b) => a - b),
      lastCapturedAt:
        previous && previous.lastCapturedAt > observation.capturedAt
          ? previous.lastCapturedAt
          : observation.capturedAt,
      total: (previous?.total ?? 0) + 1,
      lastStatus: observation.status,
    };
  }

  return { schemaVersion: SCHEMA_VERSION as 1, updatedAt: at, posts };
}

// ── 요약 ──────────────────────────────────────────────────

export interface OutcomeSummary {
  observationCount: number;
  okCount: number;
  /** 지금까지 가장 좋았던 순위. 못 찾은 관측은 계산에서 뺀다. */
  bestRank: number | null;
  latestRank: number | null;
  /** 한 번이라도 AI 브리핑에 인용됐는지. */
  everCited: boolean;
  /** 브리핑이 뜬 적은 있는지. 안 떴다면 그 검색어가 애초에 브리핑용이 아니다. */
  briefingEverRendered: boolean;
  latestViews: number | null;
  /** 실제로 사람이 들어온 검색어. 노린 것과 다를 수 있고, 그 차이가 학습 재료다. */
  inboundQueries: Array<{ query: string; ratio: number }>;
  /** 학습에 쓸 만큼 쌓였는지. 아니면 이 글은 아직 판단하지 않는다. */
  confident: boolean;
}

export function summarizeOutcomes(observations: PostOutcomeObservation[]): OutcomeSummary {
  const sorted = [...observations].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const ok = sorted.filter((item) => item.status === "ok");

  const ranks = ok
    .map((item) => item.serp?.rank)
    .filter((rank): rank is number => typeof rank === "number");

  const latestSerp = [...ok].reverse().find((item) => item.serp);
  const latestStats = [...ok].reverse().find((item) => item.stats);

  return {
    observationCount: sorted.length,
    okCount: ok.length,
    bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
    latestRank: latestSerp?.serp?.rank ?? null,
    everCited: ok.some((item) => item.serp?.cited === "yes"),
    briefingEverRendered: ok.some((item) => item.serp?.aiBriefing === "rendered"),
    latestViews: latestStats?.stats?.views ?? null,
    inboundQueries: latestStats?.stats?.searchQueries ?? [],
    confident: ok.length >= MIN_CONFIDENT_OBSERVATIONS,
  };
}

/**
 * 실제 성과로 글을 줄 세운다.
 *
 * 내부 평가점수는 여기 안 들어간다. 그걸 섞으면 자기 채점이 다시 승자를 정한다 —
 * 실측을 도입하는 이유가 사라진다. 관측이 모자란 글은 아예 후보에서 뺀다.
 */
export function rankByOutcome<T extends { summary: OutcomeSummary }>(items: T[]): T[] {
  return items
    .filter((item) => item.summary.confident)
    .sort((left, right) => {
      // AI 인용이 가장 강한 신호다. 노출 표면 자체가 다르다.
      if (left.summary.everCited !== right.summary.everCited) {
        return left.summary.everCited ? -1 : 1;
      }
      const leftRank = left.summary.bestRank ?? Number.POSITIVE_INFINITY;
      const rightRank = right.summary.bestRank ?? Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (right.summary.latestViews ?? 0) - (left.summary.latestViews ?? 0);
    });
}

/**
 * 발행 시점에 추적 계약을 박는다.
 *
 * 왜 발행할 때인가: 나중에 토픽 제목이나 키워드가 바뀌면 "이 글이 뭘 노렸는지"가
 * 사라진다. 그러면 관측치를 원래 전략에 귀속할 수 없다. 주소를 못 읽으면 아예
 * 만들지 않는다 — 대상을 특정 못 하는 추적은 잘못된 글에 붙을 수 있다.
 */
export function buildOutcomeTracking(params: {
  naverPostUrl: string | null;
  title: string;
  content: string;
  targetKeywords: string[];
  at?: string;
  backfilled?: boolean;
}): OutcomeTracking | null {
  const canonical = parseNaverPostUrl(params.naverPostUrl);
  if (!canonical) return null;

  const queries = params.targetKeywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (queries.length === 0) return null;

  return {
    canonicalPost: canonical,
    targetKeywords: queries.map((query, index) => ({
      query,
      role: index === 0 ? "primary" : "secondary",
    })),
    publishedTitle: params.title.trim(),
    contentHash: hashContent(params.content),
    trackedFrom: params.at ?? new Date().toISOString(),
    ...(params.backfilled ? { backfilled: true } : {}),
  };
}

/** 본문이 바뀌었는지. 바뀐 글의 관측을 이전 전략에 귀속시키면 안 된다. */
export function hashContent(content: string): string {
  let hash = 2166136261;
  const normalized = content.replace(/\s+/g, " ").trim();
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
