import type { PostingRecord, Topic } from "@/lib/types/github-data";
import type {
  ArticleRole,
  ConclusionPattern,
  ContentNodeType,
  ExistingArticleSummary,
  IntroPattern,
  OverlapReport,
} from "./types";

const PROBLEM_SOLUTION_PATTERN =
  /(원인|왜|누수|탄맛|고장|안됨|액튐|결로|교체주기|인식 안됨|체크팟|노아토마이저|No Atomizer|No Pod|팟 인식|빨리 닳|맛이 약|맛이 탁|새는)/iu;
const REVIEW_PATTERN = /(후기|리뷰|실사용|솔직후기|사용감|직접 써본)/iu;
const COMPARISON_PATTERN = /(차이|비교|vs|VS|어떤 게 나을까|뭐가 더 나을까)/iu;
const MAIN_RECOMMENDATION_PATTERN = /(추천|best|BEST|top|TOP|처음 고를 때|입문자 추천)/iu;
const POLICY_PATTERN = /(지원금|사용처|결제|가능|정책|가맹점)/iu;
const PURCHASE_PATTERN = /(추천|입문|방문|매장|결제|상담|사용처)/iu;
const RECENT_PATTERN = /(요즘|최근|문의|많이 묻|자주 묻)/iu;

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function tokenOverlapRatio(a: string, b: string): number {
  const aTokens = new Set(toTokens(a));
  const bTokens = toTokens(b);
  if (aTokens.size === 0 || bTokens.length === 0) return 0;
  const overlap = bTokens.filter((token) => aTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, bTokens.length);
}

function maxRisk(
  left: OverlapReport["riskLevel"],
  right: OverlapReport["riskLevel"]
): OverlapReport["riskLevel"] {
  const score = { low: 1, medium: 2, high: 3 } as const;
  return score[left] >= score[right] ? left : right;
}

function inferArticleRoleFromText(text: string, seriesRole?: "prelude" | "main"): ArticleRole {
  if (seriesRole === "prelude") return "prelude";
  if (PROBLEM_SOLUTION_PATTERN.test(text)) return "problem_solution";
  if (REVIEW_PATTERN.test(text)) return "review";
  if (COMPARISON_PATTERN.test(text)) return "comparison";
  if (seriesRole === "main" || MAIN_RECOMMENDATION_PATTERN.test(text)) return "main_recommendation";
  return "general";
}

function inferNodeTypeFromTopic(topic: Topic | null, articleRole: ArticleRole): ContentNodeType {
  if (articleRole === "prelude") return "bridge";
  if (topic?.contentKind === "hub" || topic?.contentKind === "leaf") return topic.contentKind;
  if (articleRole === "main_recommendation" || articleRole === "product_list_recommendation") return "hub";
  return "leaf";
}

function inferIntroPatternFromText(
  text: string,
  articleRole: ArticleRole,
  nodeType: ContentNodeType
): IntroPattern {
  if (articleRole === "problem_solution") return "problem_symptom";
  if (articleRole === "review") return "product_experience";
  if (articleRole === "prelude" && POLICY_PATTERN.test(text)) return "policy_confusion";
  if (RECENT_PATTERN.test(text)) return "recent_inquiry";
  if (nodeType === "bridge" || PURCHASE_PATTERN.test(text)) return "purchase_before_visit";
  return "customer_question";
}

function inferConclusionPatternFromRole(
  articleRole: ArticleRole,
  nodeType: ContentNodeType
): ConclusionPattern {
  if (articleRole === "prelude" || nodeType === "bridge") return "handoff_next_article";
  if (articleRole === "problem_solution") return "problem_checklist";
  if (articleRole === "review") return "product_fit_summary";
  if (articleRole === "comparison") return "criteria_summary";
  if (articleRole === "main_recommendation" || articleRole === "product_list_recommendation") return "visit_consultation";
  return "criteria_summary";
}

