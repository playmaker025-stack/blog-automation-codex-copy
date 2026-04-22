import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const indexPath = path.join(repoRoot, "data", "posting-list", "index.json");

function usage() {
  console.error("Usage: node scripts/import-posting-index.mjs <index-file.txt> [--dry-run]");
  process.exit(1);
}

function parseTsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.startsWith("\uFEFF") ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === "\t") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeTitle(value) {
  return normalizeSpaces(value).toLowerCase();
}

function dateToIso(value) {
  const date = normalizeSpaces(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : null;
}

function stablePostId(row) {
  const seed = normalizeUrl(row.url) || normalizeTitle(row.title);
  return `post-import-${createHash("sha1").update(seed).digest("hex").slice(0, 10)}`;
}

function parseImportRows(text) {
  const parsed = [];
  const warnings = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  let duplicatesInFile = 0;
  let failed = 0;

  for (const cols of parseTsvRows(text)) {
    const no = normalizeSpaces(cols[0]);
    if (!/^\d+$/.test(no)) continue;

    const blog = normalizeSpaces(cols[1]).toUpperCase();
    const userId = /^[A-E]$/.test(blog) ? blog.toLowerCase() : "imported";
    const publishedAt = dateToIso(cols[2]);
    const c3 = normalizeSpaces(cols[3]);
    const c4 = normalizeSpaces(cols[4]);

    const title = c3.startsWith("http") ? c4 : c3;
    const url = c3.startsWith("http") ? c3 : c4.startsWith("http") ? c4 : "";
    const urlKey = normalizeUrl(url);
    const titleKey = normalizeTitle(title);

    if (!titleKey) {
      failed += 1;
      warnings.push(`Row ${no}: missing title`);
      continue;
    }
    if ((urlKey && seenUrls.has(urlKey)) || seenTitles.has(titleKey)) {
      duplicatesInFile += 1;
      warnings.push(`Row ${no}: duplicate in import file (${title})`);
      continue;
    }

    if (urlKey) seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    parsed.push({
      rowNo: Number(no),
      userId,
      title,
      naverPostUrl: url || null,
      publishedAt,
    });
  }

  return { parsed, duplicatesInFile, failed, warnings };
}

function hasMeaningfulChange(before, after) {
  return [
    "userId",
    "title",
    "status",
    "naverPostUrl",
    "publishedAt",
  ].some((key) => before[key] !== after[key]);
}

function mergeIndex(existingIndex, importedRows) {
  const now = new Date().toISOString();
  const posts = Array.isArray(existingIndex.posts) ? existingIndex.posts : [];
  const byUrl = new Map();
  const byTitle = new Map();

  for (const post of posts) {
    const urlKey = normalizeUrl(post.naverPostUrl);
    const titleKey = normalizeTitle(post.title);
    if (urlKey && !byUrl.has(urlKey)) byUrl.set(urlKey, post);
    if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, post);
  }

  const consumedIds = new Set();
  const importedPosts = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of importedRows) {
    const urlKey = normalizeUrl(row.naverPostUrl);
    const titleKey = normalizeTitle(row.title);
    const existing = (urlKey && byUrl.get(urlKey)) || byTitle.get(titleKey);
    const base = existing ?? {
      postId: stablePostId(row),
      topicId: "",
      evalScore: null,
      wordCount: 0,
      compositionSessionId: null,
      pendingApproval: null,
      createdAt: row.publishedAt ?? now,
    };
    const candidate = {
      ...base,
      userId: row.userId,
      title: row.title,
      status: "published",
      naverPostUrl: row.naverPostUrl,
      evalScore: base.evalScore ?? null,
      wordCount: base.wordCount ?? 0,
      compositionSessionId: base.compositionSessionId ?? null,
      pendingApproval: base.pendingApproval ?? null,
      createdAt: base.createdAt ?? row.publishedAt ?? now,
      publishedAt: row.publishedAt ?? base.publishedAt ?? null,
    };
    const merged = {
      ...candidate,
      updatedAt: existing && !hasMeaningfulChange(existing, candidate) ? existing.updatedAt ?? now : now,
    };

    if (existing) {
      consumedIds.add(existing.postId);
      if (hasMeaningfulChange(existing, candidate)) updated += 1;
      else unchanged += 1;
    } else {
      added += 1;
    }

    importedPosts.push(merged);
  }

  const retainedPosts = posts.filter((post) => !consumedIds.has(post.postId));
  return {
    index: {
      posts: [...importedPosts, ...retainedPosts],
      lastUpdated: now,
    },
    stats: {
      before: posts.length,
      imported: importedRows.length,
      added,
      updated,
      unchanged,
      retained: retainedPosts.length,
      after: importedPosts.length + retainedPosts.length,
    },
  };
}

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
if (!inputPath) usage();

const text = fs.readFileSync(inputPath, "utf8");
const existingIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const { parsed, duplicatesInFile, failed, warnings } = parseImportRows(text);
const { index, stats } = mergeIndex(existingIndex, parsed);

console.log(JSON.stringify({ ...stats, duplicatesInFile, failed }, null, 2));
if (warnings.length > 0) {
  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 10)) console.log(`- ${warning}`);
}

if (!dryRun) {
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`Updated ${indexPath}`);
}
