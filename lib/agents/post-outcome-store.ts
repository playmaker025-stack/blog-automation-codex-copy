/**
 * post-outcome-store — 관측치 읽기/쓰기.
 *
 * 판단 로직은 post-outcome.ts에 순수 함수로 있다. 여기는 저장소만 다룬다.
 *
 * 관측치는 글마다 파일을 따로 쌓는다. 발행 목록은 index.json 하나를 통째로
 * 읽고 쓰는 구조라, 거기에 관측 배열을 넣으면 수집기와 북마클릿이 같은 글을
 * 갱신할 때 서로 덮어쓴다. 실제로 오늘 프로필 재학습에서 그 충돌을 겪었다.
 */

import { fileExists, listFiles, readJsonFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import {
  summarizeOutcomes,
  type OutcomeSummary,
  type PostOutcomeObservation,
} from "./post-outcome.ts";

/**
 * 관측치를 새 파일로 남긴다.
 *
 * 이미 있는 아이디면 덮어쓰지 않고 그대로 둔다 — 관측은 사실이지 상태가 아니다.
 * 같은 시점에 같은 검색어를 두 번 재면 그건 중복이지 갱신이 아니다.
 */
export async function recordObservation(
  observation: PostOutcomeObservation
): Promise<{ written: boolean; path: string }> {
  const path = Paths.postOutcome(observation.postId, observation.observationId);
  if (await fileExists(path)) return { written: false, path };

  await writeJsonFile(
    path,
    observation,
    `chore(outcome): ${observation.postId} ${observation.source} ${observation.status}`
  );
  return { written: true, path };
}

export async function loadObservations(postId: string): Promise<PostOutcomeObservation[]> {
  const dir = Paths.postOutcomeDir(postId);
  const entries = await listFiles(dir).catch(() => []);
  const jsonFiles = entries.filter((entry) => entry.name?.endsWith(".json"));

  const loaded = await Promise.all(
    jsonFiles.map((entry) =>
      readJsonFile<PostOutcomeObservation>(`${dir}/${entry.name}`)
        .then((result) => result.data)
        .catch(() => null)
    )
  );

  return loaded.filter((item): item is PostOutcomeObservation => item !== null);
}

export async function loadOutcomeSummary(postId: string): Promise<OutcomeSummary> {
  return summarizeOutcomes(await loadObservations(postId));
}

/** 여러 글을 한 번에. GitHub 왕복이 많아지므로 묶어서 읽는다. */
const SUMMARY_CONCURRENCY = 5;

export async function loadOutcomeSummaries(
  postIds: string[]
): Promise<Map<string, OutcomeSummary>> {
  const result = new Map<string, OutcomeSummary>();
  for (let offset = 0; offset < postIds.length; offset += SUMMARY_CONCURRENCY) {
    const batch = postIds.slice(offset, offset + SUMMARY_CONCURRENCY);
    const summaries = await Promise.all(
      batch.map(async (postId) => [postId, await loadOutcomeSummary(postId)] as const)
    );
    for (const [postId, summary] of summaries) result.set(postId, summary);
  }
  return result;
}