function inferCtaModeFromRole(articleRole: ArticleRole, nodeType: ContentNodeType): string {
  if (articleRole === "prelude" || nodeType === "bridge") {
    return "현재 글 확인 기준을 정리한 뒤 다음 메인 글로 자연스럽게 handoff";
  }
  if (articleRole === "problem_solution") {
    return "점검 후 교체나 상담이 필요한지 판단하도록 마무리";
  }
  if (articleRole === "review") {
    return "체감과 아쉬운 점을 정리한 뒤 본인 취향에 맞는지 판단하도록 마무리";
  }
  if (articleRole === "comparison") {
    return "상황별 선택 기준을 정리한 뒤 본인 사용 방식에 맞는 쪽을 고르도록 마무리";
  }
  if (articleRole === "main_recommendation" || articleRole === "product_list_recommendation") {
    return "추천 기준과 사용자 유형을 정리한 뒤 방문 전 상담으로 연결";
  }
  return "현재 글 기준을 정리한 뒤 방문 전 상담이나 선택 판단으로 연결";
}

function resolveExistingNodeType(article: ExistingArticleSummary): ContentNodeType {
  if (article.nodeType === "hub" || article.nodeType === "leaf" || article.nodeType === "bridge") {
    return article.nodeType;
  }
  if (article.articleRole === "prelude") return "bridge";
  if (article.articleRole === "main_recommendation" || article.articleRole === "product_list_recommendation") return "hub";
  return "leaf";
}

export function buildExistingArticleSummaries(params: {
  posts: PostingRecord[];
  topics: Topic[];
  userId: string;
}): ExistingArticleSummary[] {
  const targetUserId = params.userId.trim().toLowerCase();
  const topicById = new Map(params.topics.map((topic) => [topic.topicId, topic]));

  return params.posts
    .filter((post) => post.status === "published")
    .filter((post) => post.userId.trim().toLowerCase() === targetUserId)
    .map((post) => {
      const topic = post.topicId ? topicById.get(post.topicId) ?? null : null;
      const roleSource = [post.title, topic?.title ?? "", topic?.description ?? "", topic?.targetMainKeyword ?? ""]
        .filter(Boolean)
        .join(" ");
      const articleRole = inferArticleRoleFromText(roleSource, topic?.seriesRole);
      const nodeType = inferNodeTypeFromTopic(topic, articleRole);
      const targetKeyword = topic?.targetMainKeyword?.trim() || topic?.title?.trim() || post.title.trim();
      const searchIntent =
        topic?.seriesDetailPlan?.searchIntent?.trim() ||
        topic?.description?.trim() ||
        topic?.title?.trim() ||
        post.title.trim();
      const internalLinkTargets = topic?.seriesDetailPlan?.internalLinkTitles ?? [];
      const introPattern = inferIntroPatternFromText(roleSource, articleRole, nodeType);
      const conclusionPattern = inferConclusionPatternFromRole(articleRole, nodeType);
      const ctaMode = inferCtaModeFromRole(articleRole, nodeType);

      return {
        title: post.title,
        normalizedTitle: normalizeText(post.title),
        userId: targetUserId,
        articleRole,
        nodeType,
        targetKeyword,
        normalizedTargetKeyword: normalizeText(targetKeyword),
        searchIntent,
        normalizedSearchIntent: normalizeText(searchIntent),
        internalLinkTargets,
        introPattern,
        conclusionPattern,
        ctaMode,
        topicId: topic?.topicId ?? null,
        postId: post.postId,
      };
    });
}

