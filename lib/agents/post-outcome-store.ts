/**
 * post-outcome-store — 관측치 읽기/쓰기.
 *
 * 판단 로직은 post-outcome.ts에 순수 함수로 있다. 여기는 저장소만 다룬다.
 *
 * 관측치는 글마다 파일을 따로 쌓는다. 발행 목록은 index.json 하나를 통째로
 * 읽고 쓰는 구조라, 거기에 관측 배열을 넣으면 수집기와 북마클릿이 같은 글을
 * 갱신할 때 서로 덮어쓴다. 실제로 오늘 프로필 재학습에서 그 충돌을 겪었다.
 */

import {
  fileExists,
  isRefConflict,
  listFiles,
  readJsonFile,
  writeFiles,
  writeJsonFile,
} from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import {
  applyObservationsToIndex,
  emptyOutcomeIndex,
  indexEntryFromObservations,
  summarizeOutcomes,
  nextCollectorHealth,
  OUTCOME_INDEX_VERSION,
  type OutcomeIndex,
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

  // 색인까지 같은 커밋에 얹으려면 일괄 경로를 그대로 쓴다. 여기서 색인을 빼먹으면
  // 사람이 손으로 넣은 관측을 수집기가 모르고 같은 시점을 다시 잰다.
  await recordObservations([observation]);
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

// ── 관측 색인 ─────────────────────────────────────────────

/**
 * 색인을 읽는다. 없으면 관측치 폴더를 훑어 만들어 둔다.
 *
 * 색인은 캐시지 원본이 아니다. 지워도 여기서 다시 만들어진다 — 그래서 색인이
 * 틀어졌다는 의심이 들면 그냥 지우면 된다.
 */
export async function ensureOutcomeIndex(): Promise<OutcomeIndex> {
  const existing = await readJsonFile<OutcomeIndex>(Paths.outcomeIndex())
    .then((result) => result.data)
    .catch(() => null);
  // 판이 낡았으면 원본에서 다시 만든다. 색인은 캐시라 언제든 버릴 수 있다.
  if (existing?.posts && existing.schemaVersion === OUTCOME_INDEX_VERSION) return existing;

  const rebuilt = await rebuildOutcomeIndex();
  await writeJsonFile(
    Paths.outcomeIndex(),
    rebuilt,
    `chore(outcome): 관측 색인 재생성 (${Object.keys(rebuilt.posts).length}건)`
  ).catch(() => "");
  return rebuilt;
}

/** 관측치 원본만 보고 색인을 다시 만든다. 글 수만큼 왕복하므로 자주 하지 않는다. */
export async function rebuildOutcomeIndex(): Promise<OutcomeIndex> {
  const entries = await listFiles("data/outcomes").catch(() => []);
  const postIds = entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);

  const index = emptyOutcomeIndex();
  for (const postId of postIds) {
    const entry = indexEntryFromObservations(await loadObservations(postId).catch(() => []));
    if (entry) index.posts[postId] = entry;
  }
  index.updatedAt = new Date().toISOString();
  return index;
}

const INDEX_CONFLICT_RETRIES = 3;

/**
 * 관측치 여러 건을 커밋 하나로 남긴다.
 *
 * 한 건당 커밋 하나로 쓰면 한 바퀴에 커밋이 열몇 개씩 쌓이고, GitHub 왕복도
 * 그만큼 늘어난다. 색인은 같은 커밋에 함께 얹는다 — 관측치는 들어갔는데
 * 색인은 안 들어간 상태가 되면 다음 회차가 같은 시점을 다시 잰다.
 *
 * 그 사이 다른 쓰기가 브랜치를 움직였으면 색인을 다시 읽어 그 위에 얹고
 * 다시 시도한다. 실패한 커밋의 관측치 파일은 아직 저장소에 없으므로 잃는 게 없다.
 */
export async function recordObservations(
  observations: PostOutcomeObservation[],
  run?: { ranAt: string; attempted: number; anyOk: boolean }
): Promise<{ written: number; commitSha: string; index: OutcomeIndex }> {
  const unique = new Map<string, PostOutcomeObservation>();
  for (const observation of observations) {
    unique.set(Paths.postOutcome(observation.postId, observation.observationId), observation);
  }
  // 한 건도 못 잰 회차도 기록해야 한다. 아무것도 안 남기면 "조용히 멈춘 것"과
  // "잴 게 없어서 안 잰 것"이 구분되지 않는다.
  if (unique.size === 0 && !run) {
    return { written: 0, commitSha: "", index: await ensureOutcomeIndex() };
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < INDEX_CONFLICT_RETRIES; attempt += 1) {
    const index = await ensureOutcomeIndex();
    const merged = withHealth(applyObservationsToIndex(index, [...unique.values()]), run);

    const files = [...unique.entries()].map(([path, observation]) => ({
      path,
      content: JSON.stringify(observation, null, 2),
    }));
    files.push({ path: Paths.outcomeIndex(), content: JSON.stringify(merged, null, 2) });

    try {
      const result = await writeFiles(
        files,
        unique.size > 0
          ? `chore(outcome): 관측 ${unique.size}건 기록`
          : "chore(outcome): 잴 것이 없는 회차 기록"
      );
      return { written: unique.size, commitSha: result.commitSha, index: merged };
    } catch (error) {
      if (!isRefConflict(error)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("관측치를 기록하지 못했습니다 (브랜치 충돌).");
}

/**
 * 수집기가 살아 있다는 흔적을 색인에 같이 남긴다.
 *
 * 메모리에만 두면 앱이 한 번 재시작될 때 사라진다. "마지막으로 성공한 게
 * 언제인가"는 사람이 안 보는 기능에서 유일하게 믿을 수 있는 신호다.
 */
function withHealth(
  index: OutcomeIndex,
  run?: { ranAt: string; attempted: number; anyOk: boolean }
): OutcomeIndex {
  if (!run) return index;
  return { ...index, health: nextCollectorHealth(index.health, run) };
}
