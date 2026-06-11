import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { normalizeUserId } from "@/lib/utils/normalize";
import type { StrategyPlanResult, NaverLogicEvaluation, SeoEvaluation, FinalDraftCheck } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

interface SavedDraftResult {
  postId?: string;
  title: string;
  wordCount?: number;
  evalScore?: number;
  pass?: boolean;
  recommendations?: string[];
  hashtags?: string[];
  imageFileNames?: string[];
  seoEvaluation?: SeoEvaluation;
  naverLogicEvaluation?: NaverLogicEvaluation;
  finalDraftCheck?: FinalDraftCheck;
}

export interface DraftSessionRecord {
  sessionId: string;
  userId: string;
  topicId: string;
  topicTitle: string;
  pipelineId?: string;
  strategy?: StrategyPlanResult;
  streamingBody: string;
  result: SavedDraftResult;
  status: "draft_generated";
  createdAt: string;
  updatedAt: string;
}

interface DraftSessionIndex {
  userId: string;
  sessions: DraftSessionRecord[];
  updatedAt: string;
}

async function readIndex(userId: string): Promise<{ data: DraftSessionIndex; sha: string | null }> {
  const path = Paths.draftSessions(userId);
  if (!(await fileExists(path))) {
    return {
      data: { userId, sessions: [], updatedAt: new Date().toISOString() },
      sha: null,
    };
  }
  const { data, sha } = await readJsonFile<DraftSessionIndex>(path);
  return {
    data: {
      userId,
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    },
    sha,
  };
}

function compactSession(session: DraftSessionRecord): DraftSessionRecord {
  return {
    ...session,
    userId: normalizeUserId(session.userId),
    topicId: session.topicId.trim(),
    topicTitle: session.topicTitle.trim(),
    streamingBody: session.streamingBody ?? "",
    status: "draft_generated",
  };
}

export async function GET(request: NextRequest) {
  const userId = normalizeUserId(request.nextUrl.searchParams.get("userId") ?? "");
  const topicId = request.nextUrl.searchParams.get("topicId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });
  }

  const { data } = await readIndex(userId);
  const sessions = topicId
    ? data.sessions.filter((session) => session.topicId === topicId)
    : data.sessions;

  return NextResponse.json({
    userId,
    sessions: sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Partial<DraftSessionRecord>;
  const userId = normalizeUserId(body.userId ?? "");
  const topicId = body.topicId?.trim() ?? "";
  const topicTitle = body.topicTitle?.trim() ?? "";
  const streamingBody = body.streamingBody ?? "";
  const result = body.result;

  if (!userId || !topicId || !topicTitle || !streamingBody.trim() || !result?.title?.trim()) {
    return NextResponse.json(
      { error: "userId, topicId, topicTitle, streamingBody, result.title은 필수입니다." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const { data, sha } = await readIndex(userId);
  const session = compactSession({
    sessionId: `draft-${randomUUID().slice(0, 8)}`,
    userId,
    topicId,
    topicTitle,
    pipelineId: body.pipelineId,
    strategy: body.strategy,
    streamingBody,
    result,
    status: "draft_generated",
    createdAt: now,
    updatedAt: now,
  });

  const topicSessions = [session, ...data.sessions.filter((item) => item.topicId === topicId)].slice(0, 5);
  const otherSessions = data.sessions.filter((item) => item.topicId !== topicId);
  const sessions = [...topicSessions, ...otherSessions].slice(0, 30);

  const updated: DraftSessionIndex = {
    userId,
    sessions,
    updatedAt: now,
  };

  await writeJsonFile(Paths.draftSessions(userId), updated, `chore: save draft session ${userId}/${topicId}`, sha);
  return NextResponse.json({ ok: true, session });
}

export async function DELETE(request: NextRequest) {
  const userId = normalizeUserId(request.nextUrl.searchParams.get("userId") ?? "");
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
  const topicId = request.nextUrl.searchParams.get("topicId")?.trim();
  if (!userId || (!sessionId && !topicId)) {
    return NextResponse.json({ error: "userId와 sessionId 또는 topicId가 필요합니다." }, { status: 400 });
  }

  const { data, sha } = await readIndex(userId);
  const sessions = sessionId
    ? data.sessions.filter((session) => session.sessionId !== sessionId)
    : data.sessions.filter((session) => session.topicId !== topicId);
  await writeJsonFile(
    Paths.draftSessions(userId),
    { userId, sessions, updatedAt: new Date().toISOString() },
    `chore: delete draft session ${userId}/${sessionId ?? topicId}`,
    sha
  );
  return NextResponse.json({ ok: true });
}