export function buildOverlapReport(params: {
  currentTitle: string;
  articleRole: ArticleRole;
  nodeType?: ContentNodeType;
  introPattern?: IntroPattern;
  conclusionPattern?: ConclusionPattern;
  ctaMode?: string;
  targetKeyword: string;
  searchIntent: string;
  handoffKeyword?: string | null;
  internalLinkTargets?: string[];
  existingArticles: ExistingArticleSummary[];
}): OverlapReport {
  const normalizedTitle = normalizeText(params.currentTitle);
  const normalizedTargetKeyword = normalizeText(params.targetKeyword);
  const normalizedSearchIntent = normalizeText(params.searchIntent);
  const normalizedHandoffKeyword = normalizeText(params.handoffKeyword ?? "");
  const currentInternalTargets = params.internalLinkTargets ?? [];
  const currentNodeType = params.nodeType ?? "leaf";
  const currentIntroPattern = params.introPattern ?? null;
  const currentConclusionPattern = params.conclusionPattern ?? null;
  const currentCtaMode = params.ctaMode?.trim() ?? "";

  const exactTitleMatches = params.existingArticles.filter(
    (article) => article.normalizedTitle && article.normalizedTitle === normalizedTitle
  );
  const sameKeywordAndRole = params.existingArticles.filter(
    (article) =>
      article.articleRole === params.articleRole &&
      article.normalizedTargetKeyword &&
      article.normalizedTargetKeyword === normalizedTargetKeyword
  );
  const sameIntentAndRole = params.existingArticles.filter(
    (article) =>
      article.articleRole === params.articleRole &&
      article.normalizedSearchIntent &&
      article.normalizedSearchIntent === normalizedSearchIntent
  );

  const titleOverlapMatches = params.existingArticles.filter((article) => {
    if (exactTitleMatches.includes(article)) return false;
    return tokenOverlapRatio(params.currentTitle, article.title) >= 0.6;
  });
  const sameRoleIntroMatches = currentIntroPattern
    ? params.existingArticles.filter(
        (article) => article.articleRole === params.articleRole && article.introPattern === currentIntroPattern
      )
    : [];
  const sameRoleConclusionMatches = currentConclusionPattern
    ? params.existingArticles.filter(
        (article) =>
          article.articleRole === params.articleRole && article.conclusionPattern === currentConclusionPattern
      )
    : [];
  const repeatedInternalLinkArticles = params.existingArticles.filter((article) =>
    article.internalLinkTargets.some((target) => currentInternalTargets.includes(target))
  );
  const repeatedCtaArticles = currentCtaMode
    ? params.existingArticles.filter((article) => article.ctaMode === currentCtaMode)
    : [];

  const existingHubMatches = params.existingArticles.filter((article) => {
    if (resolveExistingNodeType(article) !== "hub") return false;
    return (
      tokenOverlapRatio(params.currentTitle, article.title) >= 0.4 ||
      tokenOverlapRatio(params.targetKeyword, article.targetKeyword) >= 0.4
    );
  });
  const sameRoleSameHubMatches = existingHubMatches.filter((article) => article.articleRole === params.articleRole);
  const leafHubCandidates =
    currentNodeType === "leaf"
      ? params.existingArticles.filter(
          (article) =>
            resolveExistingNodeType(article) === "hub" &&
            (tokenOverlapRatio(params.currentTitle, article.title) >= 0.35 ||
              tokenOverlapRatio(params.targetKeyword, article.targetKeyword) >= 0.35 ||
              params.articleRole === "problem_solution" ||
              (article.articleRole === "main_recommendation" || article.articleRole === "product_list_recommendation"))
        )
      : [];
  const preludeMainConflicts =
    params.articleRole === "prelude"
      ? params.existingArticles.filter(
          (article) =>
            (article.articleRole === "main_recommendation" || article.articleRole === "product_list_recommendation") &&
            normalizedHandoffKeyword &&
            (article.normalizedTargetKeyword === normalizedHandoffKeyword ||
              tokenOverlapRatio(params.handoffKeyword ?? "", article.targetKeyword) >= 0.5)
        )
      : [];

  const repeatedInternalLinkTargets = repeatedInternalLinkArticles.flatMap((article) =>
    article.internalLinkTargets.filter((target) => currentInternalTargets.includes(target))
  );
  const repeatedCtaModes = repeatedCtaArticles.map((article) => article.ctaMode ?? "").filter(Boolean);

  let riskLevel: OverlapReport["riskLevel"] = "low";
  if (exactTitleMatches.length || sameKeywordAndRole.length || sameIntentAndRole.length) {
    riskLevel = "high";
  } else {
    if (titleOverlapMatches.length || preludeMainConflicts.length || sameRoleSameHubMatches.length) {
      riskLevel = "medium";
    }
    if (currentNodeType === "hub" && existingHubMatches.length >= 2) {
      riskLevel = maxRisk(riskLevel, "high");
    }
    if (sameRoleIntroMatches.length && sameRoleConclusionMatches.length) {
      riskLevel = maxRisk(riskLevel, "medium");
    } else if ((sameRoleIntroMatches.length || sameRoleConclusionMatches.length) && riskLevel === "low") {
      riskLevel = "medium";
    }
  }

  const similarTitles = uniq([
    ...exactTitleMatches.map((article) => article.title),
    ...titleOverlapMatches.map((article) => article.title),
    ...sameRoleSameHubMatches.map((article) => article.title),
    ...preludeMainConflicts.map((article) => article.title),
  ]);
  const similarIntents = uniq([
    ...sameIntentAndRole.map((article) => article.searchIntent),
    ...sameKeywordAndRole.map((article) => article.searchIntent),
    ...sameRoleIntroMatches.map((article) => article.searchIntent),
  ]);

  const roleConflicts = uniq([
    ...sameKeywordAndRole.map(
      (article) => `같은 articleRole(${article.articleRole})과 같은 targetKeyword가 기존 글 "${article.title}"에 이미 있습니다.`
    ),
    ...sameIntentAndRole.map(
      (article) => `같은 articleRole(${article.articleRole})과 같은 검색의도가 기존 글 "${article.title}"와 겹칩니다.`
    ),
    ...sameRoleSameHubMatches.map(
        (article) => `같은 ${article.articleRole} 허브 방향이 기존 글 "${article.title}"와 겹칩니다.`
    ),
    ...preludeMainConflicts.map(
      (article) => `prelude/bridge 글이 기존 main_recommendation "${article.title}"의 추천 범위를 과소비할 위험이 있습니다.`
    ),
    ...(repeatedInternalLinkTargets.length
      ? [`같은 내부링크 대상이 반복됩니다: ${uniq(repeatedInternalLinkTargets).join(", ")}`]
      : []),
    ...(repeatedCtaModes.length ? [`같은 CTA 흐름이 반복됩니다: ${uniq(repeatedCtaModes).join(", ")}`] : []),
  ]);

  let recommendedRewriteDirection = "현재 방향으로 진행하되 기존 글과 제목, 도입, 결론, CTA를 반복하지 마세요.";
  if (exactTitleMatches.length) {
    recommendedRewriteDirection =
      "기존 글과 제목이 동일합니다. 제목 방향이나 검색의도를 바꾸거나 기존 글을 업데이트하는 쪽으로 재설계하세요.";
  } else if (sameKeywordAndRole.length) {
    recommendedRewriteDirection =
      "같은 targetKeyword와 같은 articleRole이 이미 있습니다. 다른 하위 의도, 사용자 상황, 카테고리 축으로 분리하세요.";
  } else if (sameIntentAndRole.length) {
    recommendedRewriteDirection =
      "같은 검색의도와 같은 articleRole이 겹칩니다. 제목 방향, 해결 범위, CTA 흐름을 분리하세요.";
  } else if ((params.articleRole === "main_recommendation" || params.articleRole === "product_list_recommendation") && existingHubMatches.length) {
    recommendedRewriteDirection = /액상/u.test(`${params.currentTitle} ${params.targetKeyword}`)
      ? "기존 main_recommendation과 겹치므로 액상 취향, 기기 궁합, 사용자 유형, 문제 상황처럼 더 좁은 기준으로 분리하세요."
      : "기존 main_recommendation과 겹치므로 취향, 기기 궁합, 사용자 유형, 문제 상황처럼 더 좁은 기준으로 분리하세요.";
  } else if (params.articleRole === "review" && titleOverlapMatches.length) {
    recommendedRewriteDirection =
      "기존 review와 겹치므로 체감 반복 대신 문제 해결, 비교, 대상 사용자 분리 방향으로 재설계하세요.";
  } else if (params.articleRole === "problem_solution" && titleOverlapMatches.length) {
    recommendedRewriteDirection =
      "기존 problem_solution과 겹치므로 원인 범위, 점검 순서, 해결 단계가 겹치지 않게 다시 설계하세요.";
  } else if (preludeMainConflicts.length) {
    recommendedRewriteDirection =
      "이번 글은 브릿지 역할(bridge)만 수행하고, 추천 기기 깊은 설명은 handoffKeyword 대상 글에 남겨두세요.";
  } else if (currentNodeType === "leaf" && leafHubCandidates.length) {
    recommendedRewriteDirection =
      "현재 글은 leaf로 유지하고, 기존 hub와 연결되는 문제 해결/세부 판단 기준만 담당하도록 범위를 좁히세요.";
  } else if (sameRoleIntroMatches.length && sameRoleConclusionMatches.length) {
    recommendedRewriteDirection =
      "같은 역할의 도입 패턴과 결론 패턴이 함께 반복됩니다. 질문 시작 방식과 CTA 종료 방식을 모두 바꾸세요.";
  } else if (sameRoleIntroMatches.length) {
    recommendedRewriteDirection =
      "같은 역할의 도입 패턴이 반복되므로 질문 시작 방식이나 상황 제시 각도를 바꾸세요.";
  } else if (sameRoleConclusionMatches.length || repeatedCtaModes.length) {
    recommendedRewriteDirection =
      "결론 패턴이나 CTA 흐름이 반복되므로 방문 상담, 기준 정리, handoff 중 다른 마무리 방식으로 바꾸세요.";
  } else if (repeatedInternalLinkTargets.length) {
    recommendedRewriteDirection =
      "같은 내부링크 대상으로만 반복 연결하지 말고, 글의 역할에 맞는 다른 허브/리프 연결축을 선택하세요.";
  }

  return {
    riskLevel,
    similarTitles,
    similarIntents,
    repeatedIntroPatterns: uniq(sameRoleIntroMatches.map((article) => article.introPattern ?? "").filter(Boolean)),
    repeatedConclusionPatterns: uniq(
      sameRoleConclusionMatches.map((article) => article.conclusionPattern ?? "").filter(Boolean)
    ),
    repeatedInternalLinkTargets: uniq(repeatedInternalLinkTargets),
    repeatedCtaModes: uniq(repeatedCtaModes),
    roleConflicts,
    recommendedRewriteDirection,
  };
}

export function formatOverlapReport(report: OverlapReport | undefined): string {
  if (!report) {
    return [
      "Overlap report: unavailable.",
      "Avoid repeating the same title direction, intro pattern, conclusion pattern, or CTA from earlier posts.",
    ].join("\n");
  }

  return [
    "Overlap report:",
    `- Risk level: ${report.riskLevel}`,
    `- Similar titles: ${report.similarTitles.join(" / ") || "none"}`,
    `- Similar intents: ${report.similarIntents.join(" / ") || "none"}`,
    `- Repeated intro patterns: ${report.repeatedIntroPatterns.join(" / ") || "none"}`,
    `- Repeated conclusion patterns: ${report.repeatedConclusionPatterns.join(" / ") || "none"}`,
    `- Repeated internal link targets: ${report.repeatedInternalLinkTargets.join(" / ") || "none"}`,
    `- Repeated CTA modes: ${report.repeatedCtaModes.join(" / ") || "none"}`,
    `- Role conflicts: ${report.roleConflicts.join(" / ") || "none"}`,
    `- Recommended rewrite direction: ${report.recommendedRewriteDirection}`,
  ].join("\n");
}
