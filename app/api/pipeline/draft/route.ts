import { NextRequest, NextResponse } from "next/server";
import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import {
  buildPipelineUserDraftPayload,
  type PipelineUserDraft,
  type PipelineUserDraftInput,
} from "@/lib/pipeline-user-draft";
import { normalizeUserId } from "@/lib/utils/normalize";

export const dynamic = "force-dynamic";

const MAX_RETRIES = 5;

function isSameDraft(left: PipelineUserDraft, right: PipelineUserDraft): boolean {
  return (
    left.userId === right.userId &&
    left.topicMode === right.topicMode &&
    left.selectedTopicId === right.selectedTopicId &&
    left.directTopicTitle === right.directTopicTitle &&
    left.directMainKeyword === right.directMainKeyword &&
    left.directSubKeyword === right.directSubKeyword &&
    left.autoApprove === right.autoApprove
  );
}

export async function GET(request: NextRequest) {
  const rawUserId = request.nextUrl.searchParams.get("userId");
  if (!rawUserId?.trim()) {
    return NextResponse.json({ error: "userId 파라미터가 필요합니다." }, { status: 400 });
  }

  const userId = normalizeUserId(rawUserId);
  const path = Paths.pipelineUserDraft(userId);

  try {
    const exists = await fileExists(path);
    if (!exists) {
      return NextResponse.json({ draft: null, userId });
    }

    const { data } = await readJsonFile<PipelineUserDraft>(path);
    return NextResponse.json({ draft: data, userId });
  } catch (error) {
    console.error("[GET /api/pipeline/draft]", error);
    return NextResponse.json({ error: "임시저장 불러오기에 실패했습니다." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let body: PipelineUserDraftInput;
  try {
    body = (await request.json()) as PipelineUserDraftInput;
  } catch {
    return NextResponse.json({ error: "요청 본문 파싱에 실패했습니다." }, { status: 400 });
  }

  if (!body?.userId?.trim()) {
    return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });
  }

  const draft = buildPipelineUserDraftPayload(body);
  const path = Paths.pipelineUserDraft(draft.userId);

  try {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let sha: string | null = null;

      if (await fileExists(path)) {
        const existing = await readJsonFile<PipelineUserDraft>(path);
        sha = existing.sha;

        if (isSameDraft(existing.data, draft)) {
          return NextResponse.json({ draft: existing.data });
        }
      }

      try {
        await writeJsonFile(
          path,
          draft,
          `chore: save pipeline draft for ${draft.userId}`,
          sha
        );
        return NextResponse.json({ draft });
      } catch (error) {
        const status = (error as { status?: number }).status;
        const isConflict = status === 409 || status === 422;
        if (isConflict && attempt < MAX_RETRIES) {
          const delay = Math.min(1000, 100 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }

    throw new Error("pipeline draft save retry exhausted");
  } catch (error) {
    console.error("[PUT /api/pipeline/draft]", error);
    return NextResponse.json({ error: "임시저장 저장에 실패했습니다." }, { status: 500 });
  }
}
