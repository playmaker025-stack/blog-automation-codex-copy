import { getGitHubClient, getRepoConfig } from "./client";

export interface FileContent {
  content: string;
  sha: string;
}

export interface FileEntry {
  name: string;
  path: string;
  sha: string;
  type: "file" | "dir";
}

const GITHUB_TIMEOUT_MS = 15_000;

export async function readFile(filePath: string): Promise<FileContent> {
  const octokit = getGitHubClient();
  const { owner, repo, branch } = getRepoConfig();

  const response = await octokit.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref: branch,
    request: { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) },
  });

  const data = response.data;
  if (Array.isArray(data) || data.type !== "file") {
    const actualType = Array.isArray(data) ? "dir" : data.type;
    throw new Error(
      `"${filePath}" 경로가 파일이 아닙니다. ` +
      `현재 데이터 저장소: ${owner}/${repo}@${branch}, 실제 타입: ${actualType}. ` +
      `Railway Variables의 GITHUB_DATA_REPO/GITHUB_DATA_REPO_BRANCH가 맞는지 확인하고, ` +
      `GitHub 웹에서 같은 이름의 폴더가 있으면 삭제해 주세요.`
    );
  }

  // GitHub API는 1MB 초과 파일의 경우 content를 빈 문자열로 반환
  if (!data.content || data.encoding !== "base64") {
    throw new Error(
      `"${filePath}" 파일이 너무 크거나 인코딩이 예상과 다릅니다 (size: ${data.size}, encoding: ${data.encoding ?? "none"}). ` +
      `GitHub API는 1MB 초과 파일은 직접 읽을 수 없습니다.`
    );
  }
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

export async function readJsonFile<T>(filePath: string): Promise<{ data: T; sha: string }> {
  const { content, sha } = await readFile(filePath);
  return { data: JSON.parse(content) as T, sha };
}

export async function writeFile(
  filePath: string,
  content: string,
  message: string,
  sha: string | null = null
): Promise<string> {
  const octokit = getGitHubClient();
  const { owner, repo, branch } = getRepoConfig();

  const encoded = Buffer.from(content, "utf-8").toString("base64");
  const commitMessage = message.includes("[skip ci]") ? message : `${message} [skip ci]`;

  const response = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: commitMessage,
    content: encoded,
    branch,
    ...(sha ? { sha } : {}),
    request: { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) },
  });

  return response.data.content?.sha ?? "";
}

export async function writeJsonFile<T>(
  filePath: string,
  data: T,
  message: string,
  sha: string | null = null
): Promise<string> {
  const content = JSON.stringify(data, null, 2);
  return writeFile(filePath, content, message, sha);
}

export interface FileWrite {
  path: string;
  content: string;
}

/** 트리 하나에 파일을 여러 개 얹으므로 단건 쓰기보다 오래 걸린다. */
const BATCH_TIMEOUT_MS = 40_000;

/**
 * 파일 여러 개를 커밋 하나로 쓴다.
 *
 * 단건 API(createOrUpdateFileContents)는 파일마다 커밋을 만든다. 관측치처럼
 * 한 번에 수십 건이 나오는 쓰기에 그걸 쓰면 커밋 수십 개가 쌓이고, 그 사이
 * 다른 쓰기가 끼어들어 sha가 어긋난다. 사양 후보 일괄 승인에서 이미 겪었다.
 *
 * 브랜치가 그새 움직였으면 updateRef가 실패한다(422). 여기서 되받아 재시도하지
 * 않는 이유: 재시도하려면 그 시점 값 위에 다시 얹어야 하는데, 무엇을 어떻게
 * 얹을지는 호출한 쪽만 안다. 충돌은 그대로 던지고 호출자가 다시 읽어서 넘긴다.
 */
export async function writeFiles(
  files: FileWrite[],
  message: string
): Promise<{ commitSha: string; written: number }> {
  if (files.length === 0) return { commitSha: "", written: 0 };

  const octokit = getGitHubClient();
  const { owner, repo, branch } = getRepoConfig();
  const commitMessage = message.includes("[skip ci]") ? message : `${message} [skip ci]`;
  const request = { signal: AbortSignal.timeout(BATCH_TIMEOUT_MS) };

  const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}`, request });
  const baseCommitSha = ref.data.object.sha;
  const baseCommit = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseCommitSha,
    request,
  });

  const tree = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.data.tree.sha,
    tree: files.map((file) => ({
      path: file.path,
      mode: "100644" as const,
      type: "blob" as const,
      content: file.content,
    })),
    request,
  });

  const commit = await octokit.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: tree.data.sha,
    parents: [baseCommitSha],
    request,
  });

  // force는 쓰지 않는다. 그 사이 들어온 커밋을 지우느니 실패하는 게 낫다.
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
    force: false,
    request,
  });

  return { commitSha: commit.data.sha, written: files.length };
}

/** 브랜치가 움직여서 밀린 것인지. 이건 다시 읽고 다시 얹으면 되는 실패다. */
export function isRefConflict(error: unknown): boolean {
  if (!(error instanceof Error) || !("status" in error)) return false;
  const status = (error as { status?: number }).status;
  return status === 409 || status === 422;
}

/**
 * 없으면 null. 있으면 내용.
 *
 * fileExists + readFile은 같은 파일을 두 번 내려받는다 — fileExists 자체가
 * readFile이기 때문이다. 발행 목록(383KB)처럼 큰 파일에서는 저장 한 번마다
 * 왕복이 하나 더 생긴다. 있는지 없는지가 궁금하면 그냥 한 번 읽어라.
 */
export async function readFileOrNull(filePath: string): Promise<FileContent | null> {
  try {
    return await readFile(filePath);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "status" in err &&
      (err as { status: number }).status === 404
    ) {
      return false;
    }
    throw err;
  }
}

export async function listFiles(dirPath: string): Promise<FileEntry[]> {
  const octokit = getGitHubClient();
  const { owner, repo, branch } = getRepoConfig();

  const response = await octokit.repos.getContent({
    owner,
    repo,
    path: dirPath,
    ref: branch,
    request: { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) },
  });

  const data = response.data;
  if (!Array.isArray(data)) {
    throw new Error(`"${dirPath}" 경로가 디렉터리가 아닙니다.`);
  }

  return data.map((item) => ({
    name: item.name,
    path: item.path,
    sha: item.sha,
    type: item.type as "file" | "dir",
  }));
}
