import { NextResponse } from "next/server";
import { syncMissingPublishedToCorpus } from "@/lib/agents/user-learning";

const ALL_USER_IDS = ["a", "b", "c", "d", "e"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { userId?: string; limit?: number };
  const limit = typeof body.limit === "number" ? body.limit : 15;
  const targets = body.userId ? [body.userId] : ALL_USER_IDS;

  const results: Record<string, { synced: number; skipped: number; failed: number; error?: string }> = {};

  for (const userId of targets) {
    results[userId] = await syncMissingPublishedToCorpus(userId, limit).catch((err: unknown) => ({
      synced: 0,
      skipped: 0,
      failed: 0,
      error: err instanceof Error ? err.message : String(err),
    }));
  }

  const totalSynced = Object.values(results).reduce((sum, r) => sum + r.synced, 0);
  return NextResponse.json({ results, totalSynced });
}
