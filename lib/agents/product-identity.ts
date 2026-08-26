/**
 * product-identity — 같은 제품인지 판정하고, 중복을 합치는 순수 로직.
 *
 * 왜 필요한가: 추출기가 글에서 제품명을 뽑을 때 표기가 제각각이라 원장이
 * 56개까지 불면서 같은 기기가 쪼개졌다. 실측(2026-08-26):
 *   'SUPA X3' vs '수파X3 (SUPA X3)' / '말론' vs '말론 (Malone)'
 *   '와카 버스트' vs '와카버스트' / '그래피티2' vs '버블몬 그래피티2'
 * 승인 화면도 제품 단위로 묶으므로, 같은 기기가 카드 두 개로 나뉜다.
 *
 * 위험한 것은 과잉 병합이다. '말론'/'말론S'/'말론바', '젤로'/'젤로맥스',
 * '발라리안맥스'/'발라리안맥스프로'는 전부 다른 제품이다. 그래서 자동 매칭은
 * **표기 차이만** 본다. 접두어 포함, 유사도, 숫자 제거는 하지 않는다.
 * 나머지는 사람에게 제안만 한다.
 */

import type { ProductSpec, ProductSpecRegistry } from "./product-specs";

/**
 * 표기 차이를 지운다. 이것만으로 같아지면 같은 제품으로 본다.
 * 전각/반각(NFKC), 대소문자, 공백, 하이픈, 가운뎃점만 지운다. 글자는 안 지운다.
 */
export function normalizeProductName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_·・]/g, "")
    .trim();
}

/**
 * 괄호 병기를 분해한다. "수파X3 (SUPA X3)"는 세 가지로 불릴 수 있다.
 * 괄호 안이 비거나 너무 짧으면(한 글자) 무시한다 — "말론(2세대)" 같은 걸
 * 별칭으로 만들면 다른 제품과 섞인다.
 */
export function expandNameVariants(name: string): string[] {
  const trimmed = name.trim();
  const variants = new Set<string>([trimmed]);

  const match = trimmed.match(/^(.+?)\s*[(（]([^)）]+)[)）]\s*$/);
  if (match) {
    const [, outside, inside] = match;
    if (outside.trim().length >= 2) variants.add(outside.trim());
    if (inside.trim().length >= 2) variants.add(inside.trim());
  }

  return [...variants];
}

/** 이 제품이 응답하는 모든 표기. 이름 + 별칭 + 각각의 괄호 분해. */
export function nameKeysOf(spec: Pick<ProductSpec, "name" | "aliases">): string[] {
  const raw = [spec.name, ...(spec.aliases ?? [])];
  const keys = new Set<string>();
  for (const candidate of raw) {
    for (const variant of expandNameVariants(candidate)) {
      const normalized = normalizeProductName(variant);
      if (normalized) keys.add(normalized);
    }
  }
  return [...keys];
}

/**
 * 글에서 뽑은 이름을 원장의 제품으로 확정한다.
 *
 * 표기 정규화로 정확히 하나가 걸릴 때만 확정한다. 둘 이상 걸리면 사람이
 * 판단해야 한다 — 조용히 첫 번째를 고르면 엉뚱한 제품에 사양이 붙는다.
 */
export function resolveProduct(
  registry: ProductSpecRegistry,
  rawName: string
): { spec: ProductSpec | null; ambiguous: ProductSpec[] } {
  const wanted = new Set(expandNameVariants(rawName).map(normalizeProductName).filter(Boolean));
  if (wanted.size === 0) return { spec: null, ambiguous: [] };

  const hits = registry.products.filter((product) =>
    nameKeysOf(product).some((key) => wanted.has(key))
  );

  if (hits.length === 1) return { spec: hits[0], ambiguous: [] };
  if (hits.length === 0) return { spec: null, ambiguous: [] };
  return { spec: null, ambiguous: hits };
}

// ── 중복 진단 ──────────────────────────────────────────────

export interface DuplicateSuggestion {
  /** 남길 쪽. 사양을 더 많이 가진 제품을 기본으로 제안한다. */
  keeper: string;
  /** 합쳐질 쪽. */
  loser: string;
  reason: "표기 동일" | "괄호 병기";
  /** 두 제품이 같은 항목에 다른 값을 가진 것. 자동으로 합치면 안 되는 근거. */
  conflictingFields: string[];
}

const IGNORED_FIELDS = new Set(["name", "aliases", "source", "verifiedAt", "notes", "category"]);

