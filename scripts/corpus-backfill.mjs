/**
 * corpus-backfill.mjs
 *
 * posting-list의 published 포스트 중 corpus에 없는 것들을 Naver에서 수집해
 * GitHub 데이터 레포에 content.md + corpus index를 업데이트한다.
 *
 * 사용법:
 *   node scripts/corpus-backfill.mjs [--user=a] [--limit=20] [--dry-run]
 *
 * 환경 변수 (필수):
 *   GITHUB_TOKEN, GITHUB_DATA_REPO, GITHUB_DATA_REPO_BRANCH (기본값: main)
 */

import { Octokit } from "@octokit/rest";

// ──────────────────────────────────────────────
// 설정
// ──────────────────────────────────────────────

const ALL_USER_IDS = ["a", "b", "c", "d", "e"];
const NAVER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 28000;
const MIN_CONTENT_LENGTH = 300;
const MAX_CONTENT_LENGTH = 20000;
const MAX_CORPUS_SAMPLES = 30;
const MAX_EXEMPLARS = 30;

// ──────────────────────────────────────────────
// CLI 파싱
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const userArg = args.find((a) => a.startsWith("--user="))?.split("=")[1];
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const limit = limitArg ? parseInt(limitArg, 10) : 20;
const targetUsers = userArg ? [userArg] : ALL_USER_IDS;

if (dryRun) console.log("[dry-run] 실제 저장 없이 시뮬레이션만 실행합니다.");

// ──────────────────────────────────────────────
// GitHub 클라이언트
// ──────────────────────────────────────────────

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN 환경 변수가 필요합니다.");

const repoStr = process.env.GITHUB_DATA_REPO;
if (!repoStr) throw new Error("GITHUB_DATA_REPO 환경 변수가 필요합니다.");
const [owner, repo] = repoStr.split("/");
const branch = process.env.GITHUB_DATA_REPO_BRANCH ?? "main";

const octokit = new Octokit({ auth: token, request: { timeout: 20_000 } });

// ──────────────────────────────────────────────
// GitHub 헬퍼
// ──────────────────────────────────────────────

async function ghRead(path) {
  try {
    const res = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(res.data) || res.data.type !== "file") return null;
    const content = Buffer.from(res.data.content, "base64").toString("utf-8");
    return { content, sha: res.data.sha };
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

async function ghWrite(path, content, message, sha = null) {
  if (dryRun) {
    console.log(`  [dry-run] write → ${path}`);
    return;
  }
  const encoded = Buffer.from(content, "utf-8").toString("base64");
  const fullMessage = message.includes("[skip ci]") ? message : `${message} [skip ci]`;
  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path, branch,
    message: fullMessage,
    content: encoded,
    ...(sha ? { sha } : {}),
  });
}

async function ghReadJson(path) {
  const file = await ghRead(path);
  if (!file) return null;
  return { data: JSON.parse(file.content), sha: file.sha };
}

async function ghWriteJson(path, data, message, sha = null) {
  await ghWrite(path, JSON.stringify(data, null, 2), message, sha);
}

// ──────────────────────────────────────────────
// Naver 본문 수집
// ──────────────────────────────────────────────

async function fetchText(url, timeoutMs = FETCH_TIMEOUT_MS) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": NAVER_UA,
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ko-KR,ko;q=0.9",
          "referer": "https://blog.naver.com/",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      return res.text();
    } catch {
      if (attempt === 1) return null;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}

