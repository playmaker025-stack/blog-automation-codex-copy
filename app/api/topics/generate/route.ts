import { NextRequest, NextResponse } from "next/server";
import { runPrePostingSeriesPlanner, runSeriesWorkflowPlanner, runTopicGenerator } from "@/lib/agents/topic-generator";
import { readJsonFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { PostingIndex, Topic, TopicIndex } from "@/lib/types/github-data";
import { normalizeUserId } from "@/lib/utils/normalize";

function isPlanningTopic(topic: Topic): boolean {
  return topic.source !== "direct";
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    userId?: string;
    mode?: "topics" | "preposting-series" | "series-workflow";
    mainKeyword?: string;
    targetTopic?: string;
    targetKeyword?: string;
    region?: string;
    productGroup?: string;
    targetUser?: string;
    preferredBlog?: "A" | "B" | "C" | "D" | "E" | null;
    preludeCount?: number;
  };
  const userId = body.userId?.trim();

  if (!userId) {
    return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });
  }

  const uid = normalizeUserId(userId);

  if (body.mode === "preposting-series") {
    try {
      const result = runPrePostingSeriesPlanner({
        userId: uid,
        mainKeyword: body.mainKeyword?.trim() ?? "",
        preludeCount: body.preludeCount,
      });
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "선행 포스팅 설계 실패" },
        { status: 400 }
      );
    }
  }

  if (body.mode === "series-workflow") {
    try {
      const topicsPath = Paths.topicsIndex();
      const postsPath = Paths.postingListIndex();
      const existingTopics = (await fileExists(topicsPath))
        ? (await readJsonFile<TopicIndex>(topicsPath)).data.topics
        : [];
      const existingPosts = (await fileExists(postsPath))
        ? (await readJsonFile<PostingIndex>(postsPath)).data.posts
        : [];

      const result = runSeriesWorkflowPlanner({
        userId: uid,
        targetTopic: body.targetTopic?.trim() ?? body.targetKeyword?.trim() ?? body.mainKeyword?.trim() ?? "",
        targetKeyword: body.targetKeyword?.trim() ?? body.mainKeyword?.trim() ?? "",
        region: body.region?.trim(),
        productGroup: body.productGroup?.trim(),
        targetUser: body.targetUser?.trim(),
        preferredBlog: body.preferredBlog ?? null,
        existingTopics,
        existingPosts,
      });
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "시리즈 설계 실패" },
        { status: 400 }
      );
    }
  }

  // 해당 사용자의 계획 토픽과 발행 인덱스 로드
  const path = Paths.topicsIndex();
  if (!(await fileExists(path))) {
    return NextResponse.json({ error: "글목록 파일이 없습니다." }, { status: 404 });
  }

  const { data: index } = await readJsonFile<TopicIndex>(path);
  const userTopics = index.topics.filter(
    (t) => isPlanningTopic(t) && normalizeUserId(t.assignedUserId ?? "") === uid
  );

  const postsIndex = (await fileExists(Paths.postingListIndex()))
    ? (await readJsonFile<PostingIndex>(Paths.postingListIndex())).data
    : { posts: [], lastUpdated: "" };
  const userPublishedPosts = postsIndex.posts.filter(
    (post) => post.status === "published" && normalizeUserId(post.userId) === uid
  );
  if (userTopics.length === 0 && userPublishedPosts.length === 0) {
    return NextResponse.json({ error: "해당 사용자의 글목록이나 발행 인덱스가 없습니다." }, { status: 404 });
  }
  try {
    const result = await runTopicGenerator({
      userId: uid,
      publishedTopics: userTopics.filter((topic) => topic.status === "published"),
      publishedPosts: userPublishedPosts,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "토픽 생성 실패" },
      { status: 500 }
    );
  }
}
