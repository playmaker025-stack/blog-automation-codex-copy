import type { Topic } from "@/lib/types/github-data";

export const SEO_PASS_THRESHOLD = 90;

export const BLOCKED_TOPIC_PATTERNS = [
  /래딜/i,
  /라딜/i,
  /매장\s*vs\s*온라인\s*구매/i,
  /매장\s*대\s*온라인\s*구매/i,
  /전자담배\s*액상\s*끊는\s*법/i,
  /전자담배\s*액상\s*끊기/i,
];

export const ALLOWED_LOCALITY_TERMS = [
  "인천",
  "부평",
  "만수",
  "구월",
  "부평역",
  "만수역",
  "계산동",
  "남동구",
  "부평구",
  "부평시장",
  "부평구청",
  "부천",
  "상동",
  "중동",
  "남동",
  "송도",
  "청라",
  "연수",
  "주안",
  "간석",
  "갈산동",
  "갈산",
  "계산",
  "삼산동",
  "백운",
  "부개동",
  "작전동",
  "청천동",
  "검단",
  "서창",
  "논현",
  "동암",
  "부개",
  "삼산",
  "십정",
  "인천대입구",
];

export const BLOCKED_OUTSIDE_LOCALITY_TERMS = [
  "서울",
  "강남",
  "홍대",
  "신촌",
  "잠실",
  "건대",
  "성수",
  "부산",
  "대구",
  "대전",
  "광주",
  "울산",
  "수원",
  "용인",
  "성남",
  "분당",
  "일산",
  "파주",
  "김포",
  "안산",
  "안양",
  "시흥",
  "경기",
  "평택",
  "천안",
  "청주",
  "전주",
  "제주",
  "포항",
  "창원",
  "김해",
  "구미",
  "원주",
  "춘천",
  // -리로 끝나는 운영 외 지명. isLocalityToken의 접미사에서 "리"를 뺐기 때문에
  // 패턴으로는 안 잡힌다. 실제 글 제목에서 -리 토큰은 배터리/엔트리/총정리뿐이라
  // 접미사를 복원하면 "배터리" 주제가 지역명으로 오인돼 차단된다. 그래서 지명만 직접 넣는다.
  "청량리",
  "왕십리",
];

/**
 * 명백한 타업종 용어.
 *
 * 리서치 키워드가 지역명 단독("만수동")이 되면 네이버 검색 결과가 그 지역의 병원/대출/부동산
 * 글로 채워지고, 그 신호가 연관 키워드와 질문 의도로 프롬프트에 그대로 유입된다.
 * 지역 필터는 "인천 안"만 보기 때문에 "부평 병원"은 통과해버린다. 업종 축을 따로 막는다.
 */
export const BLOCKED_OUTSIDE_DOMAIN_TERMS = [
  // 의료
  "병원",
  "의원",
  "치과",
  "한의원",
  "피부과",
  "성형",
  "정형외과",
  "산부인과",
  "약국",
  "탈모",
  "다이어트",
  // 금융
  "대출",
  "보험",
  "적금",
  "예금",
  "신용카드",
  "파산",
  "개인회생",
  "재테크",
  // 부동산
  "부동산",
  "아파트",
  "분양",
  "전세",
  "월세",
  "청약",
  "인테리어",
  "이사업체",
  // 기타 생활 업종
  "맛집",
  "미용실",
  "헤어샵",
  "네일",
  "학원",
  "과외",
  "입시",
  "헬스장",
  "변호사",
  "법무사",
  "세무사",
  "중고차",
  "렌터카",
  "웨딩",
  "장례",
];

