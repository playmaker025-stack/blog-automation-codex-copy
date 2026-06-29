import { NextRequest, NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { UserProfile } from "@/lib/types/github-data";
import { normalizeUserId } from "@/lib/utils/normalize";

export async function GET(request: NextRequest) {
  const rawUserId = request.nextUrl.searchParams.get("userId");
  if (!rawUserId) {
    return NextResponse.json({ error: "userId 파라미터가 필요합니다." }, { status: 400 });
  }

  const userId = normalizeUserId(rawUserId);

  try {
    const path = Paths.userProfile(userId);
    const exists = await fileExists(path);
    if (!exists) {
      return NextResponse.json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data } = await readJsonFile<UserProfile>(path);
    return NextResponse.json({ profile: data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status;
    console.error("[GET /api/github/profile]", error);

    if (status === 401 || msg.includes("GITHUB_TOKEN") || msg.includes("Bad credentials")) {
      return NextResponse.json({ error: "GitHub 토큰이 유효하지 않습니다. Railway Variables의 GITHUB_TOKEN을 확인해 주세요." }, { status: 500 });
    }
    if (status === 403) {
      return NextResponse.json({ error: "GitHub 접근 권한이 없습니다. GITHUB_TOKEN 권한을 확인해 주세요." }, { status: 500 });
    }
    if (msg.includes("GITHUB_DATA_REPO")) {
      return NextResponse.json({ error: `데이터 저장소 설정 오류: ${msg}` }, { status: 500 });
    }
    return NextResponse.json({ error: `프로필 조회 실패: ${msg.slice(0, 200)}` }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { profile: UserProfile };
    const { profile } = body;

    if (!profile?.userId) {
      return NextResponse.json({ error: "userId가 포함된 profile 객체가 필요합니다." }, { status: 400 });
    }

    const normalizedUserId = normalizeUserId(profile.userId);
    const path = Paths.userProfile(normalizedUserId);
    const exists = await fileExists(path);

    let sha: string | null = null;
    if (exists) {
      const { sha: existingSha } = await readJsonFile<UserProfile>(path);
      sha = existingSha;
    }

    const updated: UserProfile = {
      ...profile,
      userId: normalizedUserId,
      updatedAt: new Date().toISOString(),
    };

    await writeJsonFile(
      path,
      updated,
      `chore: update profile for ${updated.userId}`,
      sha
    );

    return NextResponse.json({ profile: updated });
  } catch (error) {
    console.error("[PUT /api/github/profile]", error);
    return NextResponse.json({ error: "프로필 저장 실패" }, { status: 500 });
  }
}
