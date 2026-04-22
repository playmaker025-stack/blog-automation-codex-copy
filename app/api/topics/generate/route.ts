import { NextRequest, NextResponse } from "next/server";
import { runTopicGenerator } from "@/lib/agents/topic-generator";
import { readJsonFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { resolveRemainingTopics } from "@/lib/skills/remaining-topic-resolver";
import type { PostingIndex, Topic, TopicIndex } from "@/lib/types/github-data";
import { normalizeUserId } from "@/lib/utils/normalize";

function isPlanningTopic(topic: Topic): boolean {
  return topic.source !== "direct";
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { userId?: string };
  const userId = body.userId?.trim();

  if (!userId) {
    return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });
  }

  // 해당 사용자의 계획 토픽과 발행 인덱스 로드
  const path = Paths.topicsIndex();
  if (!(await fileExists(path))) {
    return NextResponse.json({ error: "글목록 파일이 없습니다." }, { status: 404 });
  }

  const { data: index } = await readJsonFile<TopicIndex>(path);
  const uid = normalizeUserId(userId);
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
  const remaining = resolveRemainingTopics(userTopics, userPublishedPosts).remaining;
  if (remaining.length > 0) {
    return NextResponse.json(
      { error: `아직 남은 계획 글목록이 ${remaining.length}개 있습니다. 모두 발행 완료된 뒤 다음 5개를 생성합니다.` },
      { status: 409 }
    );
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
