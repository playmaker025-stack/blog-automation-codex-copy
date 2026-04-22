import { fileExists, readJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { normalizeUserId } from "@/lib/utils/normalize";
import type { PostingIndex, Topic } from "@/lib/types/github-data";
import type { ContentTopologyPlan, StrategyPlanResult } from "./types";

const HUB_PATTERNS = [
  /가이드/u,
  /입문/u,
  /추천/u,
  /비교/u,
  /종류/u,
  /선택\s*기준/u,
  /체크\s*리스트/u,
  /총정리/u,
  /정리/u,
  /방법/u,
  /처음/u,
  /초보/u,
  /TOP\s*\d+/iu,
];

const LEAF_PATTERNS = [
  /후기/u,
  /리뷰/u,
  /사용법/u,
  /관리법/u,
  /문제/u,
  /해결/u,
  /차이/u,
  /교체/u,
  /세팅/u,
  /액상/u,
  /기기명/u,
];

function textOf(topic: Topic, strategy?: StrategyPlanResult): string {
  return [
    topic.title,
    topic.description,
    topic.category,
    topic.tags.join(" "),
    strategy?.title ?? "",
    strategy?.keywords.join(" ") ?? "",
    strategy?.keyPoints.join(" ") ?? "",
  ].join(" ");
}

function scorePatterns(value: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => score + (pattern.test(value) ? 1 : 0), 0);
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function matchScore(topicText: string, postTitle: string): number {
  const topicTokens = new Set(titleTokens(topicText));
  const postTokens = titleTokens(postTitle);
  if (topicTokens.size === 0 || postTokens.length === 0) return 0;
  return postTokens.filter((token) => topicTokens.has(token)).length / postTokens.length;
}

function inferKind(topic: Topic, strategy?: StrategyPlanResult): ContentTopologyPlan["kind"] {
  const value = textOf(topic, strategy);
  const hubScore = scorePatterns(value, HUB_PATTERNS);
  const leafScore = scorePatterns(value, LEAF_PATTERNS);
  const broadOutline = (strategy?.outline.length ?? 0) >= 4 || (strategy?.estimatedLength ?? 0) >= 1700;

  if (hubScore >= leafScore + 1) return "hub";
  if (leafScore >= hubScore + 1) return "leaf";
  return broadOutline ? "hub" : "leaf";
}

async function findInternalTargets(params: {
  topic: Topic;
  userId: string;
  kind: ContentTopologyPlan["kind"];
}): Promise<ContentTopologyPlan["internalLinkTargets"]> {
  if (!(await fileExists(Paths.postingListIndex()))) return [];

  const { data } = await readJsonFile<PostingIndex>(Paths.postingListIndex());
  const userId = normalizeUserId(params.userId);
  const topicText = textOf(params.topic);
  const published = data.posts
    .filter((post) => post.status === "published")
    .filter((post) => !userId || normalizeUserId(post.userId) === userId)
    .map((post) => ({ post, score: matchScore(topicText, post.title) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return published.map(({ post }) => ({
    title: post.title,
    url: post.naverPostUrl,
    reason:
      params.kind === "hub"
        ? "허브글에서 이어서 볼 세부 리프글 후보"
        : "리프글에서 되돌아갈 상위/관련 허브글 후보",
  }));
}

export async function buildContentTopologyPlan(params: {
  topic: Topic;
  strategy: StrategyPlanResult;
  userId: string;
}): Promise<ContentTopologyPlan> {
  const kind = params.strategy.contentTopology?.kind ?? inferKind(params.topic, params.strategy);
  const internalLinkTargets = await findInternalTargets({
    topic: params.topic,
    userId: params.userId,
    kind,
  }).catch(() => []);

  if (kind === "hub") {
    return {
      kind,
      reason: "검색 의도가 넓고 선택 기준/비교/입문 정보를 한 번에 정리해야 하는 주제입니다.",
      searchIntent: "처음 방문한 독자가 전체 기준을 빠르게 이해하고 세부 글로 이동할 수 있게 합니다.",
      bodyPlacement: "도입부에서 전체 가이드 성격을 잡고, 중후반에 세부 주제 안내 문단을 넣습니다.",
      requiredSections: [
        "전체 선택 기준을 정리하는 허브형 도입",
        "세부 리프글로 확장 가능한 하위 주제 목록",
        "방문/상담 전에 확인할 체크리스트",
        "다음에 이어서 볼 만한 관련 글 안내",
      ],
      internalLinkTargets,
    };
  }

  return {
    kind,
    reason: "검색 의도가 좁고 구체적인 문제, 제품, 상황, 비교 포인트를 깊게 설명해야 하는 주제입니다.",
    searchIntent: "이미 관심사가 좁혀진 독자에게 구체적인 판단 근거와 실행 기준을 제공합니다.",
    bodyPlacement: "도입부에서 상위 주제와의 관계를 짧게 밝히고, 본문은 구체 사례와 판단 기준에 집중합니다.",
    requiredSections: [
      "상위 허브 주제와 연결되는 짧은 도입",
      "구체 상황/문제에 대한 세부 설명",
      "실제 선택 또는 확인 기준",
      "관련 상위 글이나 다음 리프글로 이어지는 마무리",
    ],
    internalLinkTargets,
  };
}
