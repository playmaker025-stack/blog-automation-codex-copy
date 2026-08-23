/**
 * seo-analyst-agent — 네이버 SERP 모듈 분류
 *
 * 구현 근거: references/agent-seo-analyst.md
 *
 * 이 에이전트는 키워드를 5개 SERP 모듈 중 하나로 분류하고, 그 결과를
 * writer-engine에 넘겨 글 구조를 고르게 한다. writer는 스스로 모듈을 추론하지 않는다.
 *
 * 판정 원칙:
 * - observedSerpModule(실측)이 있으면 언제나 우선한다.
 * - 실측이 없으면 언어 패턴으로 predictedSerpModule을 만든다.
 * - 직접 확인 없이 언어 패턴만으로 ai_briefing을 확정하지 않는다 → confidence를 low로 낮춘다.
 * - 블로그탭 유무는 마지막 보조 신호이며 주 신호로 쓰지 않는다.
 *
 * 업종 전용 규칙을 넣지 않는다. 전자담배 예시는 참고 사례일 뿐이며
 * 여기서는 다른 업종에도 적용되는 범용 언어 패턴만 사용한다.
 */

import type {
  AiBriefingCitationType,
  BlogRoleCode,
  PlaceSubtype,
  SerpAnalysis,
  SerpModule,
  SerpModuleConfidence,
} from "./types";

export const SERP_MODULE_OPTIONS: SerpModule[] = [
  "ai_briefing",
  "clip",
  "place",
  "shopping",
  "blog_view",
];

// ============================================================
// 언어 패턴 신호 (범용)
// ============================================================

/** 정보/비교/판단형 — AI 브리핑이 첫 블록을 차지하기 쉬운 질의 */
const AI_BRIEFING_SIGNALS = [
  "차이",
  "비교",
  "vs",
  "어떤",
  "어느",
  "뭐가",
  "나을까",
  "이유",
  "정리",
  "란",
  "이란",
  "원리",
  "성분",
  "구조",
  "종류",
  "추천",
  "입문",
  "처음",
  "베스트",
  "top",
];

/** 체감/시연형 — 클립/숏폼이 우선 노출되기 쉬운 질의 */
const CLIP_SIGNALS = [
  "후기",
  "리뷰",
  "실사용",
  "언박싱",
  "체감",
  "영상",
  "브이로그",
  "시연",
  "내돈내산",
];

/** 구매 전환형 — 쇼핑/스토어가 우선 노출되기 쉬운 질의 */
const SHOPPING_SIGNALS = [
  "가격",
  "구매",
  "최저가",
  "살 곳",
  "파는 곳",
  "얼마",
  "할인",
  "배송",
  "주문",
  "정품",
  "특가",
];

/** 문제 해결형 — 블로그/뷰 롱폼이 유효한 질의 */
const PROBLEM_SIGNALS = [
  "고장",
  "증상",
  "원인",
  "해결",
  "안됨",
  "안돼",
  "안 되",
  "오류",
  "문제",
  "누수",
  "먹통",
  "불량",
  "수리",
];

/** 사용법/팁형 — 블로그/뷰 롱폼이 유효한 질의 */
const HOWTO_SIGNALS = [
  "방법",
  "하는 법",
  "하는법",
  "사용법",
  "설정",
  "교체",
  "관리",
  "시기",
  "팁",
  "준비물",
  "순서",
  "가이드",
];

/** 매장 방문 맥락 신호 */
const STORE_SIGNALS = [
  "매장",
  "가게",
  "샵",
  "전문점",
  "상담",
  "방문",
  "근처",
  "주변",
  "위치",
  "주차",
  "영업시간",
  "예약",
  "오시는",
];

/** 행정구역/역세권 접미사 — 지역명 토큰 판별용 */
const LOCALITY_SUFFIX = /^[가-힣]{1,5}(동|읍|면|리|구|시|군|역)$/u;

// ============================================================
// 유틸
// ============================================================

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function countSignals(text: string, signals: string[]): number {
  return signals.reduce((score, signal) => score + (text.includes(normalize(signal)) ? 1 : 0), 0);
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

/**
 * 지역명 토큰을 찾는다. "부평역", "만수동", "인천시" 같은 행정구역/역 접미사 기반.
 * 단독 접미사("동", "구")나 흔한 오탐("활동", "이동")을 피하려고 최소 길이를 둔다.
 */
function findLocalityTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token.length >= 3 && LOCALITY_SUFFIX.test(token));
}

// ============================================================
// 모듈 예측
// ============================================================

interface ModuleScore {
  module: SerpModule;
  score: number;
}

