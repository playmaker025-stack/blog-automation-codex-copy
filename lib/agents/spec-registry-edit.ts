/**
 * spec-registry-edit — 사양 원장 직접 편집의 순수 로직.
 *
 * 후보 승인(spec-candidates)과 다른 경로다. 승인은 "글에서 나온 값을 받아들일
 * 것인가"이고, 여기는 "사장님이 아는 값을 바로 적는다"이다. 둘 다 필요하다 —
 * 글에 안 적힌 사양도 많고, 이미 들어간 값을 고쳐야 할 때도 있다.
 *
 * 전부 새 원장을 돌려주고 입력을 변형하지 않는다. 실패는 예외 대신 error
 * 문자열로 준다 — 화면에서 그대로 보여줘야 사장님이 뭘 고칠지 안다.
 */

import type { ProductSpec, ProductSpecRegistry } from "./product-specs";
import { CANDIDATE_FIELDS, coerceValue, type CandidateField } from "./spec-candidates.ts";

export interface EditResult {
  registry: ProductSpecRegistry;
  error?: string;
}

const CANDIDATE_FIELD_SET = new Set<string>(CANDIDATE_FIELDS);

/** 편집 화면에서 건드릴 수 있는 필드인지. name/source 같은 건 막는다. */
export function isEditableField(field: string): field is CandidateField {
  return CANDIDATE_FIELD_SET.has(field);
}

function findIndex(registry: ProductSpecRegistry, product: string): number {
  const needle = product.trim();
  return registry.products.findIndex(
    (p) => p.name === needle || (p.aliases ?? []).includes(needle)
  );
}

function touch(spec: ProductSpec, note: string): ProductSpec {
  return {
    ...spec,
    verifiedAt: new Date().toISOString().slice(0, 10),
    source: spec.source.includes(note) ? spec.source : `${spec.source} + ${note}`,
  };
}

const DIRECT_EDIT_NOTE = "사장님 직접 입력";

export function setSpecField(
  registry: ProductSpecRegistry,
  product: string,
  field: string,
  rawValue: string
): EditResult {
  if (!isEditableField(field)) {
    return { registry, error: `"${field}"는 편집할 수 없는 항목입니다.` };
  }
  const idx = findIndex(registry, product);
  if (idx === -1) return { registry, error: `"${product}"를 원장에서 찾지 못했습니다.` };

  const coerced = coerceValue(field, rawValue);
  if (coerced === null) {
    return { registry, error: `"${rawValue}"를 이 항목의 값으로 해석하지 못했습니다.` };
  }

  const products = [...registry.products];
  products[idx] = touch({ ...products[idx], [field]: coerced } as ProductSpec, DIRECT_EDIT_NOTE);
  return { registry: { ...registry, products, updatedAt: new Date().toISOString() } };
}

/**
 * 항목을 비운다.
 *
 * 지우는 게 왜 필요한가: 잘못 들어간 값이 남아 있으면 검사기가 그걸 기준으로
 * 정상 문장을 막는다. 비우면 "미확인"으로 돌아가 경고만 뜬다 — 확신이 없을
 * 때는 틀린 값보다 빈칸이 안전하다.
 */
export function clearSpecField(
  registry: ProductSpecRegistry,
  product: string,
  field: string
): EditResult {
  if (!isEditableField(field)) {
    return { registry, error: `"${field}"는 편집할 수 없는 항목입니다.` };
  }
  const idx = findIndex(registry, product);
  if (idx === -1) return { registry, error: `"${product}"를 원장에서 찾지 못했습니다.` };

  const products = [...registry.products];
  const next = { ...products[idx] } as Record<string, unknown>;
  delete next[field];
  products[idx] = touch(next as unknown as ProductSpec, DIRECT_EDIT_NOTE);
  return { registry: { ...registry, products, updatedAt: new Date().toISOString() } };
}

export function addProduct(
  registry: ProductSpecRegistry,
  input: { name: string; category?: ProductSpec["category"]; aliases?: string[] }
): EditResult {
  const name = input.name.trim();
  if (!name) return { registry, error: "제품명을 입력하세요." };
  if (findIndex(registry, name) !== -1) {
    return { registry, error: `"${name}"는 이미 등록돼 있습니다.` };
  }

  const created: ProductSpec = {
    name,
    category: input.category ?? "기기",
    aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
    source: DIRECT_EDIT_NOTE,
    verifiedAt: new Date().toISOString().slice(0, 10),
  };

  return {
    registry: {
      ...registry,
      products: [...registry.products, created].sort((a, b) => a.name.localeCompare(b.name)),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function deleteProduct(registry: ProductSpecRegistry, name: string): EditResult {
  const idx = findIndex(registry, name);
  if (idx === -1) return { registry, error: `"${name}"를 원장에서 찾지 못했습니다.` };
  const products = registry.products.filter((_, i) => i !== idx);
  return { registry: { ...registry, products, updatedAt: new Date().toISOString() } };
}

/** notes는 자유 문장이라 타입 검사가 없다. 빈 줄만 걷어낸다. */
export function setProductNotes(
  registry: ProductSpecRegistry,
  product: string,
  notes: string[]
): EditResult {
  const idx = findIndex(registry, product);
  if (idx === -1) return { registry, error: `"${product}"를 원장에서 찾지 못했습니다.` };

  const cleaned = notes.map((n) => n.trim()).filter(Boolean);
  const products = [...registry.products];
  products[idx] = { ...products[idx], notes: cleaned };
  return { registry: { ...registry, products, updatedAt: new Date().toISOString() } };
}

export function setDomainNotes(registry: ProductSpecRegistry, notes: string[]): EditResult {
  return {
    registry: {
      ...registry,
      domainNotes: notes.map((n) => n.trim()).filter(Boolean),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function setProductAliases(
  registry: ProductSpecRegistry,
  product: string,
  aliases: string[]
): EditResult {
  const idx = findIndex(registry, product);
  if (idx === -1) return { registry, error: `"${product}"를 원장에서 찾지 못했습니다.` };
  const products = [...registry.products];
  products[idx] = {
    ...products[idx],
    aliases: aliases.map((a) => a.trim()).filter(Boolean),
  };
  return { registry: { ...registry, products, updatedAt: new Date().toISOString() } };
}
