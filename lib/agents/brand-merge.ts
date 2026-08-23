/**
 * brand-merge — 제품명 등록의 순수 로직.
 *
 * I/O(GitHub 읽기/쓰기)는 brand-registry.ts가 담당한다.
 * 병합 규칙은 외부 의존 없이 테스트할 수 있어야 해서 분리했다.
 */

import type { DomainContract } from "./domain-contract";
import type { ProductEntity } from "./demand-signals";

export interface RegisteredBrand {
  name: string;
  /** 어느 글에서 뽑았는지. 오탐 추적용. */
  evidence: string;
  registeredAt: string;
  /** 이후 추출에서 몇 번 더 확인됐는지. 낮으면 오탐 가능성이 높다. */
  seenCount: number;
}

export interface BrandRegistry {
  schemaVersion: 1;
  brands: RegisteredBrand[];
  updatedAt: string;
}

const MAX_REGISTERED_BRANDS = 300;

/** 제품명으로 볼 수 없는 것. LLM이 실수로 뽑아도 여기서 막는다. */
const REJECT_PATTERNS = [
  /^[0-9]+$/u,
  /^(전자담배|액상|기기|코일|팟|매장|후기|추천|비교|가격)$/u,
  /^(인천|부평|만수동|구월동|부천|상동|송도|청라|연수|주안|간석)/u,
];

/**
 * 실제 제품명 길이는 짧다. 등록된 것 중 가장 긴 게 "만수동만수르"(6자), "베이포레소"(5자)다.
 * 상한을 넉넉히 잡으면 LLM이 문장을 통째로 뽑았을 때 그대로 등록된다.
 */
const MAX_BRAND_LENGTH = 14;

function isPlausibleBrand(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > MAX_BRAND_LENGTH) return false;
  // 띄어쓰기가 여러 번 나오면 제품명이 아니라 문구다.
  if (trimmed.split(/\s+/).length > 3) return false;
  return !REJECT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function emptyRegistry(): BrandRegistry {
  return { schemaVersion: 1, brands: [], updatedAt: new Date().toISOString() };
}

export function mergeBrandCandidates(params: {
  registry: BrandRegistry;
  candidates: ProductEntity[];
  contract: DomainContract;
  now?: string;
}): { registry: BrandRegistry; added: string[] } {
  const { registry, candidates, contract } = params;
  const now = params.now ?? new Date().toISOString();

  const contractBrands = new Set(contract.brands.map((brand) => brand.trim()));
  const byName = new Map(registry.brands.map((brand) => [brand.name, { ...brand }]));
  const added: string[] = [];

  for (const candidate of candidates) {
    const name = candidate.name.trim();
    if (!isPlausibleBrand(name)) continue;
    if (contractBrands.has(name)) continue;

    const existing = byName.get(name);
    if (existing) {
      existing.seenCount += 1;
      continue;
    }
    byName.set(name, {
      name,
      evidence: candidate.evidence,
      registeredAt: now,
      seenCount: 1,
    });
    added.push(name);
  }

  const brands = [...byName.values()]
    .sort((left, right) => right.seenCount - left.seenCount)
    .slice(0, MAX_REGISTERED_BRANDS);

  return { registry: { schemaVersion: 1, brands, updatedAt: now }, added };
}

export function withRegisteredBrands(
  contract: DomainContract,
  registry: BrandRegistry
): DomainContract {
  const names = registry.brands.map((brand) => brand.name);
  if (names.length === 0) return contract;
  return { ...contract, brands: [...new Set([...contract.brands, ...names])] };
}
