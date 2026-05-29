import type {
  ArticleStage,
  ArticleType,
  KeywordRoleAssignment,
  KeywordSemanticRole,
  TopicIntentKind,
  TopicIntentResolution,
} from "./types.ts";

interface ResolveTopicIntentParams {
  title: string;
  description?: string | null;
  mainKeyword?: string | null;
  subKeywords?: string[] | null;
  seriesRole?: "prelude" | "main";
}

const PRODUCT_LIST_SIGNAL = /(베스트|best|BEST|top\s?\d+|TOP\s?\d+|추천 제품|제품 추천|기기 추천|순위|랭킹|best\s?\d+|\d+\s*가지|\d+\s*개)/iu;
const COMPARISON_SIGNAL = /(비교|vs|VS|차이|어느 게|어떤 게|뭐가 더|둘 중|비교해보면)/u;
const REVIEW_SIGNAL = /(후기|리뷰|사용기|실사용|솔직후기|써본|내돈내산|경험담)/u;
const PROBLEM_SIGNAL = /(해결|고장|누수|안됨|인식 안됨|원인|이유|왜|문제|에러|불량|교체|탄맛|액튐|결로|먹통|빨리 타는)/u;
const PRELUDE_SIGNAL = /(고르는법|고르는 법|선택 기준|체크포인트|체크리스트|방문 전|처음 살 때|입문자 질문|질문 모음|먼저 알아야)/u;
const RECOMMEND_SIGNAL = /(추천|권장|입문자용|처음 고를 때)/u;
const GENERAL_INFO_SIGNAL = /(뜻|의미|구조|원리|가이드|사용법|정리|설명)/u;

const GENERIC_SUPPORT_SIGNAL = /(추천|기준|비교|후기|문제|해결|사용법|정리|가이드|입문자|초보자|처음|고르는법|고르는 법)/u;
const PRODUCT_STYLE_SIGNAL = /([A-Za-z][A-Za-z0-9+._-]{1,}|[0-9]{2,}|프로|pro|PRO|맥스|max|MAX|울트라|ultra|ULTRA|미니|mini|MINI|플러스|plus|PLUS|에디션|edition|EDITION|시리즈|series|SERIES)/u;

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isProductLikeKeyword(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (GENERIC_SUPPORT_SIGNAL.test(normalized)) return false;
  if (PRODUCT_STYLE_SIGNAL.test(normalized)) return true;
  const tokens = normalized.split(/\s+/);
  return tokens.length <= 3 && tokens.every((token) => token.length >= 2) && !/[?!.]/u.test(normalized);
}

function classifySubKeywordRole(keyword: string): KeywordSemanticRole {
  if (COMPARISON_SIGNAL.test(keyword)) return "comparison_target";
  if (/(브랜드|정품|공식|스토어|매장|샵|shop|store)/iu.test(keyword)) return "brand_candidate";
  if (isProductLikeKeyword(keyword)) return "product_candidate";
  return "general_support";
}

function toArticleType(intentType: TopicIntentKind, seriesRole?: "prelude" | "main"): ArticleType {
  if (seriesRole === "prelude" || intentType === "prelude") return "warmup";
  switch (intentType) {
    case "product_list_recommendation":
      return "product_list_recommendation";
    case "criteria_recommendation":
      return "main_recommendation";
    case "comparison":
      return "comparison";
    case "review":
      return "review";
    case "problem_solution":
      return "problem_solution";
    case "general_info":
    default:
      return "general_info";
  }
}

function toArticleStage(intentType: TopicIntentKind): ArticleStage {
  switch (intentType) {
    case "prelude":
      return "pre_suasion";
    case "comparison":
      return "comparison_judgment";
    case "criteria_recommendation":
    case "product_list_recommendation":
      return "purchase_review";
    case "problem_solution":
      return "problem_solution";
    case "review":
    case "general_info":
    default:
      return "info_summary";
  }
}

function buildSearchIntent(intentType: TopicIntentKind, mainKeyword: string, _productCandidates: string[]): string {
  switch (intentType) {
    case "product_list_recommendation":
      return `${mainKeyword || "이 주제"}에 대해 후보 제품을 나란히 비교하며 추천 이유와 맞는 사용자를 빠르게 판단하려는 구매 검토형 의도`;
    case "criteria_recommendation":
      return `${mainKeyword || "이 주제"}를 바로 사기 전에 선택 기준과 사용자 조건을 먼저 정리하려는 추천 기준형 의도`;
    case "comparison":
      return `${mainKeyword || "이 주제"}의 차이와 상황별 선택 기준을 비교하려는 비교 판단형 의도`;
    case "review":
      return `${mainKeyword || "이 주제"}의 실제 사용감과 장단점을 확인하려는 후기형 의도`;
    case "problem_solution":
      return `${mainKeyword || "이 주제"}에서 생긴 문제의 원인과 해결 순서를 찾으려는 문제 해결형 의도`;
    case "prelude":
      return `${mainKeyword || "이 주제"} 본편으로 들어가기 전에 기준과 질문을 먼저 정리하려는 브릿지 의도`;
    case "general_info":
    default:
      return `${mainKeyword || "이 주제"}의 기본 개념과 구조를 이해하려는 일반 정보형 의도`;
  }
}

