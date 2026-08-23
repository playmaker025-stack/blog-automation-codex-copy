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
  /** 같은 대상을 가리키는 표기. 커버리지 조합에서 중복을 없애는 데 쓴다. */
  aliases: Record<string, string>;
  /**
   * 업종 안이지만 다루지 않기로 한 소재.
   *
   * 계약 목록에서 빼는 것만으로는 부족하다. 그러면 커버리지 생성기가 제안하지 않을 뿐,
   * 카페/지식인에서 그 주제 질문이 올라오면 그대로 주제가 된다. 명시적으로 막는다.
   */
  excludedTopics: string[];
  /**
   * 제외 소재를 부분 문자열로 품고 있지만 허용하는 표현.
   *
   * "무니코틴"은 "니코틴"을 품고 있어 그대로 두면 막힌다. 그런데 무니코틴은
   * 니코틴 함량 얘기가 아니라 제품 분류이고, 오히려 니코틴을 피하는 쪽 소재다.
   */
  excludedOverrides: string[];
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
    "멘솔",
    "디저트",
    "과일",
    "출력",
    "와트",
    "스펙",
    "무화량",
    "연기",
    "흡입",
    "타격감",
    "냄새",
    "유통기한",
    "청소",
    // 구로 넣는다. "고농도" 단독은 무엇의 농도인지 모호하고, "농도"만 등록하면
    // 니코틴 농도까지 열리기 때문이다. 계약 항목은 여러 어절이어도 된다.
    "고농도 액상",
    "무니코틴",
  ],

  // 업종을 특정하는 증상만 남긴다. "고장", "증상", "원인" 같은 일반어는 어느 업종이든
  // 쓰기 때문에 주어가 될 수 없다. 실측에서 "CC-02 고장난 부품차 섀시"(RC카 부품)가
  // "고장" 하나로 업종 검사를 통과했다. 일반 문제어는 intents로 옮겼다.
  problems: [
    "누수",
    "액튐",
    "탄맛",
    "가습현상",
    "분리현상",
    "변색",
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
    "시기",
    "주의사항",
    "가성비",
    "노하우",
    "신제품",
    "한정판",
    "여름철",
    "겨울철",
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
    "소음",
    "실패",
    "실수",
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
    "스팀랩",
    "돌체",
    "펠릭스랩",
    "더블라임",
    "메가킥",
    "엘프바",
    "아스몬",
    "DJ쥬스",
    "BPMODS",
    "RAZOR",
    "BORO",
    "MK3",
  ],

  identity: ["만수르", "만수동만수르", "부평전자담배", "인천전자담배", "구월동전자담배"],

  // "전담 × 고장"과 "전자담배 × 고장"은 같은 주제다. 대표 표기로 모은다.
  aliases: {
    전담: "전자담배",
    액상형: "액상",
    베이프: "전자담배",
    해결법: "해결",
    해결방법: "해결",
    관리법: "관리",
    선택법: "선택",
    구분법: "구분",
    초보: "입문자",
    입문: "입문자",
    리뷰: "후기",
    실사용: "후기",
    체감: "후기",
    말론바: "말론",
    젤로맥스: "젤로",
  },

  // 니코틴과 가격은 다루지 않는다. 업종 안이지만 사업 판단으로 제외한 소재다.
  //
  // "농도"는 넣지 않는다. 제외 검사가 부분 문자열이라 "농도"를 막으면 "고농도"까지
  // 같이 막힌다. 문제는 니코틴이지 농도 표현 자체가 아니므로 "니코틴"만 막는다.
  excludedTopics: [
    "니코틴",
    "가격",
    "비용",
    "예산",
    "최저가",
    "할인",
    "얼마",
    "원대",
  ],

  excludedOverrides: ["무니코틴"],
};

/**
 * 미개척 조합을 네이버 검색어로 바꾼다.
 *
 * 검색 키워드가 발행 이력의 최빈어 하나뿐이면 그 주변만 계속 돈다. 조합을 검색어로
 * 쓰면 아직 안 다룬 영역의 실수요를 가져올 수 있다.
 *
 * 업종어를 앞에 붙이는 이유: "코일 불량"만 검색하면 자동차/기계 코일 글이 섞인다.
 * 소재 자체가 업종을 특정하지 못하는 경우가 많아 항상 붙인다.
 */
