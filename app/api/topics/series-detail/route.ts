import { NextRequest, NextResponse } from "next/server";
import { runSeriesDetailPlanner } from "@/lib/agents/topic-generator";
import { fileExists, readJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { TopicIndex } from "@/lib/types/github-data";
import { normalizeUserId } from "@/lib/utils/normalize";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    userId?: string;
    mainKeyword?: string;
    seriesId?: string;
    topicIds?: string[];
  };
  const userId = normalizeUserId(body.userId ?? "");
  const mainKeyword = body.mainKeyword?.trim().replace(/\s+/g, " ") ?? "";

  if (!userId || !mainKeyword) {
    return NextResponse.json({ error: "userId와 mainKeyword가 필요합니다." }, { status: 400 });
  }

  if (!(await fileExists(Paths.topicsIndex()))) {
    return NextResponse.json({ error: "글목록 파일이 없습니다." }, { status: 404 });
  }

  const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
  const requestedTopicIds = Array.isArray(body.topicIds)
    ? body.topicIds.map((topicId) => topicId.trim()).filter(Boolean)
    : [];

  if (requestedTopicIds.length > 0) {
    const exactTopics = data.topics
      .filter(
        (topic) =>
          requestedTopicIds.includes(topic.topicId) &&
          normalizeUserId(topic.assignedUserId ?? "") === userId
      )
      .sort((left, right) => (left.sequenceOrder ?? 0) - (right.sequenceOrder ?? 0));

    if (exactTopics.length === 0) {
      return NextResponse.json({ error: "시리즈 토픽을 찾지 못했습니다." }, { status: 404 });
    }

    try {
      const result = runSeriesDetailPlanner({
        userId,
        mainKeyword,
        seriesTopics: exactTopics,
      });
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "시리즈 상세 설계 실패" },
        { status: 500 }
      );
    }
  }

  const userSeriesTopics = data.topics
    .filter(
      (topic) =>
        normalizeUserId(topic.assignedUserId ?? "") === userId &&
        topic.seriesId &&
        topic.targetMainKeyword?.trim() === mainKeyword
    )
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  if (userSeriesTopics.length === 0) {
    return NextResponse.json({ error: "해당 메인 키워드의 시리즈 토픽을 찾지 못했습니다." }, { status: 404 });
  }

  const targetSeriesId = body.seriesId?.trim() || userSeriesTopics[0].seriesId;
  const seriesTopics = userSeriesTopics
    .filter((topic) => topic.seriesId === targetSeriesId)
    .sort((left, right) => (left.sequenceOrder ?? 0) - (right.sequenceOrder ?? 0));

  if (seriesTopics.length === 0) {
    return NextResponse.json({ error: "시리즈 토픽이 비어 있습니다." }, { status: 404 });
  }

  try {
    const result = runSeriesDetailPlanner({
      userId,
      mainKeyword,
      seriesTopics,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "시리즈 상세 설계 실패" },
      { status: 500 }
    );
  }
}
