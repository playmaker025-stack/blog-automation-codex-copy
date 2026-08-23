/**
 * domain-contract — 이 블로그가 다룰 수 있는 주제 범위를 명시적으로 선언한다.
 *
 * 왜 선언형인가:
 * 예전에는 업종 판정 기준을 "사용자가 이미 발행한 글의 어휘"에서 유도했다. 두 가지가 무너졌다.
 *  1. 주제 공간이 닫힌다. 이미 쓴 것에 대해서만 쓸 수 있게 되어 시간이 갈수록 좁아진다.
 *  2. 오염이 영구화된다. "인천 아시아나 마일리지 전환 후 전자담배 구매 활용법"이 한 번
 *     발행되면 마일리지가 업종 어휘로 승격되어 다음 생성의 근거가 된다.
 *
 * 그래서 도메인 판정의 루트 권한은 이 파일이 갖는다.
 * 발행 이력은 후보 우선순위와 중복 방지에만 쓴다 (buildDomainAnchors).
 *
 * 로직은 업종 중립이다. 아래 VAPE_DOMAIN_CONTRACT만 교체하면 다른 업종에 그대로 쓸 수 있다.
 */

export interface DomainContract {
  /** 업종 식별자. 로그와 프롬프트에 쓴다. */
  label: string;
  /** 제품군 — 이 업종이 파는 것 */
  productCategories: string[];
  /** 부품·소모품 */
  components: string[];
  /** 사용자가 겪는 문제와 증상 */
  problems: string[];
  /** 행동 의도 — 독자가 하려는 것 */
  intents: string[];
  /** 승인된 브랜드·제품명. 신제품은 여기에 추가한다. */
  brands: string[];
  /** 업종 정체성 표현 (상호 등) */
  identity: string[];
}

export const VAPE_DOMAIN_CONTRACT: DomainContract = {
  label: "전자담배 리테일",

  productCategories: [
    "전자담배",
    "전담",
    "액상",
    "액상형",
    "기기",
    "일회용",
    "입호흡",
    "폐호흡",
    "베이프",
    "시가",
    "궐련",
    "연초",
  ],

  components: [
    "코일",
    "팟",
    "무화기",
    "배터리",
    "충전",
    "카트리지",
    "탱크",
    "드립팁",
    "니코틴",
    "농도",
    "고농도",
    "멘솔",
    "디저트",
    "과일",
    "출력",
    "와트",
    "스펙",
  ],

  problems: [
    "누수",
    "액튐",
    "탄맛",
    "고장",
    "불량",
    "증상",
    "원인",
    "해결",
    "해결법",
    "해결방법",
    "점검",
    "수리",
    "교체",
    "관리",
    "관리법",
    "보관",
    "수명",
    "가습현상",
    "분리현상",
  ],

  intents: [
    "추천",
    "비교",
    "선택",
    "선택법",
    "구분",
    "구분법",
    "입문",
    "입문자",
    "초보",
    "사용법",
    "후기",
    "리뷰",
    "체감",
    "실사용",
    "상담",
    "방문",
    "매장",
    "구매",
    "예산",
    "가격",
    "시기",
    "주의사항",
  ],

  brands: [
    "만수르",
    "말론",
    "말론바",
    "아스트로",
    "발라리안",
    "젤로",
    "젤로맥스",
    "크로스미니",
    "베이포레소",
    "그래피티",
    "버블몬",
    "유웰",
    "딜런",
    "베놈",
    "닷모드",
    "닷팟",
    "도조",
    "오팔",
    "릴렉스",
    "후노즈",
    "리플",
    "쿠모카시",
    "버니",
    "잽쥬스",
    "아이수",
    "핵쥬스",
    "곰방대",
  ],

  identity: ["만수르", "만수동만수르", "부평전자담배", "인천전자담배", "구월동전자담배"],
};

/** 계약 전체를 하나의 어휘 집합으로 편다. */
export function buildContractVocabulary(contract: DomainContract): Set<string> {
  return new Set(
    [
      ...contract.productCategories,
      ...contract.components,
      ...contract.problems,
      ...contract.intents,
      ...contract.brands,
      ...contract.identity,
    ].map((term) => term.normalize("NFKC"))
  );
}

/**
 * 프롬프트에 넣을 계약 선언.
 * 모델이 "무엇을 쓸 수 있는지"를 검색 결과가 아니라 이 목록에서 알게 한다.
 */
