/**
 * product-spec-store — 제품 사양 원장의 GitHub 저장/불러오기 (I/O 담당).
 *
 * 검사 로직은 product-specs.ts에 순수 함수로 있다.
 * (하네스 테스트가 "@/" 런타임 import를 못 읽어서 순수/IO를 나눈다.)
 *
 * 원장이 없거나 깨져도 파이프라인을 막지 않는다. 빈 원장이면 검사기가
 * "미확인 사양 주장"만 경고로 올린다 — 데이터가 없어도 안전한 쪽으로 동작한다.
 */

import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import {
  emptySpecRegistry,
  SPEC_REGISTRY_VERSION,
  type ProductSpec,
  type ProductSpecRegistry,
} from "./product-specs";

export async function loadProductSpecs(): Promise<{
  data: ProductSpecRegistry;
  sha: string | null;
}> {
  const path = Paths.productSpecs();
  if (!(await fileExists(path))) return { data: emptySpecRegistry(), sha: null };
  try {
    const { data, sha } = await readJsonFile<ProductSpecRegistry>(path);
    return { data: normalize(data), sha };
  } catch {
    return { data: emptySpecRegistry(), sha: null };
  }
}

function normalize(raw: Partial<ProductSpecRegistry> | null): ProductSpecRegistry {
  const base = emptySpecRegistry();
  if (!raw || typeof raw !== "object") return base;
  return {
    version: SPEC_REGISTRY_VERSION,
    products: Array.isArray(raw.products) ? raw.products : [],
    // 업종 규칙을 여기서 빠뜨리면 원장을 읽고 다시 쓰는 모든 경로가(일괄 승인,
    // 직접 편집) 규칙을 조용히 지운다. 실제로 그렇게 사라졌다.
    ...(Array.isArray(raw.domainNotes) ? { domainNotes: raw.domainNotes } : {}),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

/**
 * 제품 하나를 등록하거나 갱신한다. 사용자 명시 동작이라 실패를 던진다.
 *
 * 같은 이름이 있으면 덮어쓴다 — 사양은 누적이 아니라 최신값이 맞다.
 */
export async function upsertProductSpec(spec: ProductSpec): Promise<ProductSpecRegistry> {
  const { data, sha } = await loadProductSpecs();
  const products = [...data.products.filter((p) => p.name !== spec.name), spec].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const next: ProductSpecRegistry = {
    version: SPEC_REGISTRY_VERSION,
    products,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile<ProductSpecRegistry>(
    Paths.productSpecs(),
    next,
    `chore(specs): ${spec.name} 사양 등록`,
    sha
  );
  return next;
}
