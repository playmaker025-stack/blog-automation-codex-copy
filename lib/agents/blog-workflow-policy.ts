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
  return /^[가-힣]{2,5}(동|읍|면|리|구|시|군|역)$/u.test(normalized);
}

/**
 * 리서치 신호(연관 키워드, 질문 의도, 카페 신호)에서 타업종 조각을 걷어낸다.
 * 프롬프트에 들어가기 전에 막아야 모델이 애초에 그 주제를 떠올리지 않는다.
 */
export function filterOutsideDomainSignals(values: string[]): string[] {
  return values.filter((value) => !hasOutsideDomain(value));
}

export function filterBlockedTopics<T extends { title: string }>(topics: T[]): T[] {
  return topics.filter(
    (topic) =>
      !isBlockedTopicTitle(topic.title) &&
      !hasOutsideLocality(topic.title) &&
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
  const text = [topic.title, topic.description ?? "", ...(topic.tags ?? [])].join(" ");
  return meaningfulTokens(text).some((token) => vocabulary.has(token));
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