function scoreModules(params: {
  text: string;
  localityTokens: string[];
}): ModuleScore[] {
  const { text, localityTokens } = params;
  const hasLocality = localityTokens.length > 0;
  const storeScore = countSignals(text, STORE_SIGNALS);

  const problemScore = countSignals(text, PROBLEM_SIGNALS);
  const howtoScore = countSignals(text, HOWTO_SIGNALS);

  return [
    { module: "place", score: (hasLocality ? 3 : 0) + storeScore * 2 },
    { module: "shopping", score: countSignals(text, SHOPPING_SIGNALS) * 2 },
    // 지역 맥락이 있는 후기는 클립이 아니라 플레이스 리뷰로 흡수된다.
    { module: "clip", score: countSignals(text, CLIP_SIGNALS) * 2 - (hasLocality ? 2 : 0) },
    { module: "blog_view", score: problemScore * 2 + howtoScore * 2 },
    { module: "ai_briefing", score: countSignals(text, AI_BRIEFING_SIGNALS) * 2 },
  ];
}

/** 동점이면 블로그가 실제로 개입할 여지가 큰 쪽을 남긴다. */
const TIE_BREAK_ORDER: SerpModule[] = ["place", "blog_view", "ai_briefing", "shopping", "clip"];

function pickPredictedModule(scores: ModuleScore[]): { module: SerpModule; score: number; runnerUpScore: number } {
  const sorted = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return TIE_BREAK_ORDER.indexOf(a.module) - TIE_BREAK_ORDER.indexOf(b.module);
  });

  const top = sorted[0];
  const runnerUp = sorted[1];
  // 아무 신호도 없으면 블로그 롱폼을 기본값으로 둔다.
  if (top.score <= 0) return { module: "blog_view", score: 0, runnerUpScore: 0 };
  return { module: top.module, score: top.score, runnerUpScore: runnerUp?.score ?? 0 };
}

// ============================================================
// 하위 타입 판정
// ============================================================

function resolvePlaceSubtype(params: { text: string; localityTokens: string[] }): PlaceSubtype {
  const { text, localityTokens } = params;

  if (countSignals(text, ["후기", "리뷰", "방문기"]) > 0) return "place_review";
  if (countSignals(text, ["상담", "방문 전", "예약", "준비물", "문의"]) > 0) return "place_visit_check";

  if (localityTokens.some((token) => token.endsWith("역"))) return "place_station";
  if (localityTokens.some((token) => /(동|읍|면|리)$/u.test(token))) return "place_dong";
  return "place_city";
}

const GEO_PRIORITY_SIGNALS = [
  "란",
  "이란",
  "원리",
  "성분",
  "구조",
  "이유",
  "방법",
  "하는 법",
  "하는법",
  "팁",
  "시기",
  ...PROBLEM_SIGNALS,
];

const SEO_REQUIRED_SIGNALS = [
  "차이",
  "비교",
  "vs",
  "나을까",
  "어떤 게",
  "어느 게",
  "추천",
  "입문",
  "처음",
  "골라",
  "베스트",
  "top",
];

function resolveCitationType(text: string): { type: AiBriefingCitationType; note: string } {
  const seoScore = countSignals(text, SEO_REQUIRED_SIGNALS);
  const geoScore = countSignals(text, GEO_PRIORITY_SIGNALS);

  if (seoScore > geoScore) {
    return {
      type: "seo_required",
      note: "비교/추천/구매검토형이라 기존 상위노출 구조와 AI 브리핑 인용 구조를 함께 적용합니다.",
    };
  }
  return {
    type: "geo_priority",
    note: "정보형/방법형/문제해결형이라 즉답형 오프닝, FAQ, 파싱 가능한 단락 구조를 우선합니다.",
  };
}

// ============================================================
// 검색 의도 / 블로그 역할
// ============================================================

function resolvePrimarySearchIntent(params: {
  module: SerpModule;
  text: string;
  placeSubtype: PlaceSubtype | null;
}): string {
  const { module, text, placeSubtype } = params;

  if (module === "place") {
    return placeSubtype === "place_review" ? "방문 경험형" : "방문형";
  }
  if (module === "shopping") return "구매검토형";
  if (module === "clip") return "체감/후기형";
  if (module === "ai_briefing") {
    return countSignals(text, SEO_REQUIRED_SIGNALS) > 0 ? "비교형" : "정보형";
  }
  return countSignals(text, PROBLEM_SIGNALS) > 0 ? "문제해결형" : "사용법형";
}

