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
import { findDuplicateSuggestions } from "@/lib/agents/product-identity";

export const dynamic = "force-dynamic";

const NUMERIC_FIELDS = new Set(["batteryMah", "puffs", "weightG", "nicotinePercent"]);
const BOOLEAN_FIELDS = new Set([
  "wattControl",
  "airflowControl",
  "batteryRechargeable",
  "liquidRefillable",
]);

/** 승인이 막힌 이유. 화면이 이걸로 "거절할 것"과 "사장님이 정할 것"을 나눈다. */
function blockedReasonOf(field: string, value: string): string {
  if (NUMERIC_FIELDS.has(field) && !/\d/.test(value)) {
    return "숫자가 없습니다. 값이 아니라 항목 이름으로 보입니다 — 거절하세요.";
  }
  if (BOOLEAN_FIELDS.has(field) && /ml|용량|탱크/.test(value)) {
    return "이 항목의 값이 아닙니다. 용량은 팟 용량 칸에 넣으세요 — 거절하세요.";
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return "가능 또는 불가로 고쳐주세요.";
  }
  return "이 항목의 값으로 읽을 수 없습니다.";
}

export async function GET() {
  try {
    const [{ data: registry }, { data: store }] = await Promise.all([
      loadProductSpecs(),
      loadSpecCandidates(),
    ]);
    // 해석 못 하는 값은 승인 버튼에 넣으면 안 된다. 눌러봐야 실패한다.
    // 화면이 미리 알고 체크를 풀어둘 수 있게 여기서 판정해서 내려준다.
    const pending = pendingCandidates(store, registry).map((candidate) => {
      const coercible = coerceValue(candidate.field, candidate.value) !== null;
      return {
        ...candidate,
        coercible,
        // 왜 승인이 안 되는지에 따라 해야 할 일이 다르다. "고쳐야 함"만 띄우면
        // 거절해야 할 쓰레기와 사장님만 아는 값이 같아 보인다.
        blockedReason: coercible ? undefined : blockedReasonOf(candidate.field, candidate.value),
      };
    });

    return NextResponse.json({
      ok: true,
      registry,
      pending,
      // 같은 기기가 표기만 달라 쪼개진 것. 자동으로 합치지 않고 제안만 한다.
      duplicates: findDuplicateSuggestions(registry),
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
