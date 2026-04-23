import { fileExists, readJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { PostingIndex, PostingRecord, Topic, TopicIndex } from "@/lib/types/github-data";

const BLOCKING_POST_STATUSES = new Set<PostingRecord["status"]>([
  "ready",
  "approved",
  "published",
]);

export interface SimilarPostMatch {
  postId: string;
  topicId: string;
  title: string;
  status: PostingRecord["status"];
  similarity: number;
}

export interface PreflightCheckInput {
  topicId: string;
  proposedTitle?: string;
}

export interface PreflightCheckResult {
  passed: boolean;
  topic: Topic | null;
  checkedFiles: string[];
  blockingReasons: string[];
  similarPosts: SimilarPostMatch[];
}

export interface PreflightAssertOptions {
  allowOverride?: boolean;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value: string): Set<string> {
  const compact = normalizeTitle(value).replace(/\s+/g, "");
  const out = new Set<string>();
  if (compact.length <= 1) {
    if (compact) out.add(compact);
    return out;
  }
  for (let i = 0; i < compact.length - 1; i++) out.add(compact.slice(i, i + 2));
  return out;
}

function similarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

async function loadRequiredIndex<T>(path: string, label: string): Promise<T> {
  if (!(await fileExists(path))) {
    throw new Error(`${label} is missing: ${path}`);
  }
  const { data } = await readJsonFile<T>(path);
  return data;
}

export async function runPreflightCheck(input: PreflightCheckInput): Promise<PreflightCheckResult> {
  const checkedFiles = [Paths.topicsIndex(), Paths.postingListIndex()];
  const blockingReasons: string[] = [];
  const similarPosts: SimilarPostMatch[] = [];

  let topicsIndex: TopicIndex | null = null;
  let postingIndex: PostingIndex | null = null;

  try {
    topicsIndex = await loadRequiredIndex<TopicIndex>(Paths.topicsIndex(), "topics.json");
  } catch (err) {
    blockingReasons.push(err instanceof Error ? err.message : "topics.json read failed");
  }

  try {
    postingIndex = await loadRequiredIndex<PostingIndex>(Paths.postingListIndex(), "posting-list/index.json");
  } catch (err) {
    blockingReasons.push(err instanceof Error ? err.message : "posting-list/index.json read failed");
  }

  const topic = topicsIndex?.topics.find((item) => item.topicId === input.topicId) ?? null;
  if (!topic) {
    blockingReasons.push(`topicId not found in topics.json: ${input.topicId}`);
  }

  if (topic && postingIndex) {
    const existingForTopic = postingIndex.posts.filter(
      (post) => post.topicId === topic.topicId && BLOCKING_POST_STATUSES.has(post.status)
    );
    if (existingForTopic.length > 0) {
      blockingReasons.push(
        `Same topicId already has ${existingForTopic.map((post) => `${post.status}:${post.postId}`).join(", ")}`
      );
    }

    const candidateTitle = input.proposedTitle?.trim() || topic.title;
    for (const post of postingIndex.posts) {
      if (!BLOCKING_POST_STATUSES.has(post.status)) continue;
      const score = similarity(candidateTitle, post.title);
      if (score >= 0.72 || normalizeTitle(candidateTitle) === normalizeTitle(post.title)) {
        similarPosts.push({
          postId: post.postId,
          topicId: post.topicId,
          title: post.title,
          status: post.status,
          similarity: Number(score.toFixed(3)),
        });
      }
    }

    if (similarPosts.length > 0) {
      blockingReasons.push(
        `Similar existing title found: ${similarPosts
          .slice(0, 3)
          .map((post) => `${post.title} (${post.status}, ${post.similarity})`)
          .join("; ")}`
      );
    }
  }

  return {
    passed: blockingReasons.length === 0,
    topic,
    checkedFiles,
    blockingReasons,
    similarPosts,
  };
}

export async function assertPreflightPassed(
  input: PreflightCheckInput,
  options: PreflightAssertOptions = {}
): Promise<PreflightCheckResult> {
  const result = await runPreflightCheck(input);
  if (!result.passed && !options.allowOverride) {
    throw new Error(`Preflight check blocked writing: ${result.blockingReasons.join(" / ")}`);
  }
  return result;
}
