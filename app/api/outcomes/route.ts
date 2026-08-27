/**
 * /api/outcomes — 발행 결과 관측치 기록·조회
 *
 * POST  관측치 하나를 남긴다 (수집기 / 북마클릿 / 사람이 직접)
 * GET   ?postId=... 그 글의 성과 요약
 *
 * 인증은 두지 않는다 — 멤버 전원이 고칠 수 있어야 한다는 사장님 결정.
 * 대신 status를 반드시 받는다. 실패를 성공으로 저장하면 학습이 오염된다.
 */

import { NextResponse } from "next/server";
import { loadObservations, loadOutcomeSummary, recordObservation } from "@/lib/agents/post-outcome-store";
import {
  SCHEMA_VERSION,
  buildObservationId,
  hoursSince,
  type PostOutcomeObservation,
} from "@/lib/agents/post-outcome";

export const dynamic = "force-dynamic";

interface Body {
  postId?: string;
  source?: PostOutcomeObservation["source"];
  status?: PostOutcomeObservation["status"];
  publishedAt?: string | null;
  collector?: PostOutcomeObservation["collector"];
  serp?: PostOutcomeObservation["serp"];
  stats?: PostOutcomeObservation["stats"];
  note?: string;
}

const VALID_STATUS = new Set(["ok", "not_found", "request_failed", "parse_failed"]);
const VALID_SOURCE = new Set(["serp", "naver_stats"]);

export async function GET(request: Request) {
  const postId = new URL(request.url).searchParams.get("postId");
  if (!postId) {
    return NextResponse.json({ ok: false, error: "postId가 필요합니다." }, { status: 400 });
  }

  try {
    const [summary, observations] = await Promise.all([
      loadOutcomeSummary(postId),
      loadObservations(postId),
    ]);
    return NextResponse.json({ ok: true, postId, summary, observations });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  if (!body.postId) {
    return NextResponse.json({ ok: false, error: "postId가 필요합니다." }, { status: 400 });
  }
  if (!body.source || !VALID_SOURCE.has(body.source)) {
    return NextResponse.json({ ok: false, error: "source는 serp 또는 naver_stats." }, { status: 400 });
  }
  // 상태를 빼먹으면 실패가 성공으로 저장된다. 기본값을 두지 않는다.
  if (!body.status || !VALID_STATUS.has(body.status)) {
    return NextResponse.json(
      { ok: false, error: "status는 ok / not_found / request_failed / parse_failed 중 하나여야 합니다." },
      { status: 400 }
    );
  }

  const capturedAt = new Date().toISOString();
  const observation: PostOutcomeObservation = {
    schemaVersion: SCHEMA_VERSION,
    observationId: buildObservationId({
      postId: body.postId,
      source: body.source,
      capturedAt,
      query: body.serp?.query,
    }),
    postId: body.postId,
    source: body.source,
    capturedAt,
    postAgeHours: hoursSince(body.publishedAt ?? null, capturedAt),
    status: body.status,
    collector: body.collector ?? { method: "manual", version: "1" },
    ...(body.serp ? { serp: body.serp } : {}),
    ...(body.stats ? { stats: body.stats } : {}),
    ...(body.note ? { note: body.note } : {}),
  };

  try {
    const { written, path } = await recordObservation(observation);
    return NextResponse.json({
      ok: true,
      written,
      path,
      observationId: observation.observationId,
      summary: await loadOutcomeSummary(body.postId),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