export const BLOG_WORKFLOW_PRINCIPLES = [
  "Group topics by the user's blog/category cluster before planning a post.",
  "Treat the topic index as an internal-link map: identify one hub topic and one leaf topic related to the draft.",
  `Only release drafts that can score ${SEO_PASS_THRESHOLD}+ for Naver search intent, structure, helpfulness, and user style match.`,
  "Reject or regenerate topics that match blocked themes such as Raedil posts, store-vs-online-buying posts, or how-to-quit-vape-liquid posts.",
  "Keep local topic planning inside the user's operating area. Priority localities are Incheon, Bupyeong, Mansu, Guwol, Bupyeong Station, Mansu Station, Gyesan-dong, Namdong-gu, Bupyeong-gu, Bupyeong Market, Bupyeong-gu Office, Bucheon, Sang-dong, and Jung-dong.",
  "Secondary localities are Juan, Ganseok, Gyesan, Samsan-dong, Baegun, Bugae-dong, Jakjeon-dong, and Cheongcheon-dong. Use other Incheon areas only after these have been covered.",
  "Important: vape/electronic-cigarette product, liquid, device, beginner guide, local recommendation, review, setup, and troubleshooting posts are allowed. Only cessation/how-to-quit-liquid angles are blocked.",
  "Do not use a chat trigger workflow. The user must select a topic in the pipeline or enter a free-form title.",
  "Before writing, the pipeline must read topics.json and posting-list/index.json, then block duplicate topicId or similar-title risks.",
  "Expansion lists must generate exactly 5 candidate topics unless the user selects fewer and asks for replacements.",
  "For E blog, avoid abstract culture or psychology essays. The topic must include at least one concrete product, situation, user type, locality, or usage scene.",
  "Problem-solving drafts must include situation, normal/abnormal distinction, cause classification, checkpoints, solutions, and when inspection is needed.",
  "Penalize generic advice such as 'manage it well' unless it explains why, when, and what to check.",
];

export function isBlockedTopicTitle(title: string): boolean {
  return BLOCKED_TOPIC_PATTERNS.some((pattern) => pattern.test(title));
}

export function hasOutsideLocality(title: string): boolean {
  const normalized = title.replace(/\s+/g, "");
  return BLOCKED_OUTSIDE_LOCALITY_TERMS.some((term) => normalized.includes(term));
}

/**
 * 특정 건물·랜드마크 이름.
 *
 * 지역 축은 아직 블랙리스트라 목록에 없는 지명은 전부 통과한다.
 * 그래서 "인천 송도 포스코타워 전자담배 구매처"가 나왔다 —
 * 인천/송도가 허용 목록에 있어 지역 검사를 통과하고, 전자담배가 있어 업종 검사도 통과했다.
 *
 * 매장은 랜드마크가 아니라 실제 주소에 있다. 건물명을 붙인 "구매처" 글은
 * 존재하지 않는 매장 위치를 지어내는 셈이라 단순한 부적합보다 나쁘다.
 * 그래서 건물명은 허용 지역 안이든 밖이든 무조건 막는다.
 *
 * 접미사는 오탐이 없는 것만 골랐다. "센터", "몰", "백화점"은 서비스센터/쇼핑몰처럼
 * 일반 문맥에서도 쓰여서 뺐다.
 */
const LANDMARK_MARKERS = [
  "타워",
  "스퀘어",
  "스트리트",
  "플라자",
  "프라자",
  "아울렛",
  "캠퍼스",
  "신도시",
  "빌딩",
];

