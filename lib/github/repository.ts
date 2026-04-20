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

// GitHub API timeout guard.
const GITHUB_TIMEOUT_MS = 15_000;

// ============================================================
// ?뚯씪 ?쎄린
// ============================================================

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
    throw new Error(`"${filePath}"???뚯씪???꾨떃?덈떎.`);
  }

  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

export async function readJsonFile<T>(filePath: string): Promise<{ data: T; sha: string }> {
  const { content, sha } = await readFile(filePath);
  return { data: JSON.parse(content) as T, sha };
}

// ============================================================
// ?뚯씪 ?곌린 (?앹꽦 ?먮뒗 ?낅뜲?댄듃)
// ============================================================

export async function writeFile(
  filePath: string,
  content: string,
  message: string,
  sha: string | null = null
): Promise<string> {
  const octokit = getGitHubClient();
  const { owner, repo, branch } = getRepoConfig();

  const encoded = Buffer.from(content, "utf-8").toString("base64");

  // Keep data commits from triggering Railway deploys.
  const commitMessage = message.includes("[skip ci]")
    ? message
    : `${message} [skip ci]`;

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

// ============================================================
// ?뚯씪 議댁옱 ?щ? ?뺤씤
// ============================================================

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

// ============================================================
// ?붾젆?좊━ ???뚯씪 紐⑸줉
// ============================================================

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
    throw new Error(`"${dirPath}"???붾젆?좊━媛 ?꾨떃?덈떎.`);
  }

  return data.map((item) => ({
    name: item.name,
    path: item.path,
    sha: item.sha,
    type: item.type as "file" | "dir",
  }));
}