function specWeight(spec: ProductSpec): number {
  return Object.entries(spec).filter(([k, v]) => !IGNORED_FIELDS.has(k) && v !== undefined).length;
}

function conflictsBetween(a: ProductSpec, b: ProductSpec): string[] {
  const fields = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !IGNORED_FIELDS.has(k)));
  const conflicts: string[] = [];
  for (const field of fields) {
    const left = (a as unknown as Record<string, unknown>)[field];
    const right = (b as unknown as Record<string, unknown>)[field];
    if (left === undefined || right === undefined) continue;
    if (String(left) !== String(right)) conflicts.push(field);
  }
  return conflicts;
}

/**
 * 합칠 만한 제품 쌍을 찾는다. 자동으로 합치지 않는다.
 *
 * 표기 정규화로 같아지는 것만 본다. '말론'과 '말론S'는 정규화해도 다르므로
 * 여기 안 걸린다 — 그게 이 함수의 핵심 안전장치다.
 */
export function findDuplicateSuggestions(registry: ProductSpecRegistry): DuplicateSuggestion[] {
  const suggestions: DuplicateSuggestion[] = [];
  const products = registry.products;

  for (let i = 0; i < products.length; i += 1) {
    for (let j = i + 1; j < products.length; j += 1) {
      const a = products[i];
      const b = products[j];
      const keysA = new Set(nameKeysOf(a));
      const shared = nameKeysOf(b).some((key) => keysA.has(key));
      if (!shared) continue;

      const reason: DuplicateSuggestion["reason"] =
        normalizeProductName(a.name) === normalizeProductName(b.name) ? "표기 동일" : "괄호 병기";

      const [keeper, loser] = specWeight(a) >= specWeight(b) ? [a, b] : [b, a];
      suggestions.push({
        keeper: keeper.name,
        loser: loser.name,
        reason,
        conflictingFields: conflictsBetween(a, b),
      });
    }
  }

  return suggestions;
}

/**
 * 두 제품을 합친다.
 *
 * keeper에 없는 항목만 loser에서 가져온다. 둘 다 값이 있고 서로 다르면
 * 건드리지 않고 그대로 둔다 — 어느 쪽이 맞는지는 사람이 안다. loser의 이름과
 * 별칭은 keeper의 별칭으로 옮겨서 앞으로 그 표기로 들어와도 붙게 한다.
 */
export function mergeProducts(
  registry: ProductSpecRegistry,
  keeperName: string,
  loserName: string
): { registry: ProductSpecRegistry; error?: string; keptConflicts: string[] } {
  const keeper = registry.products.find((p) => p.name === keeperName);
  const loser = registry.products.find((p) => p.name === loserName);

  if (!keeper) return { registry, error: `"${keeperName}"를 찾지 못했습니다.`, keptConflicts: [] };
  if (!loser) return { registry, error: `"${loserName}"를 찾지 못했습니다.`, keptConflicts: [] };
  if (keeper.name === loser.name) {
    return { registry, error: "같은 제품끼리는 합칠 수 없습니다.", keptConflicts: [] };
  }

  const merged: Record<string, unknown> = { ...keeper };
  const keptConflicts: string[] = [];

  for (const [field, value] of Object.entries(loser)) {
    if (IGNORED_FIELDS.has(field) || value === undefined) continue;
    if (merged[field] === undefined) {
      merged[field] = value;
    } else if (String(merged[field]) !== String(value)) {
      // 값이 어긋나면 keeper 것을 남기고 사실을 보고한다. 조용히 덮지 않는다.
      keptConflicts.push(field);
    }
  }

  const aliases = new Set([
    ...(keeper.aliases ?? []),
    ...(loser.aliases ?? []),
    loser.name,
  ]);
  aliases.delete(keeper.name);

  merged.aliases = [...aliases].filter(Boolean);
  merged.notes = [...(keeper.notes ?? []), ...(loser.notes ?? [])];
  merged.source = keeper.source.includes("병합") ? keeper.source : `${keeper.source} + 병합`;
  merged.verifiedAt = new Date().toISOString().slice(0, 10);

  return {
    registry: {
      ...registry,
      products: registry.products
        .filter((p) => p.name !== loser.name)
        .map((p) => (p.name === keeper.name ? (merged as unknown as ProductSpec) : p)),
      updatedAt: new Date().toISOString(),
    },
    keptConflicts,
  };
}