async function fetchNaverContent(post) {
  const { naverPostUrl, title } = post;
  if (!naverPostUrl || !/^https:\/\/blog\.naver\.com\//i.test(naverPostUrl)) return null;

  const firstHtml = await fetchText(naverPostUrl);
  if (!firstHtml) return null;

  const frameMatch =
    firstHtml.match(/<iframe[^>]+(?:id|name)=["']?mainFrame["']?[^>]+src=["']([^"']+)["']/i) ??
    firstHtml.match(/<iframe[^>]+src=["']([^"']*PostView[^"']+)["']/i);

  let html = null;

  if (frameMatch?.[1]) {
    try {
      const frameUrl = new URL(frameMatch[1], naverPostUrl).toString();
      html = await fetchText(frameUrl);
    } catch { /* ignore */ }
  }

  // fallback: PostView URL 직접 구성
  if (!html || html.length < 500) {
    const m = naverPostUrl.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/);
    if (m) {
      const postViewUrl = `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}&redirect=Dlog&widgetTypeCall=true`;
      const fallback = await fetchText(postViewUrl);
      if (fallback && fallback.length > (html?.length ?? 0)) html = fallback;
    }
  }

  if (!html) html = firstHtml;

  const text = htmlToText(html);
  if (text.length < MIN_CONTENT_LENGTH) return null;

  return `# ${title}\n\n${text.slice(0, MAX_CONTENT_LENGTH)}`;
}

// ──────────────────────────────────────────────
// 경로
// ──────────────────────────────────────────────

const Paths = {
  postingIndex: () => "data/posting-list/index.json",
  postContent: (postId) => `data/posting-list/posts/${postId}/content.md`,
  corpusIndex: (userId) => `user-modeling/users/${userId}/corpus/index.json`,
  corpusSample: (userId, sampleId) => `user-modeling/users/${userId}/corpus/samples/${sampleId}.md`,
  exemplarIndex: (userId) => `user-modeling/users/${userId}/corpus/exemplar_index.json`,
  writingProfile: (userId) => `user-modeling/users/${userId}/writing-profile.json`,
};

// ──────────────────────────────────────────────
// corpus 업데이트
// ──────────────────────────────────────────────

async function updateCorpus(userId, newMeta, newExemplar) {
  const now = new Date().toISOString();

  // corpus index
  const corpusFile = await ghReadJson(Paths.corpusIndex(userId));
  const corpusData = corpusFile?.data ?? { userId, samples: [], lastUpdated: now };
  const sampleMap = new Map(corpusData.samples.map((s) => [s.sampleId, s]));
  sampleMap.set(newMeta.sampleId, newMeta);
  const samples = [...sampleMap.values()]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, MAX_CORPUS_SAMPLES);

  await ghWriteJson(
    Paths.corpusIndex(userId),
    { userId, samples, lastUpdated: now },
    `chore: corpus backfill - add ${newMeta.sampleId}`,
    corpusFile?.sha ?? null,
  );

  // exemplar index
  const exemplarFile = await ghReadJson(Paths.exemplarIndex(userId));
  const exemplarData = exemplarFile?.data ?? { userId, exemplars: [], lastCurated: now };
  const exemplarMap = new Map(exemplarData.exemplars.map((e) => [e.sampleId, e]));
  exemplarMap.set(newExemplar.sampleId, newExemplar);
  const exemplars = [...exemplarMap.values()]
    .sort((a, b) => {
      const d = b.relevanceScore - a.relevanceScore;
      return d !== 0 ? d : new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    })
    .slice(0, MAX_EXEMPLARS);

  await ghWriteJson(
    Paths.exemplarIndex(userId),
    { userId, exemplars, lastCurated: now },
    `chore: corpus backfill - update exemplar index for ${userId}`,
    exemplarFile?.sha ?? null,
  );

  // writing-profile (sourceSampleCount, recentTitles만 빠르게 갱신)
  const profileFile = await ghReadJson(Paths.writingProfile(userId));
  if (profileFile) {
    const profile = profileFile.data;
    const recentTitles = [newMeta.title, ...(profile.recentTitles ?? [])].slice(0, 8);
    const updated = {
      ...profile,
      updatedAt: now,
      sourceSampleCount: samples.length,
      sourceExemplarCount: exemplars.length,
      recentTitles,
    };
    await ghWriteJson(
      Paths.writingProfile(userId),
      updated,
      `chore: corpus backfill - update writing profile for ${userId}`,
      profileFile.sha,
    );
  }
}

// ──────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────

console.log(`\n▶ corpus-backfill 시작 | users: ${targetUsers.join(",")} | limit: ${limit}/user\n`);

const indexFile = await ghReadJson(Paths.postingIndex());
if (!indexFile) throw new Error("posting-list index를 읽을 수 없습니다.");

const allPosts = indexFile.data.posts;
const totals = { synced: 0, skipped: 0, failed: 0 };

for (const userId of targetUsers) {
  console.log(`\n── 사용자 ${userId} ──`);

  const corpusFile = await ghReadJson(Paths.corpusIndex(userId));
  const existingIds = new Set((corpusFile?.data?.samples ?? []).map((s) => s.sampleId));

  const published = allPosts.filter(
    (p) => p.userId === userId && p.status === "published" && p.naverPostUrl,
  );
  const missing = published.filter((p) => !existingIds.has(`published-${p.postId}`));

  console.log(`  발행: ${published.length}개 | corpus 미등록: ${missing.length}개 | 이번 처리: ${Math.min(missing.length, limit)}개`);

  const toProcess = missing.slice(0, limit);
  let userSynced = 0;

  for (const post of toProcess) {
    const sampleId = `published-${post.postId}`;
    process.stdout.write(`  [${post.postId}] ${post.title.slice(0, 40)}... `);

    // content.md가 이미 있으면 재사용
    const existingContent = await ghRead(Paths.postContent(post.postId));
    let content = existingContent?.content ?? null;

    if (!content) {
      content = await fetchNaverContent(post);
      if (content) {
        await ghWrite(
          Paths.postContent(post.postId),
          content,
          `chore: cache naver content ${post.postId}`,
        );
      }
    }

    if (!content) {
      console.log("✗ fetch 실패");
      totals.failed++;
      continue;
    }

    const meta = {
      sampleId,
      title: post.title,
      category: "발행 글 샘플",
      tags: ["실제 발행 글", "문체 참고"],
      wordCount: post.wordCount > 0 ? post.wordCount : content.length,
      publishedAt: post.publishedAt ?? post.updatedAt,
      filePath: Paths.corpusSample(userId, sampleId),
    };

    const excerpt = content.replace(/^#+\s*/gm, "").replace(/[`>*_~-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    const exemplar = {
      sampleId,
      title: post.title,
      category: meta.category,
      tags: meta.tags,
      relevanceScore: Math.max(0.35, Math.min(0.99, (post.evalScore ?? 70) / 100)),
      styleNotes: "tone=friendly, contentKind=published",
      excerpt,
      wordCount: meta.wordCount,
      publishedAt: meta.publishedAt,
    };

    // corpus sample 파일
    await ghWrite(
      Paths.corpusSample(userId, sampleId),
      content,
      `chore: corpus backfill sample ${sampleId}`,
    );

    // corpus/exemplar/writing-profile 업데이트
    await updateCorpus(userId, meta, exemplar);

    console.log(`✓ (${Math.round(content.length / 100) / 10}KB)`);
    userSynced++;
    totals.synced++;

    // GitHub API rate limit 방지
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`  → ${userSynced}개 동기화 완료`);
}

console.log(`\n▶ 완료: synced=${totals.synced}, skipped=${totals.skipped}, failed=${totals.failed}\n`);
