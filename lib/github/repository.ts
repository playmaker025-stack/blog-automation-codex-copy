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
    throw new Error(`"${filePath}" 경로가 파일이 아닙니다. GitHub 데이터 저장소에서 같은 이름의 폴더가 있는지 확인해 주세요.`);
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
