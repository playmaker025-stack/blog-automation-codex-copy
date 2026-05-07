import { describe, test } from "node:test";
import assert from "node:assert/strict";

function patchTopic(topic, patch) {
  return {
    ...topic,
    ...patch,
    updatedAt: "2026-05-07T10:00:00.000Z",
  };
}

function assertSeriesPrerequisitesPublished(topic, allTopics) {
  if (!topic || topic.seriesRole !== "main" || !topic.seriesId) return { ok: true };

  const prerequisites = topic.prerequisiteTopicIds?.length
    ? allTopics.filter((candidate) => topic.prerequisiteTopicIds.includes(candidate.topicId))
    : allTopics.filter(
        (candidate) =>
          candidate.seriesId === topic.seriesId &&
          candidate.seriesRole === "prelude" &&
          (candidate.sequenceOrder ?? 0) < (topic.sequenceOrder ?? Number.MAX_SAFE_INTEGER)
      );

  const missing = prerequisites.filter((candidate) => candidate.status !== "published");
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `선행 포스팅 미발행: ${missing.map((candidate) => candidate.title).join(", ")}`,
    };
  }

  return { ok: true };
}

function normalizeTitle(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTitle(value) {
  return normalizeTitle(value).replace(/\s+/g, "");
}

function titleTokens(value) {
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function titleLooksMatched(topicTitle, postTitle) {
  const topicCompact = compactTitle(topicTitle);
  const postCompact = compactTitle(postTitle);
  if (!topicCompact || !postCompact) return false;
  if (topicCompact === postCompact) return true;

  const shorter = topicCompact.length <= postCompact.length ? topicCompact : postCompact;
  const longer = topicCompact.length > postCompact.length ? topicCompact : postCompact;
  if (shorter.length >= 10 && longer.includes(shorter)) return true;

  const topicWordSet = new Set(titleTokens(topicTitle));
  const postWords = titleTokens(postTitle);
  const shared = postWords.filter((token) => topicWordSet.has(token)).length;
  const coverage = shared / Math.min(topicWordSet.size || 1, postWords.length || 1);
  return shared >= 3 && coverage >= 0.75;
}

function resolveRemainingTopics(topics, posts) {
  const publishedPosts = posts.filter((post) => post.status === "published");
  const remaining = [];
  const matched = [];

  for (const topic of topics) {
    const found = publishedPosts.some((post) => {
      if (post.topicId && post.topicId === topic.topicId) return true;
      return titleLooksMatched(topic.title, post.title);
    });
    if (found) matched.push(topic);
    else remaining.push(topic);
  }

  return { remaining, matched };
}

function topicIsPublishedById(topic, posts) {
  return posts.some((post) => post.status === "published" && post.topicId === topic.topicId);
}

function compareTopicsForPipeline(left, right) {
  const leftSeries = left.seriesId ?? "";
  const rightSeries = right.seriesId ?? "";

  if (leftSeries && rightSeries) {
    if (leftSeries === rightSeries) {
      return (left.sequenceOrder ?? 999) - (right.sequenceOrder ?? 999);
    }
    const keywordCompare = (left.targetMainKeyword ?? leftSeries).localeCompare(
      right.targetMainKeyword ?? rightSeries,
      "ko"
    );
    if (keywordCompare !== 0) return keywordCompare;
  }

  if (leftSeries && !rightSeries) return -1;
  if (!leftSeries && rightSeries) return 1;

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function buildPipelineSelectableTopics(userScopedPlanningTopics, posts) {
  const { remaining: availableTopics } = resolveRemainingTopics(userScopedPlanningTopics, posts);
  const hiddenSeriesTopics = userScopedPlanningTopics.filter(
    (topic) =>
      topic.seriesId &&
      topic.status === "draft" &&
      !availableTopics.some((candidate) => candidate.topicId === topic.topicId) &&
      !topicIsPublishedById(topic, posts)
  );

  const merged = [...availableTopics];
  for (const topic of hiddenSeriesTopics) {
    if (!merged.some((candidate) => candidate.topicId === topic.topicId)) {
      merged.push(topic);
    }
  }

  return merged.sort(compareTopicsForPipeline);
}

describe("series workflow verification", () => {
  const seriesId = "series-user-a-mtl";
  const prelude1 = {
    topicId: "topic-pre-1",
    title: "입호흡 전자담배 보기 전에 핵심 개념부터 정리",
    status: "draft",
    assignedUserId: "a",
    seriesId,
    seriesRole: "prelude",
    targetMainKeyword: "입호흡 전자담배 추천",
    sequenceOrder: 1,
    prerequisiteTopicIds: [],
    createdAt: "2026-05-07T09:00:00.000Z",
    updatedAt: "2026-05-07T09:00:00.000Z",
  };
  const prelude2 = {
    ...prelude1,
    topicId: "topic-pre-2",
    title: "전자담배 고르기 전에 많이 보는 선택 기준",
    sequenceOrder: 2,
  };
  const prelude3 = {
    ...prelude1,
    topicId: "topic-pre-3",
    title: "초보자가 시작 전에 자주 놓치는 체크포인트",
    sequenceOrder: 3,
  };
  const main = {
    ...prelude1,
    topicId: "topic-main-1",
    title: "입호흡 전자담배 추천",
    seriesRole: "main",
    sequenceOrder: 4,
    prerequisiteTopicIds: ["topic-pre-1", "topic-pre-2", "topic-pre-3"],
  };

  test("시리즈 상세 설계 저장은 토픽에 detail plan을 남긴다", () => {
    const updated = patchTopic(main, {
      seriesDetailPlan: {
        articleGoal: "입문자 추천 정리",
        searchIntent: "추천형",
        readerQuestion: "처음 고를 때 뭘 봐야 하지?",
        primaryKeyword: "입호흡 전자담배 추천",
        secondaryKeywords: ["입문", "기기", "선택 기준"],
        recommendedSections: ["도입", "기준", "추천", "정리"],
        keywordPlacementRules: ["도입 1회", "본문 2회"],
        internalLinkTitles: ["입호흡 전자담배 보기 전에 핵심 개념부터 정리"],
        callToAction: "매장 상담 유도",
        draftAngle: "초보자 중심",
      },
      seriesDetailReadyAt: "2026-05-07T09:30:00.000Z",
    });

    assert.equal(updated.seriesDetailPlan.primaryKeyword, "입호흡 전자담배 추천");
    assert.equal(updated.seriesDetailReadyAt, "2026-05-07T09:30:00.000Z");
  });

  test("메인 글은 선행 글이 발행되기 전 전략/작성 단계로 들어갈 수 없다", () => {
    const result = assertSeriesPrerequisitesPublished(main, [prelude1, prelude2, prelude3, main]);
    assert.equal(result.ok, false);
    assert.match(result.reason, /선행 포스팅 미발행/);
  });

  test("선행 글 3개가 모두 published면 메인 글 gate가 해제된다", () => {
    const publishedTopics = [
      { ...prelude1, status: "published" },
      { ...prelude2, status: "published" },
      { ...prelude3, status: "published" },
      main,
    ];
    const result = assertSeriesPrerequisitesPublished(main, publishedTopics);
    assert.equal(result.ok, true);
  });

  test("파이프라인 목록은 제목 유사 매칭으로 숨겨진 메인 시리즈 토픽을 다시 보여준다", () => {
    const publishedPosts = [
      {
        postId: "post-legacy-1",
        topicId: "",
        userId: "a",
        title: "2025년 기준 입호흡 전자담배 추천 TOP5 인천 만수동만수르 픽",
        status: "published",
      },
    ];

    const selectable = buildPipelineSelectableTopics([prelude1, prelude2, prelude3, main], publishedPosts);
    assert.deepEqual(
      selectable.map((topic) => topic.topicId),
      ["topic-pre-1", "topic-pre-2", "topic-pre-3", "topic-main-1"]
    );
  });

  test("메인 글이 실제 topicId 기준으로 이미 발행됐다면 파이프라인 목록에 다시 넣지 않는다", () => {
    const publishedPosts = [
      {
        postId: "post-main-1",
        topicId: "topic-main-1",
        userId: "a",
        title: "입호흡 전자담배 추천",
        status: "published",
      },
    ];

    const selectable = buildPipelineSelectableTopics([prelude1, prelude2, prelude3, main], publishedPosts);
    assert.deepEqual(
      selectable.map((topic) => topic.topicId),
      ["topic-pre-1", "topic-pre-2", "topic-pre-3"]
    );
  });
});
