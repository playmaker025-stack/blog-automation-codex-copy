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

/**
 * 이 검색어가 어디서 왔는지.
 *
 * 성적을 해석할 때 결정적이다. 앱이 제목을 잘라 만든 말은 사람이 실제로 치는
 * 말이 아닐 수 있어서, 그 검색어의 "미노출"은 글의 실패가 아니라 검색어의 실패다.
 * 둘을 섞으면 무엇이 잘된 글인지 영영 못 가린다.
 */
export type KeywordSource = "user" | "topic" | "title_guess";

/**
 * 어느 화면에서 잰 순위인지.
 *
 * 둘은 다른 사실이다. 실측(2026-08-31, "무화량 많은 전자담배"):
 * 통합검색에는 블로그 글이 27개, 블로그 탭에는 30개가 실렸는데 **순서도
 * 구성도 달랐다.** "인천 전자담배"는 통합검색에 7개뿐이었고, "dna60"은
 * 통합검색에 블로그 영역 자체가 없었다(0개).
 *
 * - integrated: 사람이 검색하면 실제로 보이는 자리. 얕지만 이게 진짜 노출이다.
 * - blog_tab: 항상 30개까지 보인다. 통합검색에 안 떠도 어디쯤인지 알 수 있다.
 */
export type SerpSurface = "integrated" | "blog_tab";

export interface SerpObservation {
  query: string;
  /** 없으면 옛 데이터다. 옛 데이터는 전부 통합검색이었다. */
  surface?: SerpSurface;
  /**
   * 이 검색어에 걸린 **우리 블로그 글 전부**의 자리.
   *
   * 추적 중인 글 하나만 보면 "우리가 이 검색어에서 보이나"에 답할 수 없다.
   * 실측: 추적 글은 없었지만 같은 블로그의 다른 글 6개가 5·7·8·9·11·12위를
   * 차지하고 있었다. 그걸 미노출이라고 적으면 사실과 정반대가 된다.
   */
  ours?: Array<{ blogId: string; logNo: string; rank: number }>;
  /** 잰 시점의 검색어 출처. 나중에 계약이 바뀌어도 이 관측의 성격은 남는다. */
  querySource?: KeywordSource;
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
  /**
   * 무엇을 재려고 했는지. 성공·실패와 무관하게 남긴다.
   *
   * 실패 관측에는 serp가 없다. 그런데 색인 키를 serp에서만 뽑았더니 실패가
   * 전부 "검색어 없음" 칸에 쌓였고, 그 검색어의 연속 실패는 0인 채라 쉬게
   * 하려던 장치가 한 번도 작동하지 않았다. 재려던 대상은 따로 남겨야 한다.
   */
  target?: { surface: SerpSurface; query: string };
  serp?: SerpObservation;
  stats?: StatsObservation;
  note?: string;
}

