/**
 * spec-candidate-store — 사양 후보 대기함의 GitHub I/O.
 *
 * 병합·판정 로직은 spec-candidates.ts에 순수 함수로 있다.
 * (하네스 테스트가 "@/" 런타임 import를 못 읽어서 순수/IO를 나눈다.)
 */

import { fileExists, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import {
  CANDIDATE_STORE_VERSION,
  emptyCandidateStore,
  type SpecCandidateStore,
} from "./spec-candidates";

export async function loadSpecCandidates(): Promise<{
  data: SpecCandidateStore;
  sha: string | null;
}> {
  const path = Paths.productSpecCandidates();
  if (!(await fileExists(path))) return { data: emptyCandidateStore(), sha: null };
  try {
    const { data, sha } = await readJsonFile<SpecCandidateStore>(path);
    return {
      data: {
        version: CANDIDATE_STORE_VERSION,
        candidates: Array.isArray(data?.candidates) ? data.candidates : [],
        updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
      },
      sha,
    };
  } catch {
    return { data: emptyCandidateStore(), sha: null };
  }
}

export async function saveSpecCandidates(
  store: SpecCandidateStore,
  sha: string | null,
  message: string
): Promise<void> {
  await writeJsonFile<SpecCandidateStore>(Paths.productSpecCandidates(), store, message, sha);
}
