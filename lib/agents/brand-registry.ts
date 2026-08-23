/**
 * brand-registry — LLM이 추출한 제품명을 자동 등록한다 (I/O 담당).
 *
 * 왜 자동인가:
 * 처음에는 domain-contract.ts에 제품명을 손으로 적어뒀다. 그런데 이 업종은 신제품이
 * 자주 들어오고, 신제품 입고 직후가 글 쓰기 제일 좋은 타이밍이다. 코드 수정과 배포를
 * 거쳐야 주제가 나오는 건 운영상 병목이었다.
 *
 * 자동 등록의 위험은 잘못 뽑힌 항목이 조용히 들어오는 것이다. 그래서 출처를 함께
 * 남긴다. 이상한 항목이 보이면 어느 글에서 왔는지 추적해서 뺄 수 있다.
 *
 * 발행 이력에서 빈도로 뽑지 않는다는 점이 중요하다. 빈도 기반이면 오염된 제목 하나가
 * 제품명으로 승격되지만, LLM 개체 추출은 "이건 전자담배 제품이 아니다"를 판단한다.
 *
 * 병합 규칙은 brand-merge.ts에 있다.
 */

import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { emptyRegistry, type BrandRegistry } from "./brand-merge";

export { emptyRegistry, mergeBrandCandidates, withRegisteredBrands } from "./brand-merge";
export type { BrandRegistry, RegisteredBrand } from "./brand-merge";

export async function loadBrandRegistry(): Promise<{ data: BrandRegistry; sha: string | null }> {
  const path = Paths.domainBrands();
  if (!(await fileExists(path))) return { data: emptyRegistry(), sha: null };
  try {
    return await readJsonFile<BrandRegistry>(path);
  } catch {
    return { data: emptyRegistry(), sha: null };
  }
}

/**
 * 추출된 제품명을 기존 등록부와 합친다. 순수 함수라 테스트할 수 있다.
 * 이미 있으면 seenCount만 올리고, 계약에 이미 있는 이름은 등록하지 않는다.
 */
export async function saveBrandRegistry(registry: BrandRegistry, sha: string | null): Promise<void> {
  try {
    await writeJsonFile<BrandRegistry>(
      Paths.domainBrands(),
      registry,
      `chore: register ${registry.brands.length} domain brands`,
      sha
    );
  } catch (error) {
    // 등록 실패가 파이프라인을 막으면 안 된다. 다음 회차에 다시 시도된다.
    console.warn("[brand-registry] 저장 실패:", String(error));
  }
}

/** 계약에 등록부를 얹는다. 계약이 루트이고 등록부는 확장이다. */
