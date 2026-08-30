/**
 * POST /api/outcomes/backfill — 이미 발행된 글에 추적 계약을 붙인다.
 *
 * 수집기는 추적 계약(주소 + 타깃 검색어)이 있는 글만 잰다. 계약은 어제부터
 * 발행하는 글에만 붙으므로, 소급하지 않으면 데이터가 쌓이는 데 몇 주가 걸린다.
 *
 * 소급분의 한계는 계약에 backfilled로 남긴다:
 * - 발행 당시 본문을 모른다 → 이후 수정 여부를 판단할 수 없다
 * - 지나간 관측 시점(발행 직후·7일·14일)은 영영 못 잰다. 지금부터만 잰다
 *
 * 발행 목록은 파일 하나를 통째로 읽고 쓰므로 한 번에 모아서 저장한다.
 * 글마다 저장하면 서로 덮어쓴다.
 */

import { NextResponse } from "next/server";
import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { PostingIndex, PostingRecord, TopicIndex } from "@/lib/types/github-data";
import { normalizeUserId } from "@/lib/utils/normalize";
import { buildOutcomeTracking, type TargetKeyword } from "@/lib/agents/post-outcome";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function keywordsFor(post: PostingRecord, topics: Map<string, string>): TargetKeyword[] {
  const fromTopic = topics.get(post.topicId)?.trim();
  // 제목 앞부분은 어디까지나 추측이다. 이 앱의 작성 규칙이 핵심 키워드를 제목
  // 앞에 두는 것이라 맞는 경우도 많지만, "전자담배 액상이 입"처럼 문장 조각이
  // 되는 경우가 더 많았다. 그래서 반드시 title_guess로 표시해서 남긴다 —
  // 이 검색어의 "미노출"은 글의 실패가 아니라 검색어의 실패일 수 있다.
  const fromTitle = post.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  const keywords: TargetKeyword[] = [];
  if (fromTopic) keywords.push({ query: fromTopic, role: "primary", source: "topic" });
  if (fromTitle) keywords.push({ query: fromTitle, role: "primary", source: "title_guess" });
  return keywords;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    userId?: string;
    limit?: number;
    dryRun?: boolean;
  };

  try {
    const { data: index, sha } = await readJsonFile<PostingIndex>(Paths.postingListIndex());

    const topics = new Map<string, string>();
    if (await fileExists(Paths.topicsIndex())) {
      const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
      for (const topic of data.topics) {
        if (topic.targetKeyword) topics.set(topic.topicId, topic.targetKeyword);
      }
    }

    const limit = Math.min(Math.max(body.limit ?? 500, 1), 1000);
    const now = new Date().toISOString();

    let attached = 0;
    let skippedNoUrl = 0;
    let alreadyHad = 0;
    const samples: Array<{ postId: string; queries: string[] }> = [];

    const posts = index.posts.map((post) => {
      if (body.userId && normalizeUserId(post.userId) !== normalizeUserId(body.userId)) return post;
      if (post.status !== "published") return post;
      if (post.outcomeTracking) {
        alreadyHad += 1;
        return post;
      }
      if (attached >= limit) return post;

      const tracking = buildOutcomeTracking({
        naverPostUrl: post.naverPostUrl,
        title: post.title,
        // 발행 당시 본문을 모른다. 빈 값이 곧 "수정 여부 판단 불가"를 뜻한다.
        content: "",
        targetKeywords: keywordsFor(post, topics),
        at: now,
        backfilled: true,
      });

      if (!tracking) {
        skippedNoUrl += 1;
        return post;
      }

      attached += 1;
      if (samples.length < 5) {
        samples.push({ postId: post.postId, queries: tracking.targetKeywords.map((k) => k.query) });
      }
      return { ...post, outcomeTracking: tracking, updatedAt: now };
    });

    if (!body.dryRun && attached > 0) {
      await writeJsonFile<PostingIndex>(
        Paths.postingListIndex(),
        { ...index, posts, lastUpdated: now },
        `chore(outcome): 발행 글 ${attached}건에 추적 계약 소급 적용`,
        sha
      );
    }

    return NextResponse.json({
      ok: true,
      dryRun: body.dryRun === true,
      attached,
      alreadyHad,
      skippedNoUrl,
      total: index.posts.length,
      samples,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
