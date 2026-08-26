/**
 * GET  /api/specs — 사양 원장 + 확인 대기 후보
 * POST /api/specs — 후보 승인/거절 { id, action, value? }
 *
 * 승인해야만 원장에 들어가고, 원장에 들어가야만 글쓰기 프롬프트에 들어간다.
 * 자동 추출이 사람 확인 없이 사실로 승격되는 경로는 만들지 않는다.
 */

import { NextResponse } from "next/server";
import { loadProductSpecs } from "@/lib/agents/product-spec-store";
import { Paths } from "@/lib/github/paths";
import { writeJsonFile } from "@/lib/github/repository";
import { loadSpecCandidates, saveSpecCandidates } from "@/lib/agents/spec-candidate-store";
import {
  applyCandidate,
  decideCandidate,
  pendingCandidates,
  coerceValue,
  FIELD_LABELS,
} from "@/lib/agents/spec-candidates";
import type { ProductSpecRegistry } from "@/lib/agents/product-specs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [{ data: registry }, { data: store }] = await Promise.all([
      loadProductSpecs(),
      loadSpecCandidates(),
    ]);
    // 해석 못 하는 값은 승인 버튼에 넣으면 안 된다. 눌러봐야 실패한다.
    // 화면이 미리 알고 체크를 풀어둘 수 있게 여기서 판정해서 내려준다.
    const pending = pendingCandidates(store, registry).map((candidate) => ({
      ...candidate,
      coercible: coerceValue(candidate.field, candidate.value) !== null,
    }));

    return NextResponse.json({
      ok: true,
      registry,
      pending,
      counts: {
        pending: pending.length,
        conflict: pending.filter((c) => c.verdict === "충돌").length,
        decided: store.candidates.length - pending.length,
        products: registry.products.length,
      },
      fieldLabels: FIELD_LABELS,
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
    id?: string;
    action?: string;
    value?: string;
  };

  if (!body.id || (body.action !== "승인" && body.action !== "거절")) {
    return NextResponse.json(
      { ok: false, error: "id와 action(승인|거절)이 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const { data: store, sha } = await loadSpecCandidates();
    const candidate = store.candidates.find((c) => c.id === body.id);
    if (!candidate) {
      return NextResponse.json({ ok: false, error: "후보를 찾을 수 없습니다." }, { status: 404 });
    }

    if (body.action === "승인") {
      const raw = body.value?.trim() || candidate.value;
      if (coerceValue(candidate.field, raw) === null) {
        return NextResponse.json(
          { ok: false, error: `"${raw}"를 ${FIELD_LABELS[candidate.field]} 값으로 해석하지 못했습니다.` },
          { status: 400 }
        );
      }
      const { data: registry, sha: registrySha } = await loadProductSpecs();
      const next = applyCandidate(registry, candidate, { overrideValue: raw });
      await writeJsonFile<ProductSpecRegistry>(
        Paths.productSpecs(),
        next,
        `chore(specs): ${candidate.product} ${candidate.field} 승인`,
        registrySha
      );
    }

    const decided = decideCandidate(store, body.id, body.action);
    await saveSpecCandidates(decided, sha, `chore(specs): 후보 ${body.action} (${candidate.product})`);

    const { data: registry } = await loadProductSpecs();
    return NextResponse.json({
      ok: true,
      pending: pendingCandidates(decided, registry),
      registry,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
