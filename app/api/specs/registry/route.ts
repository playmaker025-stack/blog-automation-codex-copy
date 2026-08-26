/**
 * POST /api/specs/registry — 사양 원장 직접 편집
 *
 * 후보 승인(/api/specs)과 다른 경로다. 승인은 "글에서 나온 값을 받아들일
 * 것인가"이고, 여기는 "사장님이 아는 값을 바로 적는다"이다.
 *
 * action:
 *   setField        { product, field, value }
 *   clearField      { product, field }
 *   addProduct      { name, category?, aliases? }
 *   deleteProduct   { name }
 *   setNotes        { product, notes: string[] }
 *   setAliases      { product, aliases: string[] }
 *   setDomainNotes  { notes: string[] }
  mergeProducts   { keeper, loser }
 */

import { NextResponse } from "next/server";
import { loadProductSpecs } from "@/lib/agents/product-spec-store";
import { Paths } from "@/lib/github/paths";
import { writeJsonFile } from "@/lib/github/repository";
import type { ProductSpec, ProductSpecRegistry } from "@/lib/agents/product-specs";
import { mergeProducts } from "@/lib/agents/product-identity";
import {
  addProduct,
  clearSpecField,
  deleteProduct,
  setDomainNotes,
  setProductAliases,
  setProductNotes,
  setSpecField,
  type EditResult,
} from "@/lib/agents/spec-registry-edit";

export const dynamic = "force-dynamic";

interface Body {
  action?: string;
  keeper?: string;
  loser?: string;
  product?: string;
  field?: string;
  value?: string;
  name?: string;
  category?: ProductSpec["category"];
  aliases?: string[];
  notes?: string[];
}

function apply(registry: ProductSpecRegistry, body: Body): EditResult {
  switch (body.action) {
    case "setField":
      if (!body.product || !body.field)
        return { registry, error: "product와 field가 필요합니다." };
      return setSpecField(registry, body.product, body.field, body.value ?? "");
    case "clearField":
      if (!body.product || !body.field)
        return { registry, error: "product와 field가 필요합니다." };
      return clearSpecField(registry, body.product, body.field);
    case "addProduct":
      return addProduct(registry, {
        name: body.name ?? "",
        category: body.category,
        aliases: body.aliases,
      });
    case "deleteProduct":
      return deleteProduct(registry, body.name ?? "");
    case "setNotes":
      if (!body.product) return { registry, error: "product가 필요합니다." };
      return setProductNotes(registry, body.product, body.notes ?? []);
    case "setAliases":
      if (!body.product) return { registry, error: "product가 필요합니다." };
      return setProductAliases(registry, body.product, body.aliases ?? []);
    case "setDomainNotes":
      return setDomainNotes(registry, body.notes ?? []);
    case "mergeProducts": {
      if (!body.keeper || !body.loser)
        return { registry, error: "keeper와 loser가 필요합니다." };
      const merged = mergeProducts(registry, body.keeper, body.loser);
      return { registry: merged.registry, error: merged.error };
    }
    default:
      return { registry, error: `알 수 없는 action: ${body.action}` };
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  try {
    const { data: registry, sha } = await loadProductSpecs();
    const result = apply(registry, body);

    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    await writeJsonFile<ProductSpecRegistry>(
      Paths.productSpecs(),
      result.registry,
      `chore(specs): ${body.action} ${body.product ?? body.name ?? ""}`.trim(),
      sha
    );

    return NextResponse.json({ ok: true, registry: result.registry });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