/** 발행 시점에 고정하는 추적 계약. 나중에 주제가 바뀌어도 뭘 측정했는지 남는다. */
export interface OutcomeTracking {
  canonicalPost: { blogId: string; logNo: string; canonicalUrl: string };
  /**
   * 이 글이 노린 검색어들. 사장님이 직접 넣은 것이 가장 정확하다.
   *
   * 하나로 제한하지 않는다. 글 하나가 여러 검색어를 노리는 건 정상이고,
   * 실제로 어느 말로 걸리는지는 재봐야 안다. 다만 검색어마다 요청이 하나씩
   * 늘어나므로 MAX_TARGET_KEYWORDS로 묶는다.
   */
  targetKeywords: TargetKeyword[];
  /** 검색어를 사람이 마지막으로 손본 시각. 언제부터 믿을 수 있는 값인지 남긴다. */
  keywordsRevisedAt?: string;
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

export interface TargetKeyword {
  query: string;
  role: "primary" | "secondary";
  /** 없으면 옛 데이터다. 옛 데이터는 전부 제목에서 추측한 것이었다. */
  source?: KeywordSource;
}

/**
 * 검색어를 검색창에 칠 수 있는 꼴로 다듬는다.
 *
 * 제목에서 잘라온 값에는 문장부호가 그대로 붙어 있다("전자담배 관리법 :").
 * 그 상태로 검색하면 결과가 달라지고, 화면에도 지저분하게 남는다.
 */
export function normalizeQuery(query: string): string {
  return query
    .replace(/[.,:!?~·|/\[\]()"'“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 검색어라고 부를 수 있는 값인지. 부호만 남은 조각은 검색어가 아니다. */
export function isUsableQuery(query: string): boolean {
  const normalized = normalizeQuery(query);
  return normalized.length >= 2 && /[가-힣a-zA-Z0-9]{2,}/.test(normalized);
}

/** 사람이 정한 검색어인지. 성적 계산에 쓸 수 있는 건 이것뿐이다. */
export function isDeclared(source: KeywordSource | undefined): boolean {
  return source === "user" || source === "topic";
}

/**
 * 한 글이 가질 수 있는 검색어 수.
 *
 * 검색어 하나가 관측 시점마다 요청 하나다. 글 306개에 검색어를 무제한으로 두면
 * 한 바퀴가 끝나지 않는다. 여덟 개면 노리는 말을 다 담고도 남는다.
 */
export const MAX_TARGET_KEYWORDS = 8;

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
  // 밀리초까지 쓴다. 초 단위로 자르면 검색어 없는 관측(통계)은 같은 초에 두 건이
  // 들어오는 순간 확실히 부딪히고, 나중 관측이 앞 관측을 덮는다.
  const stamp = params.capturedAt.replace(/[^0-9]/g, "").slice(0, 17);
  // 이 값이 파일 이름이 된다. 검색어를 그대로 쓰면 ":"이나 "/"가 섞여 들어오고,
  // 윈도우는 그런 이름의 파일을 만들지 못한다. 실제로 "전자담배 관리법 :"이
  // 그런 파일을 만들어 로컬에서 저장소를 받을 수 없게 만들었다. "/"는 더 나빠서
  // 폴더가 하나 더 생긴다. 한글·영숫자·하이픈만 남긴다.
  const slug = (params.query ?? "")
    .replace(/\s+/g, "-")
    .replace(/[^가-힣a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  // 같은 밀리초에 앞 24자가 같은 검색어가 겹칠 수 있다. 짧은 지문으로 갈라준다.
  const fingerprint = hashContent(`${params.postId}|${params.source}|${params.query ?? ""}`).slice(0, 6);
  return [stamp, params.source, slug, fingerprint].filter(Boolean).join("_");
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
 * 검색어 하나가 지금까지 어떻게 관측됐는지.
 *
 * 왜 글이 아니라 검색어 단위인가: 예전에는 "이 글을 쟀는가"를 글 단위로 봤다.
 * 그래서 검색어가 둘인 글은 첫 번째만 재고도 "쟀음"이 되어 두 번째가 영영
 * 안 재졌다. 검색어를 새로 바꿔도 마찬가지로 "이미 쟀음"이라 새 말은 측정이
 * 시작되지 않는다. 재는 단위가 검색어이므로 기록하는 단위도 검색어여야 한다.
 */
export interface OutcomeQueryState {
  /** 성공적으로 잰 시점들(발행 후 몇 시간차). 다음에 잴 때를 정하는 값. */
  okAgeHours: number[];
  lastCapturedAt: string;
  total: number;
  lastStatus: ObservationStatus;
  /** 연속으로 실패한 횟수. 계속 실패하는 검색어를 뒤로 미루는 데 쓴다. */
  consecutiveFailures: number;
  /** 성공이든 실패든 마지막으로 시도한 시각. 차례를 공평하게 도는 데 쓴다. */
  lastAttemptAt: string;
}

export interface OutcomeIndexEntry {
  queries: Record<string, OutcomeQueryState>;
  lastCapturedAt: string;
  /** 실패까지 포함한 관측 수. 검색어 없는 관측(통계)도 여기에 센다. */
  total: number;
}

/** 수집기가 살아 있는지. 사람이 안 보는 기능이라 상태를 남겨야 한다. */
export interface CollectorHealth {
  lastRunAt: string;
  /** 마지막으로 한 건이라도 성공한 시각. */
  lastOkAt?: string;
  /**
   * 잴 것이 있었는데 한 건도 성공하지 못한 회차가 연달아 몇 번인지.
   *
   * 잴 것이 없어서 그냥 지나간 회차는 세지 않는다. 처음에는 그것까지 셌는데,
   * 밀린 게 다 끝나고 나니 정상인 상태에서 "연속 실패 31회"가 찍혔다. 늘 켜져
   * 있는 경보는 경보가 아니다.
   */
  consecutiveFailedRuns: number;
}

/** 한 회차가 끝난 뒤 건강 상태를 갱신한다. */
export function nextCollectorHealth(
  previous: CollectorHealth | undefined,
  run: { ranAt: string; attempted: number; anyOk: boolean }
): CollectorHealth {
  // 잴 것이 없던 회차. 수집기는 살아 있으니 시각만 갱신한다.
  if (run.attempted === 0) {
    return {
      lastRunAt: run.ranAt,
      ...(previous?.lastOkAt ? { lastOkAt: previous.lastOkAt } : {}),
      consecutiveFailedRuns: previous?.consecutiveFailedRuns ?? 0,
    };
  }

  return {
    lastRunAt: run.ranAt,
    ...(run.anyOk
      ? { lastOkAt: run.ranAt }
      : previous?.lastOkAt
        ? { lastOkAt: previous.lastOkAt }
        : {}),
    consecutiveFailedRuns: run.anyOk ? 0 : (previous?.consecutiveFailedRuns ?? 0) + 1,
  };
}

export interface OutcomeIndex {
  schemaVersion: number;
  updatedAt: string;
  posts: Record<string, OutcomeIndexEntry>;
  health?: CollectorHealth;
}

/** 색인 판이 바뀌면 올린다. 낮으면 관측치 원본에서 다시 만든다. */
export const OUTCOME_INDEX_VERSION = 3;

/**
 * 낡은 판의 색인을 그 자리에서 올린다.
 *
 * 판이 바뀔 때마다 관측치 원본을 전부 뒤져 다시 만들게 했더니, 글 330개에
 * 왕복 1,000번이 요청마다 일어나 GitHub API 한도를 태웠다. 앱 전체가 멈췄다.
 * 판 올리기는 키 모양만 바뀌는 일이라 읽지 않고도 할 수 있다.
 *
 * 모양을 모르는 낡은 판은 빈 색인으로 시작한다. 그러면 한 바퀴 다시 재게 되지만,
 * 그건 회차당 상한이 걸린 일이라 앱을 멈추지 않는다.
 */
export function migrateOutcomeIndex(index: OutcomeIndex): OutcomeIndex {
  if (index.schemaVersion === OUTCOME_INDEX_VERSION) return index;

  // 2판: 검색어만 키였다. 화면 축이 없었으니 전부 통합검색이다.
  if (index.schemaVersion === 2 && index.posts) {
    const posts: Record<string, OutcomeIndexEntry> = {};
    for (const [postId, entry] of Object.entries(index.posts)) {
      const queries: Record<string, OutcomeQueryState> = {};
      for (const [query, state] of Object.entries(entry.queries ?? {})) {
        queries[query === NO_QUERY_KEY ? NO_QUERY_KEY : queryStateKey("integrated", query)] = state;
      }
      posts[postId] = { ...entry, queries };
    }
    return { ...index, schemaVersion: OUTCOME_INDEX_VERSION, posts };
  }

  return emptyOutcomeIndex();
}

export function emptyOutcomeIndex(): OutcomeIndex {
  return {
    schemaVersion: OUTCOME_INDEX_VERSION,
    updatedAt: new Date(0).toISOString(),
    posts: {},
  };
}

/** 검색어 없는 관측(통계 등)을 담는 자리. 순위 판정에는 쓰지 않는다. */
export const NO_QUERY_KEY = "";

/**
 * 색인에서 이 관측을 세는 칸.
 *
 * 화면까지 키에 넣는다. 통합검색만 재고 "이 검색어는 쟀음"으로 처리하면
 * 블로그 탭은 영영 안 재진다 — 검색어 단위로 바꾸기 전에 겪은 것과 같은 결함이
 * 화면 축에서 되풀이된다.
 */
export function queryStateKey(surface: SerpSurface, query: string): string {
  return `${surface}::${query}`;
}

function queryKeyOf(observation: PostOutcomeObservation): string {
  if (observation.source !== "serp") return NO_QUERY_KEY;
  // 재려던 대상이 먼저다. 실패 관측에는 serp가 없다.
  if (observation.target) {
    return queryStateKey(observation.target.surface, observation.target.query);
  }
  if (observation.serp) {
    return queryStateKey(observation.serp.surface ?? "integrated", observation.serp.query);
  }
  return NO_QUERY_KEY;
}

/** 색인이 없거나 판이 낡았을 때 관측치 원본에서 다시 만든다. 원본이 항상 우선이다. */
export function indexEntryFromObservations(
  observations: PostOutcomeObservation[]
): OutcomeIndexEntry | null {
  if (observations.length === 0) return null;
  const sorted = [...observations].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  const entry: OutcomeIndexEntry = {
    queries: {},
    lastCapturedAt: sorted[sorted.length - 1].capturedAt,
    total: sorted.length,
  };

  for (const observation of sorted) {
    entry.queries[queryKeyOf(observation)] = applyToQueryState(
      entry.queries[queryKeyOf(observation)],
      observation
    );
  }

  return entry;
}

function applyToQueryState(
  previous: OutcomeQueryState | undefined,
  observation: PostOutcomeObservation
): OutcomeQueryState {
  const ok = observation.status === "ok" && observation.source === "serp";
  const ages = new Set(previous?.okAgeHours ?? []);
  if (ok && typeof observation.postAgeHours === "number") ages.add(observation.postAgeHours);

  // 시간을 거스르지 않는다. 사람이 손으로 넣은 옛 관측이 뒤늦게 들어와도
  // "가장 최근 상태"가 과거로 덮이면 안 된다.
  const isNewest = !previous || observation.capturedAt >= previous.lastCapturedAt;

  return {
    okAgeHours: [...ages].sort((a, b) => a - b),
    lastCapturedAt: isNewest ? observation.capturedAt : previous.lastCapturedAt,
    total: (previous?.total ?? 0) + 1,
    lastStatus: isNewest ? observation.status : previous.lastStatus,
    // 늦게 도착한 옛 실패가 최신 성공을 뒤엎으면 안 된다. 시간순으로만 센다.
    consecutiveFailures: !isNewest
      ? previous.consecutiveFailures
      : ok
        ? 0
        : (previous?.consecutiveFailures ?? 0) + 1,
    lastAttemptAt: isNewest ? observation.capturedAt : previous.lastAttemptAt,
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
    const key = queryKeyOf(observation);
    const queries = { ...(previous?.queries ?? {}) };
    queries[key] = applyToQueryState(queries[key], observation);

    posts[observation.postId] = {
      queries,
      lastCapturedAt:
        previous && previous.lastCapturedAt > observation.capturedAt
          ? previous.lastCapturedAt
          : observation.capturedAt,
      total: (previous?.total ?? 0) + 1,
    };
  }

  return {
    schemaVersion: OUTCOME_INDEX_VERSION,
    updatedAt: at,
    posts,
    ...(index.health ? { health: index.health } : {}),
  };
}

/**
 * 계속 실패하는 검색어를 잠시 쉬게 한다.
 *
 * 실패는 "쟀다"로 치지 않으므로 다음 회차에 또 후보가 된다. 앞쪽 글 몇 개가
 * 계속 실패하면 한 회차 몫을 전부 먹어서 뒤에 있는 글은 차례가 영영 안 온다.
 * 실패할수록 간격을 벌리되 하루를 넘기지 않는다.
 */
export function backoffUntil(state: OutcomeQueryState | undefined): number {
  if (!state || state.consecutiveFailures === 0) return 0;
  const hours = Math.min(2 ** (state.consecutiveFailures - 1), 24);
  return new Date(state.lastAttemptAt).getTime() + hours * 3_600_000;
}

// ── 요약 ──────────────────────────────────────────────────

export interface OutcomeSummary {
  observationCount: number;
  okCount: number;
  /** 사람이 정한 검색어로 잰 성공 관측 수. 성적으로 쓸 수 있는 건 이것뿐이다. */
  declaredOkCount: number;
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
  /**
   * 관측은 있는데 전부 앱이 추측한 검색어로 잰 것인지.
   *
   * 이 글의 "미노출"은 글의 실패가 아니라 검색어의 실패일 수 있다. 성적으로
   * 쓰면 안 되고, 사람이 검색어를 정해줘야 하는 글이라는 표시다.
   */
  guessedOnly: boolean;
}

export function summarizeOutcomes(observations: PostOutcomeObservation[]): OutcomeSummary {
  const sorted = [...observations].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const ok = sorted.filter((item) => item.status === "ok");
  // 순위 관측만 검색어 출처를 따진다. 통계 관측은 실제 유입이라 추측이 아니다.
  const declaredOk = ok.filter(
    (item) => item.source !== "serp" || isDeclared(item.serp?.querySource)
  );

  const ranks = ok
    .map((item) => item.serp?.rank)
    .filter((rank): rank is number => typeof rank === "number");

  const latestSerp = [...ok].reverse().find((item) => item.serp);
  const latestStats = [...ok].reverse().find((item) => item.stats);

  return {
    observationCount: sorted.length,
    okCount: ok.length,
    declaredOkCount: declaredOk.length,
    bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
    latestRank: latestSerp?.serp?.rank ?? null,
    everCited: ok.some((item) => item.serp?.cited === "yes"),
    briefingEverRendered: ok.some((item) => item.serp?.aiBriefing === "rendered"),
    latestViews: latestStats?.stats?.views ?? null,
    inboundQueries: latestStats?.stats?.searchQueries ?? [],
    // 추측한 검색어로 몇 번을 재도 그 글을 안다고 할 수 없다.
    confident: declaredOk.length >= MIN_CONFIDENT_OBSERVATIONS,
    guessedOnly: ok.length > 0 && declaredOk.length === 0,
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
  targetKeywords: Array<string | TargetKeyword>;
  at?: string;
  backfilled?: boolean;
}): OutcomeTracking | null {
  const canonical = parseNaverPostUrl(params.naverPostUrl);
  if (!canonical) return null;

  const queries = normalizeTargetKeywords(params.targetKeywords);
  if (queries.length === 0) return null;

  const at = params.at ?? new Date().toISOString();
  const declaredByUser = queries.some((keyword) => keyword.source === "user");

  return {
    canonicalPost: canonical,
    targetKeywords: queries,
    publishedTitle: params.title.trim(),
    contentHash: hashContent(params.content),
    trackedFrom: at,
    ...(declaredByUser ? { keywordsRevisedAt: at } : {}),
    ...(params.backfilled ? { backfilled: true } : {}),
  };
}

/**
 * 검색어 목록을 다듬는다. 빈 값·중복·부호 조각을 떨어뜨리고 개수를 묶는다.
 *
 * 순서를 지킨다 — 사장님이 먼저 적은 것이 그 글의 주 검색어다. 첫 번째만
 * primary이고 나머지는 secondary지만, 둘 다 똑같이 잰다. 역할은 나중에
 * 성적을 볼 때 무엇을 먼저 봐야 하는지의 표시일 뿐이다.
 */
export function normalizeTargetKeywords(
  keywords: Array<string | TargetKeyword>
): TargetKeyword[] {
  const seen = new Set<string>();
  const result: TargetKeyword[] = [];

  for (const raw of keywords) {
    const entry = typeof raw === "string" ? { query: raw, role: "primary" as const } : raw;
    const query = normalizeQuery(entry.query ?? "");
    if (!isUsableQuery(query)) continue;
    if (seen.has(query)) continue;
    seen.add(query);
    result.push({
      query,
      role: result.length === 0 ? "primary" : "secondary",
      ...(entry.source ? { source: entry.source } : {}),
    });
    if (result.length >= MAX_TARGET_KEYWORDS) break;
  }

  return result;
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