export function resolveTopicIntent(params: ResolveTopicIntentParams): TopicIntentResolution {
  const title = (params.title ?? "").normalize("NFKC").trim();
  const description = (params.description ?? "").normalize("NFKC").trim();
  const mainKeyword = (params.mainKeyword ?? "").normalize("NFKC").trim();
  const subKeywords = uniq(params.subKeywords ?? []);
  const sourceText = [title, description, mainKeyword, ...subKeywords].filter(Boolean).join(" ");

  const keywordAssignments: KeywordRoleAssignment[] = subKeywords.map((keyword) => ({
    keyword,
    role: classifySubKeywordRole(keyword),
  }));
  const productCandidates = keywordAssignments
    .filter((item) => item.role === "product_candidate" || item.role === "brand_candidate")
    .map((item) => item.keyword);
  const comparisonTargets = keywordAssignments
    .filter((item) => item.role === "comparison_target")
    .map((item) => item.keyword);

  const hasProductListSignal =
    PRODUCT_LIST_SIGNAL.test(sourceText) || productCandidates.length >= 3;

  let intentType: TopicIntentKind;
  let reason: string;

  if (params.seriesRole === "prelude") {
    intentType = "prelude";
    reason = "seriesRole이 prelude로 지정되어 브릿지 글로 판정했습니다.";
  } else if (hasProductListSignal) {
    intentType = "product_list_recommendation";
    reason = productCandidates.length >= 3
      ? "서브 키워드에 제품/브랜드 후보가 3개 이상 있어 추천 리스트형으로 판정했습니다."
      : "제목/주제에 TOP, 베스트, 순위, 제품 추천 같은 리스트 신호가 있어 추천 리스트형으로 판정했습니다.";
  } else if (COMPARISON_SIGNAL.test(sourceText)) {
    intentType = "comparison";
    reason = "제목/주제에 비교, 차이, vs 같은 비교 신호가 있어 비교글로 판정했습니다.";
  } else if (REVIEW_SIGNAL.test(sourceText)) {
    intentType = "review";
    reason = "제목/주제에 후기, 리뷰, 실사용 같은 후기 신호가 있어 후기글로 판정했습니다.";
  } else if (PROBLEM_SIGNAL.test(sourceText)) {
    intentType = "problem_solution";
    reason = "제목/주제에 문제, 원인, 해결, 교체 같은 문제 해결 신호가 있어 문제 해결글로 판정했습니다.";
  } else if (RECOMMEND_SIGNAL.test(sourceText) && PRELUDE_SIGNAL.test(sourceText)) {
    intentType = "criteria_recommendation";
    reason = "추천 맥락이지만 제품 나열보다 선택 기준 설명이 중심이라 기준 설명형 추천글로 판정했습니다.";
  } else if (PRELUDE_SIGNAL.test(sourceText)) {
    intentType = "prelude";
    reason = "기준, 체크포인트, 방문 전 질문 같은 예열 신호가 있어 prelude 글로 판정했습니다.";
  } else if (RECOMMEND_SIGNAL.test(sourceText)) {
    intentType = "criteria_recommendation";
    reason = "추천 맥락이 있으나 리스트형 신호가 약해 기준 설명형 추천글로 판정했습니다.";
  } else if (GENERAL_INFO_SIGNAL.test(sourceText)) {
    intentType = "general_info";
    reason = "설명, 구조, 가이드 같은 정보형 신호가 있어 일반 정보글로 판정했습니다.";
  } else {
    intentType = "general_info";
    reason = "강한 구매/비교/후기/문제 해결 신호가 없어 일반 정보글로 판정했습니다.";
  }

  return {
    intentType,
    articleType: toArticleType(intentType, params.seriesRole),
    articleStage: toArticleStage(intentType),
    searchIntent: buildSearchIntent(intentType, mainKeyword || title, productCandidates),
    reason,
    isProductListRecommendation: intentType === "product_list_recommendation",
    productCandidates,
    comparisonTargets,
    keywordAssignments,
  };
}