export function buildGapSearchKeyword(gap: CoverageGap, contract: DomainContract): string {
  const anchor = contract.productCategories[0] ?? "";
  const base = `${gap.subject} ${gap.angle}`.trim();
  if (!anchor || base.includes(anchor)) return base;
  return `${anchor} ${base}`;
}

/**
 * 관점을 뺀 넓은 검색어.
 *
 * "전자담배 리플 추천"처럼 세 단어로 검색하면 네이버가 돌려주는 글이 몇 건 안 된다.
 * 실측에서 조합 검색 5개를 붙였는데 수집이 36건에 그쳤다(중복 제거 후 조합 기여분 6건).
 * 소재만으로 한 번 더 검색해 표본을 넓힌다.
 */
export function buildBroadGapSearchKeyword(gap: CoverageGap, contract: DomainContract): string {
  const anchor = contract.productCategories[0] ?? "";
  if (!anchor || gap.subject.includes(anchor)) return gap.subject;
  return `${anchor} ${gap.subject}`;
}

/**
 * 다루지 않기로 한 소재를 건드리는지 본다.
 * 허용 예외를 먼저 가려낸 뒤에 검사한다. 안 그러면 "무니코틴"이 "니코틴"에 걸린다.
 */
export function touchesExcludedTopic(text: string, contract: DomainContract): boolean {
  let normalized = text.normalize("NFKC");
  for (const override of contract.excludedOverrides) {
    normalized = normalized.split(override).join(" ");
  }
  return contract.excludedTopics.some((term) => normalized.includes(term));
}

function canonical(term: string, contract: DomainContract): string {
  return contract.aliases[term] ?? term;
}

export interface CoverageGap {
  subject: string;
  angle: string;
  kind: "problem" | "intent";
}

/**
 * 아직 다루지 않은 (주어 × 관점) 조합을 찾는다.
 *
 * 계약을 필터로만 쓰면 모델에게 "쓰면 안 되는 것"만 알려주는 셈이라, 남은 공간에서
 * 늘 같은 조합만 반복한다. 실측상 계약 조합 2296개 중 발행된 건 257개(11%)뿐인데도
 * 비슷한 주제만 나왔다. 소재가 없는 게 아니라 어디가 비었는지 알려주는 장치가 없었다.
 *
 * 계약을 생성기로 쓴다. 외부 데이터가 전혀 필요 없으므로 오염 경로도 없다.
 */
