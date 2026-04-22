import { Octokit } from "@octokit/rest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const indexPath = path.join(repoRoot, "data", "posting-list", "index.json");
const targetPath = "data/posting-list/index.json";

function parseRepo(value) {
  const [owner, repo] = String(value ?? "").split("/");
  if (!owner || !repo) {
    throw new Error("GITHUB_DATA_REPO must be in owner/repo format.");
  }
  return { owner, repo };
}

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required.");

const { owner, repo } = parseRepo(process.env.GITHUB_DATA_REPO);
const branch = process.env.GITHUB_DATA_REPO_BRANCH || "main";
const octokit = new Octokit({ auth: token, request: { timeout: 20_000 } });
const content = fs.readFileSync(indexPath, "utf8");
let sha;

try {
  const response = await octokit.repos.getContent({
    owner,
    repo,
    path: targetPath,
    ref: branch,
  });
  if (!Array.isArray(response.data) && response.data.type === "file") {
    sha = response.data.sha;
  }
} catch (error) {
  if (error?.status !== 404) throw error;
}

await octokit.repos.createOrUpdateFileContents({
  owner,
  repo,
  path: targetPath,
  branch,
  sha,
  message: "chore: sync posting index from Codex import [skip ci]",
  content: Buffer.from(content, "utf8").toString("base64"),
});

const parsed = JSON.parse(content);
console.log(`Synced ${parsed.posts?.length ?? 0} posts to ${owner}/${repo}:${targetPath}`);
