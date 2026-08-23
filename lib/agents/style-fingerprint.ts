/**
 * style-fingerprint — 사용자 코퍼스에서 실제 문체 지문을 추출한다.
 *
 * 배경:
 * 예전에는 문체를 "friendly / 인사로 시작 / 서술형" 같은 형용사 3개로 요약해서 writer에게 넘겼다.
 * 이건 한국 블로그 대부분에 해당하는 설명이라 복제 신호로는 정보량이 0이다.
 * 시그니처 표현도 하드코딩된 정규식(`안녕하세요|오늘은 제가|솔직하게 말씀드리면`)으로만 매칭했는데,
 * 그건 사용자 고유 표현이 아니라 AI 블로그 클리셰 목록이었다.
 *
 * 여기서는 형용사 대신 **실제 문장 증거**를 뽑는다.
 * - 어떤 종결어미를 실제로 몇 번 쓰는지
 * - 여러 글에 반복해서 나오는 고유 표현이 무엇인지
 * - 실제 도입/마무리 문장이 어떻게 생겼는지
 *
 * 전부 순수 함수다. LLM 호출도 네트워크 호출도 없다.
 * 입력은 코퍼스 발췌 텍스트 배열이며, 발췌만으로 계산되므로 전체 코퍼스를 다시 읽지 않는다.
 */

export interface SentenceEndingUsage {
  ending: string;
  count: number;
}

export interface StyleFingerprint {
  /** 실제로 자주 쓰는 종결어미와 사용 횟수 */
  sentenceEndings: SentenceEndingUsage[];
  /** 여러 글에 반복 등장하는 고유 표현 (문서 빈도 2 이상) */
  signaturePhrases: string[];
  /** 실제 도입 문장 원문 */
  openingLines: string[];
  /** 실제 마무리 문장 원문 */
  closingLines: string[];
  /** 지문 계산에 사용된 표본 수 */
  sampleCount: number;
}

// ============================================================
// 종결어미 — 한국어 일반 패턴이며 업종과 무관하다
// ============================================================

const SENTENCE_ENDINGS = [
  "습니다",
  "입니다",
  "합니다",
  "됩니다",
  "드립니다",
  "겠습니다",
  "어요",
  "아요",
  "예요",
  "에요",
  "해요",
  "돼요",
  "드려요",
  "같아요",
  "네요",
  "구요",
  "이죠",
  "거죠",
  "거든요",
  "더라고요",
  "답니다",
  "랍니다",
  "니까요",
  "는데요",
  "잖아요",
];

/** 표현 후보에서 제외할 범용 조각 — 누구나 쓰는 말은 지문이 아니다 */
const GENERIC_PHRASE_TOKENS = new Set([
  "그리고",
  "그런데",
  "하지만",
  "그래서",
  "그러면",
  "때문에",
  "위해서",
  "경우에",
  "정도로",
  "이렇게",
  "그렇게",
  "저렇게",
]);

/**
 * 네이버 블로그 본문을 수집할 때 딸려 들어온 UI 잔재.
 * 실측 결과 사용자 c/d 코퍼스에 `span.u likeit button 공감 face`, `네이버 블로그 NAVER 블로그`
 * 같은 조각이 반복 등장해 문체 지문 상위를 전부 차지했다. 문체가 아니라 크롤링 노이즈다.
 */
const UI_NOISE_TOKENS = new Set([
  "공감",
  "공유하기",
  "이웃추가",
  "댓글",
  "댓글쓰기",
  "카테고리",
  "전체보기",
  "맨위로",
  "블로그",
  "블로그에서",
  "슬픔",
  "놀라움",
  "화나요",
  "검색",
  "댓글을",
  "남겨보세요",
  "전체",
  "통계",
]);

/**
 * 한글이지만 본문이 아닌 네이버 UI 문구.
 * 토큰 단위로는 걸러지지 않아 구문 패턴으로 잡는다.
 */
const UI_NOISE_PHRASES = [
  /블로그에서\s*검색/u,
  /댓글을\s*남겨보세요/u,
  /\d+개\s*전체/u,
  /이웃\s*추가/u,
  /공유하기\s*통계/u,
  /본문\s*기타\s*기능/u,
];

function isNoisePhrase(phrase: string): boolean {
  return UI_NOISE_PHRASES.some((pattern) => pattern.test(phrase));
}

