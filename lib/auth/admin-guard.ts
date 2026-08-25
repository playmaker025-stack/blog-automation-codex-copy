/**
 * admin-guard — 관리자 쓰기 API 인증.
 *
 * 왜 fail-closed인가: 키가 없을 때 통과시키면 "설정을 깜빡한 순간"이 곧 무방비다.
 * 실측(2026-08-25) — 이 앱의 프로덕션에는 ADMIN_API_KEY가 아예 없었고, 그래서
 * 기존 /api/admin은 아무도 모른 채 500으로 죽어 있었다. 조용히 열리는 것보다
 * 시끄럽게 막히는 편이 낫다.
 *
 * 헤더는 두 가지를 받는다. Authorization은 스크립트·curl용이고, x-admin-key는
 * 브라우저 화면에서 쓰기 편하다.
 */

import { NextResponse } from "next/server";

export const ADMIN_KEY_HEADER = "x-admin-key";

/** 통과하면 null, 막히면 그대로 돌려줄 응답. */
export function requireAdmin(request: Request): NextResponse | null {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ADMIN_API_KEY가 서버에 설정되지 않아 이 기능을 쓸 수 없습니다. Railway Variables에 추가한 뒤 다시 시도하세요.",
        code: "admin_key_missing",
      },
      { status: 503 }
    );
  }

  const bearer = request.headers.get("authorization");
  const direct = request.headers.get(ADMIN_KEY_HEADER);
  if (bearer === `Bearer ${key}` || direct === key) return null;

  return NextResponse.json(
    { ok: false, error: "관리자 키가 필요합니다.", code: "admin_key_required" },
    { status: 401 }
  );
}
