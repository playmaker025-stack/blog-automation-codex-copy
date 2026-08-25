/**
 * naver-chrome — 네이버 블로그 본문에 딸려 들어온 UI 텍스트를 걷어낸다.
 *
 * 왜 필요한가: 발행 글을 수집할 때 페이지 전체의 태그를 벗겨 텍스트로 만들었다.
 * 그래서 코퍼스 샘플 앞에 헤더·검색창·공감 위젯·"블로그 아이디 만들기" 레이어가
 * 통째로 1,900자쯤 붙는다. 발췌는 앞에서 잘라내므로 발췌 전체가 UI 문구가 되고,
 * 그게 "이 문장 흐름을 그대로 복제하라"는 예문으로 프롬프트에 실렸다. 문체 지문도
 * 같은 발췌에서 뽑히므로 "주소 변경 불가", "후기 네이버" 같은 UI 문구가 사장님의
 * 고유 표현으로 학습됐다. 실측: 대표 발췌 25개 중 18개가 UI 문구로 시작.
 *
 * 순수 모듈이다. 네트워크도 파일도 건드리지 않는다.
 */

export interface ChromeStripResult {
  text: string;
  removedHead: number;
  removedTail: number;
  matchedHead: boolean;
  matchedTail: boolean;
}

/**
 * 본문 직전에 나타나는 표지. 네이버 PostView는 글 머리말이 항상
 * "… URL 복사 이웃추가 본문 기타 기능 공유하기 신고하기"로 끝나고 그 다음이 본문이다.
 * 여러 개가 잡히면 가장 뒤에서 끝나는 것을 쓴다 — 머리말을 최대한 걷어내야 한다.
 */
const HEAD_MARKERS = [
  "본문 기타 기능 공유하기 신고하기",
  "본문 기타 기능",
  "URL 복사 이웃추가",
];

/**
 * 본문이 끝나고 다시 UI가 시작되는 지점. 첫 번째로 나타나는 것을 쓴다.
 * 숫자가 들어가는 위젯(공감 0 칭찬 0)은 수치가 글마다 달라 정규식으로 잡는다.
 */
const TAIL_PATTERNS: RegExp[] = [
  /태그\s*취소/g,
  /공감한 블로거/g,
  /span\.u_likeit_button/g,
  /공감 \d+ 칭찬 \d+/g,
  /이 글에 공감한/g,
  /화면 최상단으로 이동/g,
  /인쇄 댓글쓰기/g,
  /이 블로그[^\n]{0,40}카테고리 글/g,
  /\[\{&#0?34;/g,
];

/** 본문 안에 섞여 남는 조각. 잘라내기로 못 잡는 것만 지운다. */
const RESIDUAL_PATTERNS: RegExp[] = [
  /span\.u_likeit_button\)[^]*?-->/g,
  /공감 \d+ 칭찬 \d+ 감사 \d+ 웃김 \d+ 놀람 \d+ 슬픔 \d+/g,
  // 본문 중간에 붙는 이전 글 링크 카드. 사장님이 쓴 문장이 아니라 네이버가 만든 미리보기다.
  /\S{1,24} : 네이버 블로그[\s\S]{0,300}?blog\.naver\.com/g,
];

/** 이 문구가 보이면 UI 텍스트가 섞인 것으로 본다. 측정과 회귀 검사에 쓴다. */
const CHROME_SIGNATURES = [
  /: 네이버 블로그/,
  /NAVER 블로그/,
  /이 블로그에서 검색/,
  /span\.u_likeit_button/,
  /블로그 주소 변경이 불가/,
  /본문 기타 기능/,
  /공감 \d+ 칭찬 \d+ 감사 \d+/,
];

/** 잘라낸 뒤 최소한 이만큼은 남아야 한다. 안 남으면 자르지 않는다. */
const MIN_BODY_LENGTH = 200;
/** 문서의 이 비율을 넘는 위치에서 발견된 머리 표지는 무시한다. 본문 안의 우연한 일치 방어. */
const MAX_HEAD_RATIO = 0.7;

/** 우리가 붙인 마크다운 제목은 UI가 아니므로 보존한다. */
const LEADING_HEADING = /^((?:#{1,6} [^\n]*\n+)+)/;

export function hasNaverChrome(text: string): boolean {
  return CHROME_SIGNATURES.some((pattern) => pattern.test(text));
}

/** 학습에 쓸 수 있는 본문인지. 잘라낸 뒤에도 UI 문구가 남으면 수집 자체가 실패한 것이다. */
const MIN_USABLE_LENGTH = 300;

/**
 * 수집이 실패해 본문 없이 UI만 담긴 샘플이 있다. 실측: 사장님 c의 한 글은
 * 3,408자 전부가 네이버 헤더·푸터였고 본문이 한 글자도 없었다. 이런 건
 * 걷어내는 게 아니라 학습에서 빼야 한다 — 남겨두면 UI 문구가 문체가 된다.
 */
export function isUsableCorpusText(text: string): boolean {
  const body = text.replace(LEADING_HEADING, "").trim();
  return body.length >= MIN_USABLE_LENGTH && !hasNaverChrome(body);
}

function findHeadEnd(body: string): number {
  const limit = body.length * MAX_HEAD_RATIO;
  let best = -1;
  for (const marker of HEAD_MARKERS) {
    const idx = body.indexOf(marker);
    if (idx === -1 || idx > limit) continue;
    const end = idx + marker.length;
    if (end > best) best = end;
  }
  return best;
}

function firstIndexAfter(body: string, pattern: RegExp, minIndex: number): number {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match.index >= minIndex) return match.index;
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  return -1;
}

function findTailStart(body: string, minIndex: number): number {
  let best = -1;
  for (const pattern of TAIL_PATTERNS) {
    const idx = firstIndexAfter(body, pattern, minIndex);
    if (idx === -1) continue;
    if (best === -1 || idx < best) best = idx;
  }
  return best;
}

/**
 * 네이버 UI를 걷어낸다.
 *
 * 표지를 못 찾으면 원문을 그대로 돌려준다 — 앱이 직접 쓴 글에는 UI가 없고,
 * 여기서 잘못 자르면 멀쩡한 본문을 잃는다. 더러운 채로 두는 편이 낫다.
 */
export function stripNaverChrome(raw: string): ChromeStripResult {
  const headingMatch = raw.match(LEADING_HEADING);
  const heading = headingMatch?.[1] ?? "";
  const body = raw.slice(heading.length);

  const headEnd = findHeadEnd(body);
  const start = headEnd > 0 && body.length - headEnd >= MIN_BODY_LENGTH ? headEnd : 0;

  const tailStart = findTailStart(body, start + MIN_BODY_LENGTH);
  const end = tailStart > start ? tailStart : body.length;

  let kept = body.slice(start, end);
  for (const pattern of RESIDUAL_PATTERNS) kept = kept.replace(pattern, " ");
  kept = kept.replace(/[ \t]{2,}/g, " ").trim();

  // 잘라낸 결과가 쓸모없이 짧으면 자르기를 포기한다.
  if (kept.length < MIN_BODY_LENGTH) {
    return {
      text: raw,
      removedHead: 0,
      removedTail: 0,
      matchedHead: false,
      matchedTail: false,
    };
  }

  return {
    text: heading ? `${heading}${kept}` : kept,
    removedHead: start,
    removedTail: body.length - end,
    matchedHead: start > 0,
    matchedTail: tailStart > start,
  };
}
