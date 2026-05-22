import { NextRequest, NextResponse } from "next/server";
import { regenerateSingleTopicDetailPlan } from "@/lib/agents/topic-generator";
import { fileExists, readJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { TopicIndex } from "@/lib/types/github-data";
import { normalizeUserId } from "@/lib/utils/normalize";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    topicId?: string;
    userId?: string;
    title?: string;
    primaryKeyword?: string;
    secondaryKeywords?: string[];
    seriesRole?: "prelude" | "main";
    sequenceOrder?: number;
    targetMainKeyword?: string;
  };

  const topicId = body.topicId?.trim() ?? "";
  const userId = normalizeUserId(body.userId ?? "");

  if (!topicId || !userId) {
    return NextResponse.json({ error: "topicId와 userId가 필요합니다." }, { status: 400 });
  }

  if (!(await fileExists(Paths.topicsIndex()))) {
    return NextResponse.json({ error: "글목록 파일이 없습니다." }, { status: 404 });
  }

  const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
  const topic = data.topics.find((t) => t.topicId === topicId);

  if (!topic) {
    return NextResponse.json({ error: "토픽을 찾지 못했습니다." }, { status: 404 });
  }

  const seriesRole = body.seriesRole ?? topic.seriesRole ?? "prelude";
  const sequenceOrder = body.sequenceOrder ?? topic.sequenceOrder ?? 1;
  const targetMainKeyword = body.targetMainKeyword ?? topic.targetMainKeyword ?? "";
  const title = body.title?.trim() || topic.title;
  const primaryKeyword = body.primaryKeyword?.trim() ?? "";
  const secondaryKeywords = Array.isArray(body.secondaryKeywords)
    ? body.secondaryKeywords.map((s) => s.trim()).filter(Boolean)
    : [];

  // 시리즈 내 다른 글 제목을 내부링크 후보로 사용
  const internalLinkTitles = topic.seriesId
    ? data.topics
        .filter((t) => t.seriesId === topic.seriesId && t.topicId !== topicId)
        .sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0))
        .map((t) => t.title)
    : [];

  try {
    const detailPlan = regenerateSingleTopicDetailPlan({
      seriesRole,
      title,
      primaryKeyword,
      secondaryKeywords,
      mainKeyword: targetMainKeyword,
      sequenceOrder,
      internalLinkTitles,
    });
    return NextResponse.json({ detailPlan });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "재생성 실패" },
      { status: 500 }
    );
  }
}