export function hasLandmarkMention(title: string): boolean {
  return title
    .split(/\s+/)
    .map((raw) => raw.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").trim())
    // endsWith가 아니라 includes다. "스퀘어원", "트리플스트리트"처럼
    // 표지가 이름 중간에 오는 경우가 흔하다.
    .some((token) => token.length >= 3 && LANDMARK_MARKERS.some((marker) => token.includes(marker)));
}

export function hasAllowedLocality(title: string): boolean {
  const normalized = title.replace(/\s+/g, "");
  return ALLOWED_LOCALITY_TERMS.some((term) => normalized.includes(term));
}

/**
 * 지역 검사(`hasOutsideLocality`)와 달리 공백을 제거하지 않는다.
 * 공백을 지우면 "확대 출시"가 "확대출시"가 되어 "대출"에 걸리는 식의 오탐이 생긴다.
 * 업종 용어는 지역명과 달리 다른 단어에 흡수되기 쉬워서 원문 그대로 검사한다.
 */
export function hasOutsideDomain(text: string): boolean {
  return BLOCKED_OUTSIDE_DOMAIN_TERMS.some((term) => text.includes(term));
}

/** 지역명 단독 토큰인지 판별한다. 리서치 키워드가 지역명만 남는 것을 막는 데 쓴다. */
export function isLocalityToken(token: string): boolean {
  const normalized = token.replace(/\s+/g, "");
  if (!normalized) return false;
  if (ALLOWED_LOCALITY_TERMS.includes(normalized)) return true;
  if (BLOCKED_OUTSIDE_LOCALITY_TERMS.includes(normalized)) return true;
  // 면/리는 뺐다. "방문하면", "시작하면", "바꾸면"처럼 조건 어미 -면이 훨씬 흔하고,
  // -리도 "자가수리" 같은 업종어와 충돌한다. 이 사업 영역(인천)에 면/리 단위 지명도 없다.
  return /^[가-힣]{2,5}(동|읍|구|시|군|역)$/u.test(normalized);
}

/**
 * 지역명처럼 생겼지만 지역이 아닌 일반 복합어.
 *
 * isLocalityToken은 `2~5글자 + 동/읍/면/리/구/시/군/역` 패턴을 쓴다.
 * 2음절 일반어(자동, 수동, 이동, 운동, 지역, 영역)는 접미사 앞이 한 글자라 애초에 안 걸린다.
 * 걸리는 건 3음절 이상 복합어뿐이라 예외 목록이 작게 유지된다.
 */
const NON_PLACE_TOKENS = new Set([
  "흡연구역",
  "금연구역",
  "주차구역",
  "안전구역",
  "위험구역",
  "재작동",
  "오작동",
  "반자동",
  "전자동",
  "재가동",
  "출입구",
  "비상구",
  "예비군",
]);

/**
 * 허용 목록에 없는 지역명을 찾는다.
 *
 * 지역 축을 블랙리스트에서 화이트리스트로 뒤집는 부분이다.
 * 전에는 "서울/부산 등이 들어있나"만 봐서 목록에 없는 지명(청량리, 판교동)이 전부 통과했다.
 * 이제는 지역명처럼 생긴 토큰이 있으면 허용 목록에 속하는지 확인한다.
 */
export function findDisallowedLocalityTokens(title: string): string[] {
  return title
    .split(/\s+/)
    .map((raw) => raw.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").trim())
    .filter(
      (token) =>
        isLocalityToken(token) &&
        !NON_PLACE_TOKENS.has(token) &&
        !ALLOWED_LOCALITY_TERMS.some((term) => token.includes(term))
    );
}

export function hasDisallowedLocality(title: string): boolean {
  return findDisallowedLocalityTokens(title).length > 0;
}

/**
 * 리서치 신호(연관 키워드, 질문 의도, 카페 신호)에서 타업종 조각을 걷어낸다.
 * 프롬프트에 들어가기 전에 막아야 모델이 애초에 그 주제를 떠올리지 않는다.
 */
export function filterOutsideDomainSignals(values: string[]): string[] {
  return values.filter((value) => !hasOutsideDomain(value));
}

/**
 * 업종 어휘 적중률로 "결합형" 주제를 걸러낸다.
 *
 * 업종어 하나만 있으면 통과하는 isOnDomainTopic으로는 결합형을 못 잡는다.
 * "인천 아시아나 마일리지 전환 후 전자담배 구매 활용법"은 전자담배가 있어서 통과했다.
 *
 * 한계: 적중률은 "희석"을 재지 "오염"을 재지 못한다. 나머지 단어가 전부 정상이면
 * 이물질 하나가 섞여도 비율이 안 떨어진다. "인천 전자담배 초보자를 위한 디랙스
 * 스미스머신 사용법"은 60%로 통과한다. 그래서 이 필터는 마지막 그물일 뿐이고,
 * 실제 방어는 신호 단계(filterSignalsByDomainVocabulary)에서 해야 한다.
 *
 * 짧은 제목은 제외한다. "말론S 후기"처럼 신제품명 하나로 된 제목이 0%로 걸리기 때문이다.
 */
const MIN_COHERENCE_TOKENS = 4;
const MIN_COHERENCE_RATIO = 0.3;

export function domainCoherenceRatio(text: string, vocabulary: Set<string>): number {
  const tokens = meaningfulTokens(text);
  if (tokens.length === 0) return 1;
  const known = tokens.filter(
    (token) =>
      vocabulary.has(token) ||
      [...vocabulary].some((term) => term.length >= 3 && token.includes(term))
  ).length;
  return known / tokens.length;
}

export function isTopicVocabularyCoherent(
  topic: { title: string },
  vocabulary: Set<string>
): boolean {
  if (vocabulary.size < MIN_DOMAIN_VOCABULARY) return true;
  const tokens = meaningfulTokens(topic.title);
  if (tokens.length < MIN_COHERENCE_TOKENS) return true;
  return domainCoherenceRatio(topic.title, vocabulary) >= MIN_COHERENCE_RATIO;
}

/**
 * 리서치 신호에서 업종 어휘 밖 토큰이 하나라도 있으면 통째로 버린다.
 *
 * 왜 "하나라도"인가:
 * 처음에는 "토큰 중 하나라도 업종어면 통과"로 만들었는데 그게 구멍이었다.
 * makeLongtails가 연관어 앞에 검색 키워드를 붙여서 "만수동 전자담배 스미스머신"을 만든다.
 * 여기엔 전자담배가 들어 있으니 통과해버리고, 모델은 스미스머신을 주제 재료로 받는다.
 * 실제로 "인천 전자담배 초보자를 위한 디랙스 스미스머신 사용법"이 그렇게 나왔다.
 *
 * 오염은 희석이 아니다. 이물질 하나면 주제가 망가지므로 하나라도 있으면 버린다.
 * 신호는 참고값이라 버리는 비용이 낮다. 새 제품명이 잠깐 신호에서 빠지는 편이
 * 헬스기구가 주제로 올라오는 것보다 훨씬 낫다.
 */
export function filterSignalsByDomainVocabulary(
  values: string[],
  vocabulary: Set<string>
): string[] {
  if (vocabulary.size < MIN_DOMAIN_VOCABULARY) return values;
  return values.filter((value) => {
    const tokens = meaningfulTokens(value);
    if (tokens.length === 0) return false;
    return tokens.every(
      (token) =>
        vocabulary.has(token) ||
        [...vocabulary].some((term) => term.length >= 3 && token.includes(term))
    );
  });
}

export function filterBlockedTopics<T extends { title: string }>(topics: T[]): T[] {
  return topics.filter(
    (topic) =>
      !isBlockedTopicTitle(topic.title) &&
      !hasOutsideLocality(topic.title) &&
      !hasDisallowedLocality(topic.title) &&
      !hasLandmarkMention(topic.title) &&
      !hasOutsideDomain(topic.title)
  );
}

/**
 * 업종 축 판별.
 *
 * 타업종 주제를 금지어 목록으로 막으려 했더니 계속 샜다.
 * 병원/대출을 막으니 맞춤복/택배가 나왔다 — 금지어를 늘리는 건 두더지 잡기다.
 * 그래서 **사용자 기존 글의 어휘로 화이트리스트를 만들어** 뒤집는다.
 * 업종 용어를 하드코딩하지 않으므로 다른 업종에도 그대로 쓸 수 있다.
 *
 * 두 가지를 따로 만든다.
 * - anchors: 빈도 2 이상 상위 토큰. 프롬프트에 "이 업종 축을 지켜라"로 보여주는 용도.
 * - vocabulary: 제목+설명+태그의 모든 의미 토큰. 실제 차단 판정용.
 *   앵커만으로 판정하면 "코일 탄맛"처럼 발행 이력이 적은 정상 주제가 함께 막힌다.
 */
const DOMAIN_ANCHOR_STOPWORDS = new Set([
  "추천", "후기", "리뷰", "정리", "방법", "이유", "기준", "비교", "차이", "선택",
  "가이드", "사용법", "입문", "처음", "완벽", "총정리", "고르는", "무엇", "어디",
  "베스트", "순위", "best", "top",
]);

/** 어휘가 이보다 적으면 근거가 부족하다고 보고 차단하지 않는다. */
const MIN_DOMAIN_VOCABULARY = 20;

function meaningfulTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((raw) => raw.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !isLocalityToken(token) &&
        !hasOutsideDomain(token) &&
        // 범용어를 남기면 어휘가 오염된다. "롯데택배 배송 서비스 이용 방법"이
        // "방법" 하나로 통과해버렸다.
        !DOMAIN_ANCHOR_STOPWORDS.has(token.toLowerCase())
    );
}

/** 프롬프트에 보여줄 업종 축 상위 토큰. */
export function buildDomainAnchors(topics: Topic[]): string[] {
  const counts = new Map<string, number>();
  for (const topic of topics) {
    const tokens = [
      ...(topic.tags ?? []).flatMap(meaningfulTokens),
      ...meaningfulTokens(topic.title ?? ""),
    ];
    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 15)
    .map(([token]) => token);
}

/** 어미로 끝나는 활용형은 업종 어휘가 아니다. "좋을까", "괜찮나" 같은 조각을 걸러낸다. */
function looksConjugated(token: string): boolean {
  return /(까|죠|네|나|다|군요|는지)$/u.test(token);
}

/**
 * 차단 판정용 어휘.
 *
 * 설명문까지 넣으면 어휘가 272개로 늘지만 활용형과 일반 서술어가 섞여 화이트리스트가 헐거워진다.
 * 제목과 태그만 쓰면 145개로 좁아지면서도 코일/탄맛/누수/니코틴 같은 핵심 용어는 그대로 남는다.
 * 판정 대상 쪽은 제목+설명+태그를 모두 보므로 과차단은 이 축소로 늘지 않는다.
 */
export function buildDomainVocabulary(topics: Topic[]): Set<string> {
  const vocabulary = new Set<string>();
  for (const topic of topics) {
    const text = [topic.title ?? "", ...(topic.tags ?? [])].join(" ");
    for (const token of meaningfulTokens(text)) {
      if (looksConjugated(token)) continue;
      vocabulary.add(token);
    }
  }
  return vocabulary;
}

/**
 * 생성된 주제가 이 블로그 업종 안에 있는지 본다.
 * 근거(어휘)가 부족하면 막지 않는다 — 전부 차단되는 편이 더 나쁘다.
 */
export function isOnDomainTopic(
  topic: { title: string; description?: string; tags?: string[] },
  vocabulary: Set<string>
): boolean {
  if (vocabulary.size < MIN_DOMAIN_VOCABULARY) return true;
  // 제목만 본다. 예전에는 설명·태그까지 합쳐서 봤는데, 오프도메인 제목에 태그만
  // "전자담배"로 달면 통과하는 구멍이었다. 태그는 작성자가 임의로 넣는 값이라
  // 업종 판정의 근거가 될 수 없다.
  const text = topic.title;
  const tokens = meaningfulTokens(text);
  if (tokens.some((token) => vocabulary.has(token))) return true;

  // 붙여쓴 복합어 대응. "부천전자담배"는 한 토큰이라 정확히 일치하지 않지만
  // 업종어 "전자담배"를 품고 있다. 짧은 어휘로 인한 우연한 일치를 막으려고 3글자 이상만 본다.
  return tokens.some((token) =>
    [...vocabulary].some((term) => term.length >= 3 && token.includes(term))
  );
}

export function summarizeTopicLinkMap(currentTopic: Topic, allTopics: Topic[]): string {
  const sameCategory = allTopics.filter(
    (topic) => topic.topicId !== currentTopic.topicId && topic.category === currentTopic.category
  );
  const sameTag = allTopics.filter(
    (topic) =>
      topic.topicId !== currentTopic.topicId &&
      topic.tags.some((tag) => currentTopic.tags.includes(tag))
  );

  const hubCandidates = sameCategory
    .filter((topic) => topic.status === "published" || topic.status === "draft")
    .slice(0, 5);
  const leafCandidates = sameTag
    .filter((topic) => !hubCandidates.some((hub) => hub.topicId === topic.topicId))
    .slice(0, 5);

  const format = (topic: Topic) =>
    `- ${topic.title} [${topic.status}, category: ${topic.category}, id: ${topic.topicId}]`;

  return [
    `Current blog/category group: ${currentTopic.category}`,
    "Hub candidates from the same blog/category group:",
    hubCandidates.length ? hubCandidates.map(format).join("\n") : "- none found; create a natural hub-style reference from the category",
    "Leaf candidates from shared tags or close subtopics:",
    leafCandidates.length ? leafCandidates.map(format).join("\n") : "- none found; create a natural leaf-style reference from the current topic",
    "Internal-link rule: include exactly one hub reference and one leaf reference in the outline/body. If a URL is not available yet, include the target title as anchor text for later linking.",
  ].join("\n");
}

export function buildPolicyPromptSection(): string {
  return [
    "## Mandatory blog workflow policy",
    ...BLOG_WORKFLOW_PRINCIPLES.map((principle) => `- ${principle}`),
    "",
    "## Blocked topic themes",
    "- Do not plan or write Raedil-related posts.",
    "- Do not plan or write store vs online purchase comparison posts.",
    "- Do not plan or write posts titled or angled around how to quit electronic cigarette liquid.",
    "- Do not plan outside-area locality posts. If a locality is used, it must be inside the user's operating area.",
    "- Stay inside the user's own industry. A locality name alone is not a topic — every topic must be about the user's actual products and services.",
    "- Never name a specific building, tower, mall, or landmark. The store has a street address, not a landmark. Use only administrative area or station names from the allowed list.",
    "- The allowed locality list is exhaustive. Any other area name, even elsewhere in Incheon, is rejected.",
    `- Never plan topics about other industries even inside the operating area: ${BLOCKED_OUTSIDE_DOMAIN_TERMS.join(", ")}.`,
    "- Research signals are pulled from local search results and may contain other industries. Ignore any signal that is not about the user's own business.",
    `- Allowed locality terms: ${ALLOWED_LOCALITY_TERMS.join(", ")}.`,
    `- Block outside locality terms: ${BLOCKED_OUTSIDE_LOCALITY_TERMS.join(", ")}.`,
    "- Do not interpret the previous line as a ban on electronic-cigarette content in general.",
    "- Allowed examples: local vape shop recommendations, beginner device recommendations, liquid selection guides, device setup, coil/pod troubleshooting, product reviews, and practical user guides.",
    "- Blocked examples only: 'how to quit vape liquid', 'stop using electronic cigarette liquid', or cessation-focused liquid posts.",
    "",
    "## Naver SEO release rule",
    `- A draft is usable only when it is likely to score ${SEO_PASS_THRESHOLD}+ for Naver SEO/search intent.`,
    "- The draft must satisfy search intent directly, use long-tail keywords naturally, avoid keyword stuffing, and include concrete helpful sections.",
    "- The body must include one hub reference and one leaf reference selected from the topic index or clearly prepared as anchor text.",
    "- E-blog drafts must be concrete, not abstract lifestyle/culture/psychology generalizations.",
    "- Problem-solving drafts must cover: situation, normal vs abnormal, cause groups, checkpoints, solutions, and inspection timing.",
    "- Generic claims without concrete checks or reasons reduce the release score.",
  ].join("\n");
}
