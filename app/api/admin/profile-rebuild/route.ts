/**
 * /api/admin/profile-rebuild — 문체 프로필 재학습
 *
 * GET  현재 학습 상태 (사용자별 발췌 오염 여부, 지문 유무, 갱신일)
 * POST 재학습 실행 { userId? } — 없으면 전원
 *
 * 왜 별도 경로인가: 프로필은 발행할 때만 갱신된다. 발행이 뜸한 사용자는 학습이
 * 멈추고, 이미 저장된 발췌가 네이버 UI로 오염돼 있어도 고칠 방법이 없었다.
 */

import { NextResponse } from "next/server";
import { getProfileHealth, rebuildUserProfile } from "@/lib/agents/user-learning";
import { requireAdmin } from "@/lib/auth/admin-guard";

const ALL_USER_IDS = ["a", "b", "c", "d", "e"];

export const dynamic = "force-dynamic";

async function healthForAll() {
  return Promise.all(ALL_USER_IDS.map((userId) => getProfileHealth(userId)));
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, health: await healthForAll() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  const targets = body.userId ? [body.userId] : ALL_USER_IDS;

  // 한 사용자가 실패해도 나머지는 진행한다 — 전부 막히는 게 더 나쁘다.
  const results: Array<Record<string, unknown>> = [];
  for (const userId of targets) {
    try {
      results.push({ ...(await rebuildUserProfile(userId)) });
    } catch (error) {
      results.push({
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    return NextResponse.json({ ok: true, results, health: await healthForAll() });
  } catch {
    return NextResponse.json({ ok: true, results, health: [] });
  }
}