export function findCoverageGaps(params: {
  contract: DomainContract;
  publishedTitles: string[];
  limit?: number;
  /** 실행마다 다른 구간을 보여주기 위한 회전값. 같은 값이면 같은 결과가 나온다. */
  rotation?: number;
}): CoverageGap[] {
  const { contract, publishedTitles, limit = 12, rotation = 0 } = params;

  const subjects = [
    ...contract.productCategories,
    ...contract.components,
    ...contract.brands,
  ];
  const angles: Array<{ term: string; kind: "problem" | "intent" }> = [
    ...contract.problems.map((term) => ({ term, kind: "problem" as const })),
    ...contract.intents.map((term) => ({ term, kind: "intent" as const })),
  ];

  // 발행 글에 얼마나 자주 나오는 말인지. 조합의 그럴듯함을 재는 데 쓴다.
  // "액상 × 보관"은 둘 다 자주 쓰는 말이라 말이 되고, "궐련 × 가습현상"은 그렇지 않다.
  const frequency = (term: string): number =>
    publishedTitles.reduce((count, title) => count + (title.includes(term) ? 1 : 0), 0);
  const freqCache = new Map<string, number>();
  const freq = (term: string): number => {
    if (!freqCache.has(term)) freqCache.set(term, frequency(term));
    return freqCache.get(term) ?? 0;
  };

  // 대표 표기별로 모든 별칭 형태를 모은다. 이걸 안 하면 "전담 고장"을 쓴 글이 있어도
  // "전자담배 × 고장"을 미개척으로 잘못 제안한다. 대표 표기만으로 본문을 훑기 때문이다.
  const formsOf = (terms: string[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const term of terms) {
      const key = canonical(term, contract);
      const forms = map.get(key) ?? [];
      if (!forms.includes(term)) forms.push(term);
      if (!forms.includes(key)) forms.push(key);
      map.set(key, forms);
    }
    return map;
  };

  const subjectForms = formsOf(subjects);
  const angleForms = formsOf(angles.map((item) => item.term));
  const angleKind = new Map<string, "problem" | "intent">();
  for (const { term, kind } of angles) {
    const key = canonical(term, contract);
    if (!angleKind.has(key)) angleKind.set(key, kind);
  }

  const scored: Array<{ gap: CoverageGap; score: number }> = [];

  for (const [subject, subjectAliases] of subjectForms) {
    for (const [angle, angleAliases] of angleForms) {
      if (subject === angle) continue;

      const covered = publishedTitles.some(
        (title) =>
          subjectAliases.some((form) => title.includes(form)) &&
          angleAliases.some((form) => title.includes(form))
      );
      if (covered) continue;

      // 둘 다 실제로 쓰는 말일수록 그럴듯한 조합이다. 한 번도 안 쓴 말은 뒤로 민다.
      const score = (freq(subject) + 1) * (freq(angle) + 1);
      scored.push({
        gap: { subject, angle, kind: angleKind.get(angle) ?? "intent" },
        score,
      });
    }
  }

  if (scored.length === 0) return [];
  scored.sort((left, right) => right.score - left.score);

  // 소재별로 묶은 뒤 라운드로빈으로 섞는다. 정렬만 하면 한 소재의 조합이 연달아 나와서
  // 한 번에 5개를 뽑을 때 전부 같은 소재가 된다.
  const bySubject = new Map<string, CoverageGap[]>();
  for (const { gap } of scored) {
    const bucket = bySubject.get(gap.subject) ?? [];
    bucket.push(gap);
    bySubject.set(gap.subject, bucket);
  }
  const buckets = [...bySubject.values()];
  const interleaved: CoverageGap[] = [];
  for (let index = 0; interleaved.length < scored.length; index += 1) {
    let added = false;
    for (const bucket of buckets) {
      if (index < bucket.length) {
        interleaved.push(bucket[index]);
        added = true;
      }
    }
    if (!added) break;
  }

  const start = ((rotation % interleaved.length) + interleaved.length) % interleaved.length;
  const rotated = [...interleaved.slice(start), ...interleaved.slice(0, start)];

  // 소재만 교차하면 깊은 구간에서 관점이 몰린다("전부 × 상담"). 소재와 관점을 둘 다
  // 안 쓴 조합을 먼저 채우고, 모자라면 그때 중복을 허용한다.
  const usedSubjects = new Set<string>();
  const usedAngles = new Set<string>();
  const picked: CoverageGap[] = [];
  const leftovers: CoverageGap[] = [];

  for (const gap of rotated) {
    if (picked.length >= limit) break;
    if (usedSubjects.has(gap.subject) || usedAngles.has(gap.angle)) {
      leftovers.push(gap);
      continue;
    }
    usedSubjects.add(gap.subject);
    usedAngles.add(gap.angle);
    picked.push(gap);
  }
  for (const gap of leftovers) {
    if (picked.length >= limit) break;
    picked.push(gap);
  }
  return picked;
}

export function formatCoverageGaps(gaps: CoverageGap[]): string {
  if (gaps.length === 0) {
    return "미개척 조합: 계산된 것이 없습니다. 기존 발행 글의 빈틈을 직접 찾아 주제를 만드세요.";
  }
  return [
    "## 아직 다루지 않은 조합 (여기서 골라 쓰세요)",
    "기존 발행 글에 없는 (소재 × 관점) 조합입니다. 서로 다른 조합을 골라 5개 주제가 겹치지 않게 하세요.",
    "조합은 출발점일 뿐이니 제목은 검색자가 실제로 칠 문장으로 다듬으세요.",
    "",
    ...gaps.map((gap) => `- ${gap.subject} × ${gap.angle}`),
  ].join("\n");
}

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
    `다루지 않는 소재: ${contract.excludedTopics.join(", ")}`,
    "",
    "규칙:",
    "- 위 범위 밖의 고유명사(건물, 다리, 경기장, 헬스기구, 금융상품, 동물, 항공 마일리지 등)를 주제에 넣지 마세요.",
    "- '다루지 않는 소재'는 업종 안이지만 제외하기로 한 것입니다. 제목과 설명 어디에도 넣지 마세요.",
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
