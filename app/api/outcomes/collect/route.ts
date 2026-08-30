/**
 * /api/outcomes/collect — 관측할 때가 된 글들의 순위를 한 바퀴 확인한다.
 *
 * POST 한 바퀴 지금 돌린다. body: { maxQueries?: number, userId?: string }
 * GET  자동 수집기 상태와 남은 양. 눌러보지 않고 진행을 확인하는 용도.
 *
 * 요청 하나가 외부로 검색을 여러 번 날린다. maxQueries로 한 실행을 묶는다.
 */

import { NextResponse } from "next/server";
import { readJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { PostingIndex } from "@/lib/types/github-data";
import { normalizeUserId } from "@/lib/utils/normalize";
import { collectDueOutcomes } from "@/lib/agents/serp-collector";
import { dueCheckpointFromAges } from "@/lib/agents/post-outcome";
import { ensureOutcomeIndex } from "@/lib/agents/post-outcome-store";
import { getCollectorState } from "@/lib/agents/outcome-scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const [{ data: index }, outcomeIndex] = await Promise.all([
      readJsonFile<PostingIndex>(Paths.postingListIndex()),
      ensureOutcomeIndex(),
    ]);

    const now = new Date().toISOString();
    const tracked = index.posts.filter(
      (post) => post.status === "published" && post.outcomeTracking && post.publishedAt
    );

    let measured = 0;
    let due = 0;
    for (const post of tracked) {
      const okAgeHours = outcomeIndex.posts[post.postId]?.okAgeHours ?? [];
      if (okAgeHours.length > 0) measured += 1;
      if (dueCheckpointFromAges({ publishedAt: post.publishedAt, now, okAgeHours }) !== null) {
        due += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      collector: getCollectorState(),
      progress: { tracked: tracked.length, measured, due },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    maxQueries?: number;
    userId?: string;
  };

  try {
    const { data: index } = await readJsonFile<PostingIndex>(Paths.postingListIndex());
    const posts = body.userId
      ? index.posts.filter((post) => normalizeUserId(post.userId) === normalizeUserId(body.userId!))
      : index.posts;

    const result = await collectDueOutcomes({
      posts,
      maxQueries: Math.min(Math.max(body.maxQueries ?? 8, 1), 20),
    });

    const failures = result.collected.filter((item) => item.status !== "ok").length;
    return NextResponse.json({
      ok: true,
      ...result,
      failures,
      // 연속 실패는 화면 구조가 바뀌었다는 신호다. 조용히 넘어가면 안 된다.
      warning:
        result.collected.length > 0 && failures === result.collected.length
          ? "모든 관측이 실패했습니다. 검색 화면 구조가 바뀌었을 수 있습니다."
          : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
