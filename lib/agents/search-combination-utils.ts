export const MAIN_KEYWORD_MAX_LENGTH = 24;
export const MAIN_KEYWORD_MAX_TOKENS = 6;
export const EXACT_INSERTION_MAX_LENGTH = 20;
export const EXACT_INSERTION_MAX_TOKENS = 4;

const BRAND_PATTERN = /(만수르|매장|지점|스토어|샵|shop)/i;
const LOCAL_PATTERN = /(시|도|구|군|동|읍|면|역)$/u;
const LOCALITY_KEYWORDS = /(서울|인천|부천|부평|만수|구월|남동|계산)/u;
const CATEGORY_PATTERN = /(전자담배|액상|기기|추천|매장|사용처|입호흡|폐호흡|코일|팟|후기|리뷰|지원금)/u;
const QUESTION_LIKE_PATTERN =
  /[?？]|(있나요|되나요|될까요|할까요|해주세요|해 주세요|궁금해요|궁금합니다|문의|알려주세요|알려 주세요|가능한가요|가능할까요|써도 되나요|사용할 수 있나요|사용 가능할까요)$/u;
const POLICY_TOKEN_PATTERN = /(지원금|민생회복|고유가|피해|정책|재난지원금)/u;
const CATEGORY_CORE_PATTERN = /(전자담배|액상|기기|입호흡|폐호흡|코일|팟)/u;

export function normalizeSearchPhrase(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function splitSearchCombinationTokens(value: string): string[] {
  return normalizeSearchPhrase(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hasBrandToken(value: string): boolean {
  return BRAND_PATTERN.test(value);
}

function hasLocalToken(token: string): boolean {
  return LOCAL_PATTERN.test(token) || LOCALITY_KEYWORDS.test(token);
}

function hasCategoryToken(token: string): boolean {
  return CATEGORY_PATTERN.test(token);
}

function isBlockPhrase(tokens: string[], phrase: string): boolean {
  const hasLocal = tokens.some((token) => hasLocalToken(token));
  const hasBrand = hasBrandToken(phrase);
  const hasCategory = tokens.some((token) => hasCategoryToken(token));
  return hasLocal && hasBrand && hasCategory;
}

export function sanitizeMainKeywordCandidate(value: string): string | null {
  const normalized = normalizeSearchPhrase(value);
  if (!normalized) return null;
  const tokens = splitSearchCombinationTokens(normalized);
  if (!tokens.length) return null;
  if (normalized.length > MAIN_KEYWORD_MAX_LENGTH) return null;
  if (tokens.length > MAIN_KEYWORD_MAX_TOKENS) return null;
  if (hasBrandToken(normalized)) return null;
  if (QUESTION_LIKE_PATTERN.test(normalized)) return null;
  if (isBlockPhrase(tokens, normalized)) return null;
  return normalized;
}

function uniqTokens(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function buildPolicyIntent(tokens: string[], phrase: string): string | null {
  if (!phrase.includes("사용처")) return null;
  const localTokens = tokens.filter((token) => hasLocalToken(token));
  const policyTokens = tokens.filter((token) => POLICY_TOKEN_PATTERN.test(token));
  const parts = uniqTokens([...localTokens.slice(0, 1), ...policyTokens.slice(0, 3)]);
  if (parts.length === 0) return "사용처 확인";
  return `${parts.join(" ")} 사용처 확인`;
}

function buildCategoryIntent(tokens: string[], phrase: string): string | null {
  const categoryCore = tokens.find((token) => CATEGORY_CORE_PATTERN.test(token));
  if (!categoryCore) return null;

  if (hasBrandToken(phrase) && categoryCore === "전자담배") {
    return "전자담배 매장 결제 가능 여부 확인";
  }
  if (hasBrandToken(phrase)) {
    return `${categoryCore} 매장 방문 전 확인`;
  }
  if (phrase.includes("추천")) {
    return `${categoryCore} 추천 기준 확인`;
  }
  if (phrase.includes("사용법")) {
    return `${categoryCore} 사용법 확인`;
  }
  if (phrase.includes("후기") || phrase.includes("리뷰")) {
    return `${categoryCore} 후기 확인`;
  }
  return `${categoryCore} 선택 기준 확인`;
}

function buildDisplayIntent(tokens: string[], phrase: string): string {
  const policyIntent = buildPolicyIntent(tokens, phrase);
  const categoryIntent = buildCategoryIntent(tokens, phrase);
  const parts = uniqTokens([policyIntent ?? "", categoryIntent ?? ""]);
  if (parts.length > 1) return parts.join(" + ");
  if (parts.length === 1) return parts[0];

  const compact = uniqTokens(tokens.slice(0, 4));
  if (compact.length === 0) return "관련 검색의도 확인";
  return `${compact.join(" ")} 관련 내용 확인`;
}

export function classifySearchCombination(phrase: string): {
  displayIntent: string;
  exactInsertionAllowed: boolean;
  exactBlockReason?: string;
  tokens: string[];
} {
  const normalized = normalizeSearchPhrase(phrase);
  const tokens = splitSearchCombinationTokens(normalized);
  const blockByLength = normalized.length > EXACT_INSERTION_MAX_LENGTH;
  const blockByTokenCount = tokens.length >= EXACT_INSERTION_MAX_TOKENS;
  const blockByStructure = isBlockPhrase(tokens, normalized);

  if (blockByLength || blockByTokenCount || blockByStructure) {
    const reasons: string[] = [];
    if (blockByLength) reasons.push(`길이 ${EXACT_INSERTION_MAX_LENGTH}자 초과`);
    if (blockByTokenCount) reasons.push(`토큰 ${EXACT_INSERTION_MAX_TOKENS}개 이상`);
    if (blockByStructure) reasons.push("지역/카테고리/매장명 블록형 조합");
    return {
      displayIntent: buildDisplayIntent(tokens, normalized),
      exactInsertionAllowed: false,
      exactBlockReason: reasons.join(", "),
      tokens,
    };
  }

  return {
    displayIntent: buildDisplayIntent(tokens, normalized),
    exactInsertionAllowed: true,
    tokens,
  };
}