function resolveBlogRole(params: {
  module: SerpModule;
  citationType: AiBriefingCitationType | null;
  hasLocality: boolean;
  text: string;
}): BlogRoleCode {
  const { module, citationType, hasLocality, text } = params;

  if (module === "place") return "A";
  if (module === "clip") return "E";
  if (module === "shopping") return hasLocality ? "A" : "B";
  if (module === "ai_briefing") return citationType === "seo_required" ? "B" : "C";
  return countSignals(text, PROBLEM_SIGNALS) > 0 ? "D" : "C";
}

// ============================================================
// 신뢰도
// ============================================================

function resolveConfidence(params: {
  observed: SerpModule | null;
  predicted: SerpModule;
  topScore: number;
  runnerUpScore: number;
}): SerpModuleConfidence {
  const { observed, predicted, topScore, runnerUpScore } = params;

  if (observed) return "high";
  // 직접 확인 없이 언어 패턴만으로 ai_briefing을 확정하지 않는다.
  if (predicted === "ai_briefing") return "low";
  if (topScore >= 4 && topScore >= runnerUpScore + 2) return "medium";
  return "low";
}

function buildReason(params: {
  observed: SerpModule | null;
  predicted: SerpModule;
  confidence: SerpModuleConfidence;
  localityTokens: string[];
}): string {
  const { observed, predicted, confidence, localityTokens } = params;

  if (observed) {
    return `모바일 통합검색 첫 블록에서 ${observed}를 실제로 확인했습니다.`;
  }

  const localityNote = localityTokens.length
    ? ` 지역명 토큰(${localityTokens.slice(0, 3).join(", ")})이 감지됐습니다.`
    : "";

  if (predicted === "ai_briefing") {
    return `키워드 언어 패턴은 AI 브리핑형에 가깝지만 첫 화면을 직접 확인하지 않아 확정하지 않았습니다. 신뢰도 ${confidence}.${localityNote}`;
  }

  return `첫 화면 실측 없이 키워드 언어 패턴으로 ${predicted}를 예측했습니다. 신뢰도 ${confidence}.${localityNote}`;
}

// ============================================================
// 진입점
// ============================================================

export function analyzeSerpModule(params: {
  title: string;
  keywords?: string[];
  mainKeyword?: string;
  /** 실제 모바일 SERP를 확인했다면 그 값을 넘긴다. 없으면 언어 패턴 예측만 사용한다. */
  observedSerpModule?: SerpModule | null;
  now?: Date;
}): SerpAnalysis {
  const { title, keywords = [], mainKeyword, observedSerpModule = null } = params;

  const rawText = [title, mainKeyword ?? "", ...keywords].filter(Boolean).join(" ");
  const text = normalize(rawText);
  const localityTokens = findLocalityTokens(tokenize(rawText));

  const scores = scoreModules({ text, localityTokens });
  const { module: predicted, score: topScore, runnerUpScore } = pickPredictedModule(scores);
  const serpModule = observedSerpModule ?? predicted;

  const confidence = resolveConfidence({
    observed: observedSerpModule,
    predicted,
    topScore,
    runnerUpScore,
  });

  const placeSubtype = serpModule === "place" ? resolvePlaceSubtype({ text, localityTokens }) : null;
  // 인용 레이어가 전 모듈 공통이 됐으므로 인용 타입도 항상 계산한다.
  // 예전에는 ai_briefing일 때만 계산해서 나머지 모듈은 인용 전략이 아예 없었다.
  const citation = resolveCitationType(text);

  return {
    serpModule,
    observedSerpModule,
    predictedSerpModule: predicted,
    serpModuleConfidence: confidence,
    serpModuleReason: buildReason({
      observed: observedSerpModule,
      predicted,
      confidence,
      localityTokens,
    }),
    serpModuleOptions: SERP_MODULE_OPTIONS,
    primarySearchIntent: resolvePrimarySearchIntent({ module: serpModule, text, placeSubtype }),
    recommendedBlogRole: resolveBlogRole({
      module: serpModule,
      citationType: citation.type,
      hasLocality: localityTokens.length > 0,
      text,
    }),
    aiBriefingCitationType: citation.type,
    aiBriefingCitationNote: citation.note,
    placeSubtype,
    blogTabIsPrimarySignal: false,
    checkedAt: (params.now ?? new Date()).toISOString(),
    checkDevice: observedSerpModule ? "mobile" : "unknown",
  };
}

export class SeoAnalystAgent {
  analyze(params: Parameters<typeof analyzeSerpModule>[0]): SerpAnalysis {
    return analyzeSerpModule(params);
  }
}

export const seoAnalystAgent = new SeoAnalystAgent();