/** 순수 ASCII 토큰(마크업/클래스명/영문 UI)과 숫자만으로 된 토큰은 문체 신호가 아니다. */
function isNoiseToken(word: string): boolean {
  if (UI_NOISE_TOKENS.has(word)) return true;
  if (/^[\p{ASCII}]+$/u.test(word)) return true;
  if (/^\d+$/u.test(word)) return true;
  return false;
}

/** 코퍼스 발췌 앞에 붙는 수집 메타(작성일, `제목=`, `레퍼런스 N`)를 제거한다. */
export function stripCorpusMeta(text: string): string {
  return text
    .replace(/^\s*\d{4}[.\s]+\d{1,2}[.\s]+\d{1,2}[.\s]*(?:\d{1,2}:\d{2})?\s*작성\s*/u, "")
    .replace(/^\s*레퍼런스\s*\d+\s*/u, "")
    .replace(/제목\s*=\s*/gu, "")
    .trim();
}

const MIN_DOCUMENT_FREQUENCY = 2;
const MAX_SIGNATURE_PHRASES = 8;
const MAX_ENDINGS = 6;
const MAX_BOUNDARY_LINES = 3;

// ============================================================
// 유틸
// ============================================================

function normalize(text: string): string {
  return stripCorpusMeta(
    text.normalize("NFKC").replace(/​/g, " ").replace(/\s+/g, " ")
  ).trim();
}

function toWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word.length > 0);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

// ============================================================
// 종결어미
// ============================================================

/**
 * 문장 분리 대신 종결어미를 직접 센다.
 * 네이버 블로그 글은 마침표 없이 줄바꿈으로 문장을 끊는 경우가 많아
 * 문장 분리 기반으로는 신뢰할 수 있는 통계가 안 나온다.
 */
export function extractSentenceEndings(texts: string[]): SentenceEndingUsage[] {
  const joined = texts.map(normalize).join(" ");
  if (!joined) return [];

  const counts = SENTENCE_ENDINGS.map((ending) => ({
    ending,
    count: countOccurrences(joined, ending),
  })).filter((item) => item.count > 0);

  // "합니다"는 "습니다"의 부분 문자열이 아니지만, "입니다"/"습니다"처럼
  // 더 구체적인 어미가 잡히면 포괄 어미의 중복 계상을 줄인다.
  const specific = counts.filter((item) => item.ending !== "어요" && item.ending !== "아요");
  const generic = counts.filter((item) => item.ending === "어요" || item.ending === "아요");
  const specificTotal = specific.reduce((sum, item) => sum + item.count, 0);
  const adjustedGeneric = generic
    .map((item) => ({ ...item, count: Math.max(0, item.count - Math.floor(specificTotal / 4)) }))
    .filter((item) => item.count > 0);

  return [...specific, ...adjustedGeneric]
    .sort((left, right) => right.count - left.count)
    .slice(0, MAX_ENDINGS);
}

// ============================================================
// 고유 표현
// ============================================================

function collectNgrams(words: string[], size: number): Set<string> {
  const grams = new Set<string>();
  for (let index = 0; index + size <= words.length; index += 1) {
    const slice = words.slice(index, index + size);
    if (slice.some((word) => GENERIC_PHRASE_TOKENS.has(word) || isNoiseToken(word))) continue;
    const gram = slice.join(" ");
    if (gram.length < 4) continue;
    if (isNoisePhrase(gram)) continue;
    grams.add(gram);
  }
  return grams;
}

/**
 * 여러 글에 걸쳐 반복되는 표현만 남긴다.
 * 한 글에서 여러 번 나오는 건 그 글의 주제어일 뿐 문체 지문이 아니다.
 */
export function extractSignaturePhrases(texts: string[]): string[] {
  const cleaned = texts.map(normalize).filter(Boolean);
  if (cleaned.length < MIN_DOCUMENT_FREQUENCY) return [];

  const documentFrequency = new Map<string, number>();
  for (const text of cleaned) {
    const words = toWords(text);
    const seen = new Set<string>();
    for (const size of [4, 3, 2]) {
      for (const gram of collectNgrams(words, size)) seen.add(gram);
    }
    for (const gram of seen) {
      documentFrequency.set(gram, (documentFrequency.get(gram) ?? 0) + 1);
    }
  }

  const candidates = [...documentFrequency.entries()]
    .filter(([, frequency]) => frequency >= MIN_DOCUMENT_FREQUENCY)
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      // 같은 빈도면 더 긴 표현이 더 구체적인 지문이다.
      return right[0].length - left[0].length;
    })
    .map(([gram]) => gram);

  // 더 긴 표현이 이미 채택됐으면 그 안에 포함된 짧은 조각은 버린다.
  const kept: string[] = [];
  for (const candidate of candidates) {
    if (kept.some((existing) => existing.includes(candidate))) continue;
    kept.push(candidate);
    if (kept.length >= MAX_SIGNATURE_PHRASES) break;
  }
  return kept;
}