export function formatDomainContract(contract: DomainContract): string {
  return [
    `## 업종 계약 — ${contract.label}`,
    "이 블로그가 다룰 수 있는 범위는 아래가 전부입니다. 여기에 없는 소재는 주제로 만들지 마세요.",
    "",
    `제품군: ${contract.productCategories.join(", ")}`,
    `부품·소모품: ${contract.components.join(", ")}`,
    `문제·증상: ${contract.problems.join(", ")}`,
    `독자 의도: ${contract.intents.join(", ")}`,
    `브랜드·제품명: ${contract.brands.join(", ")}`,
    "",
    "규칙:",
    "- 위 범위 밖의 고유명사(건물, 다리, 경기장, 헬스기구, 금융상품, 동물, 항공 마일리지 등)를 주제에 넣지 마세요.",
    "- 지역명은 위 소재를 수식할 때만 씁니다. 지역명 단독은 주제가 아닙니다.",
    "- 새 제품이 나왔더라도 위 브랜드 목록에 없으면 주제로 만들지 마세요.",
  ].join("\n");
}

/**
 * 주어 어휘 — 의도어를 뺀 것.
 *
 * "추천", "사용법", "후기" 같은 의도어는 업종을 규정하지 않는다. 어느 업종이든 쓴다.
 * 의도어까지 포함해서 판정했더니 "디랙스 스미스머신 사용법"이 사용법 하나로 통과했다.
 * 업종이 성립하려면 제품·부품·문제·브랜드 같은 주어가 있어야 한다.
 */
export function buildSubjectVocabulary(contract: DomainContract): Set<string> {
  return new Set(
    [
      ...contract.productCategories,
      ...contract.components,
      ...contract.problems,
      ...contract.brands,
      ...contract.identity,
    ].map((term) => term.normalize("NFKC"))
  );
}

/**
 * 텍스트가 계약 범위 안에 있는지 본다.
 * 의도어가 아니라 주어 어휘를 하나라도 포함해야 통과한다.
 */
export function touchesContract(text: string, contract: DomainContract): boolean {
  const normalized = text.normalize("NFKC");
  return [...buildSubjectVocabulary(contract)].some((term) => normalized.includes(term));
}

/**
 * 리서치 결과 정화.
 *
 * 네이버 검색/카페/지식인 결과는 다주제 마케팅 블로그 때문에 오염돼 있다.
 * 계약 용어를 하나도 건드리지 않는 항목은 이 업종의 자료가 아니므로 버린다.
 *
 * 이 함수는 두 곳에서 쓴다.
 *  - strategy-planner의 tool 실행 결과 (모델이 직접 호출하는 경로)
 *  - strategy에 저장되는 naverSignals (master-writer 프롬프트로 흐르는 경로)
 * 토픽 생성만 막으면 이 두 경로로 같은 오염이 재유입된다.
 */
export function sanitizeResearchItems<T extends { title?: string; description?: string }>(
  items: T[] | undefined,
  contract: DomainContract
): T[] {
  if (!items?.length) return [];
  return items.filter((item) => touchesContract(`${item.title ?? ""} ${item.description ?? ""}`, contract));
}

export function sanitizeResearchTexts(
  values: string[] | undefined,
  contract: DomainContract
): string[] {
  if (!values?.length) return [];
  return values.filter((value) => touchesContract(value, contract));
}

/** 검색 리서치 결과에서 자유 텍스트 필드만 정화한다. 수치 필드는 그대로 둔다. */
export function sanitizeKeywordResearch<T extends object>(
  research: T,
  contract: DomainContract
): T {
  const next = { ...research } as Record<string, unknown>;

  if (Array.isArray(next.relatedKeywords)) {
    next.relatedKeywords = (next.relatedKeywords as Array<{ word: string }>).filter((item) =>
      touchesContract(item.word ?? "", contract)
    );
  }
  for (const key of ["questionIntents", "communitySignals"]) {
    if (Array.isArray(next[key])) {
      next[key] = sanitizeResearchTexts(next[key] as string[], contract);
    }
  }
  // longtailSuggestions는 makeLongtails가 검색 키워드 + 연관어로 합성한 값이다.
  // 앞에 붙은 키워드에 업종어가 있어서 필터를 그냥 통과한다("만수동 전자담배 스미스머신").
  // 오염된 입력에서 기계적으로 만든 값이라 거르는 게 아니라 버리는 게 맞다.
  if (Array.isArray(next.longtailSuggestions)) {
    next.longtailSuggestions = [];
  }
  const summary = next.summary as Record<string, unknown> | undefined;
  if (summary && Array.isArray(summary.contentAngles)) {
    next.summary = {
      ...summary,
      contentAngles: sanitizeResearchTexts(summary.contentAngles as string[], contract),
    };
  }
  return next as T;
}
