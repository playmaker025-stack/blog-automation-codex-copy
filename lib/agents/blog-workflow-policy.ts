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

export function hasAllowedLocality(title: string): boolean {
  const normalized = title.replace(/\s+/g, "");
  return ALLOWED_LOCALITY_TERMS.some((term) => normalized.includes(term));
}

export function filterBlockedTopics<T extends { title: string }>(topics: T[]): T[] {
  return topics.filter((topic) => !isBlockedTopicTitle(topic.title) && !hasOutsideLocality(topic.title));
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