// ============================================================
// 도입 / 마무리
// ============================================================

function firstMeaningfulSegment(text: string): string {
  const normalized = normalize(text);
  if (!normalized) return "";
  return normalized.slice(0, 80).trim();
}

function lastMeaningfulSegment(text: string): string {
  const normalized = normalize(text);
  if (!normalized) return "";
  return normalized.slice(-80).trim();
}

export function extractOpeningLines(texts: string[]): string[] {
  return texts
    .map(firstMeaningfulSegment)
    .filter((line) => line.length >= 8)
    .slice(0, MAX_BOUNDARY_LINES);
}

export function extractClosingLines(texts: string[]): string[] {
  return texts
    .map(lastMeaningfulSegment)
    .filter((line) => line.length >= 8)
    .slice(0, MAX_BOUNDARY_LINES);
}

// ============================================================
// 진입점
// ============================================================

export function buildStyleFingerprint(texts: string[]): StyleFingerprint {
  const cleaned = texts.map(normalize).filter((text) => text.length > 0);

  return {
    sentenceEndings: extractSentenceEndings(cleaned),
    signaturePhrases: extractSignaturePhrases(cleaned),
    openingLines: extractOpeningLines(cleaned),
    closingLines: extractClosingLines(cleaned),
    sampleCount: cleaned.length,
  };
}

export function isUsableFingerprint(fingerprint: StyleFingerprint | null | undefined): boolean {
  if (!fingerprint) return false;
  return (
    fingerprint.sentenceEndings.length > 0 ||
    fingerprint.signaturePhrases.length > 0 ||
    fingerprint.openingLines.length > 0
  );
}

/**
 * writer 프롬프트에 넣을 문체 증거 블록.
 * 형용사로 설명하지 않고 실제 표현을 그대로 보여준다.
 */
export function formatStyleFingerprint(fingerprint: StyleFingerprint | null | undefined): string {
  if (!isUsableFingerprint(fingerprint) || !fingerprint) {
    return [
      "문체 지문: 추출된 표본이 부족합니다.",
      "발췌 글의 문장 흐름을 그대로 따라 쓰고, 일반적인 블로그 말투로 흐르지 않게 주의하세요.",
    ].join("\n");
  }

  const lines: string[] = ["## 문체 지문 (실제 사용자 글에서 추출한 증거)"];

  if (fingerprint.sentenceEndings.length > 0) {
    lines.push(
      "",
      "실제로 쓰는 종결어미 (괄호는 표본 내 사용 횟수):",
      fingerprint.sentenceEndings
        .map((item) => `${item.ending}(${item.count}회)`)
        .join(", "),
      "- 이 어미 분포를 그대로 재현하세요. 표본에 없는 어미로 글 전체를 통일하지 마세요."
    );
  }

  if (fingerprint.signaturePhrases.length > 0) {
    lines.push(
      "",
      "여러 글에 반복해서 나오는 이 사람 고유 표현:",
      ...fingerprint.signaturePhrases.map((phrase) => `- ${phrase}`),
      "- 억지로 전부 넣지 말고, 자연스러운 자리에 실제로 쓰이던 방식대로 쓰세요."
    );
  }

  if (fingerprint.openingLines.length > 0) {
    lines.push(
      "",
      "실제 도입부가 시작되는 방식:",
      ...fingerprint.openingLines.map((line) => `- "${line}"`)
    );
  }

  if (fingerprint.closingLines.length > 0) {
    lines.push(
      "",
      "실제 마무리가 끝나는 방식:",
      ...fingerprint.closingLines.map((line) => `- "${line}"`)
    );
  }

  lines.push(
    "",
    `- 위 증거는 표본 ${fingerprint.sampleCount}개에서 뽑았습니다. 문체를 설명으로 이해하지 말고 이 문장들의 리듬을 그대로 따라 쓰세요.`
  );

  return lines.join("\n");
}
