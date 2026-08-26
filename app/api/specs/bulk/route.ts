/**
 * POST /api/specs/bulk — 사양 후보 일괄 승인/거절
 *
 * 왜 필요한가: 기존 /api/specs는 후보 하나당 GitHub 왕복 5번과 커밋 2개를 낸다.
 * 실측(2026-08-26) 대기 363건 기준으로 왕복 1,800번, 커밋 700개다. 화면이 멎고,
 * 그 사이 프로덕션이 같은 파일을 써서 sha 충돌이 난다.
 *
 * 여기서는 한 번 읽고, 메모리에서 전부 적용하고, 두 번 쓴다(원장 + 후보함).
 * 363건이 커밋 2개가 된다.
 *
 * 해석 못 하는 값은 조용히 버리지 않고 사유와 함께 돌려준다. 일괄 처리에서
 * 실패를 숨기면 뭐가 안 들어갔는지 아무도 모른다.
 */

import { NextResponse } from "next/server";
import { loadProductSpecs } from "@/lib/agents/product-spec-store";
import { Paths } from "@/lib/github/paths";
import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { loadSpecCandidates } from "@/lib/agents/spec-candidate-store";
import { applyCandidate, decideCandidate, coerceValue, FIELD_LABELS } from "@/lib/agents/spec-candidates";
import type { ProductSpecRegistry } from "@/lib/agents/product-specs";
import type { SpecCandidateStore } from "@/lib/agents/spec-candidates";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  ids?: string[];
  action?: "승인" | "거절";
  /** 후보 id → 사람이 고친 값. 없으면 추출된 값을 쓴다. */
  overrides?: Record<string, string>;
}

/**
 * sha 충돌을 한 번 재시도한다. 발행이 겹치면 같은 파일이 그 사이 바뀐다.
 * build가 현재 값을 받는 이유는 재시도할 때 남의 변경을 덮지 않기 위해서다.
 */
async function writeWithRetry<T>(
  path: string,
  build: (current: T | null) => T,
  message: string
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = (await fileExists(path))
      ? await readJsonFile<T>(path)
      : { data: null, sha: null };
    try {
      await writeJsonFile(path, build(current.data), message, current.sha);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (attempt === 1 || !/but expected|does not match|409/.test(detail)) throw error;
    }
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];

  if (ids.length === 0 || (body.action !== "승인" && body.action !== "거절")) {
    return NextResponse.json(
      { ok: false, error: "ids와 action(승인|거절)이 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const [{ data: store }, { data: registry }] = await Promise.all([
      loadSpecCandidates(),
      loadProductSpecs(),
    ]);

    const byId = new Map(store.candidates.map((candidate) => [candidate.id, candidate] as const));
    const overrides = body.overrides ?? {};

    const applied: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    let nextRegistry = registry;

    for (const id of ids) {
      const candidate = byId.get(id);
      if (!candidate) {
        failed.push({ id, reason: "후보를 찾을 수 없습니다." });
        continue;
      }

      if (body.action === "거절") {
        applied.push(id);
        continue;
      }

      const raw = overrides[id]?.trim() || candidate.value;
      if (coerceValue(candidate.field, raw) === null) {
        // 해석 못 하는 값은 원장에 넣지 않는다. 조용히 넘기지도 않는다.
        failed.push({
          id,
          reason: `"${raw}"를 ${FIELD_LABELS[candidate.field] ?? candidate.field} 값으로 해석하지 못했습니다.`,
        });
        continue;
      }

      nextRegistry = applyCandidate(nextRegistry, candidate, { overrideValue: raw });
      applied.push(id);
    }

    if (body.action === "승인" && applied.length > 0) {
      await writeWithRetry<ProductSpecRegistry>(
        Paths.productSpecs(),
        () => nextRegistry,
        `chore(specs): 후보 ${applied.length}건 일괄 승인`
      );
    }

    if (applied.length > 0) {
      // 재시도할 때는 그 시점의 후보함 위에 다시 적용한다. 그 사이 추출기가
      // 새 후보를 넣었을 수 있고, 통째로 덮으면 그게 사라진다.
      await writeWithRetry<SpecCandidateStore>(
        Paths.productSpecCandidates(),
        (current) => {
          let decided = current ?? store;
          for (const id of applied) decided = decideCandidate(decided, id, body.action!);
          return decided;
        },
        `chore(specs): 후보 ${applied.length}건 일괄 ${body.action}`
      );
    }

    return NextResponse.json({
      ok: true,
      action: body.action,
      requested: ids.length,
      applied: applied.length,
      failed,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
