import { normalizeUserId } from "@/lib/utils/normalize";
import { blogCode } from "@/lib/utils/blog-code";
import type { Topic, PostingRecord } from "@/lib/types/github-data";

export interface ResolveResult {
  remaining: Topic[];
  matched: Topic[];
  remaining_count: number;
  matched_count: number;
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTitle(value: string): string {
  return normalizeTitle(value).replace(/\s+/g, "");
}

function titleTokens(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function titleLooksMatched(topicTitle: string, postTitle: string): boolean {
  const topicCompact = compactTitle(topicTitle);
  const postCompact = compactTitle(postTitle);
  if (!topicCompact || !postCompact) return false;
  if (topicCompact === postCompact) return true;

  const shorter = topicCompact.length <= postCompact.length ? topicCompact : postCompact;
  const longer = topicCompact.length > postCompact.length ? topicCompact : postCompact;
  if (shorter.length >= 10 && longer.includes(shorter)) return true;

  const topicTokens = titleTokens(topicTitle);
  const postTokens = titleTokens(postTitle);
  if (topicTokens.length === 0 || postTokens.length === 0) return false;

  const postSet = new Set(postTokens);
  const shared = topicTokens.filter((token) => postSet.has(token)).length;
  const coverage = shared / Math.min(topicTokens.length, postTokens.length);
  return shared >= 3 && coverage >= 0.75;
}

function topicUserId(topic: Topic): string {
  const assigned = normalizeUserId(topic.assignedUserId ?? "");
  if (assigned) return assigned;

  const categoryBlog = /^([a-e])(?:\s*(?:blog|블로그))?$/i.exec(topic.category.trim())?.[1];
  const inferredBlog = categoryBlog ?? blogCode(topic.category);
  return inferredBlog ? normalizeUserId(inferredBlog.toLowerCase()) : "";
}

function sameUserOrUnknown(topic: Topic, post: PostingRecord): boolean {
  const topicUid = topicUserId(topic);
  const postUid = normalizeUserId(post.userId);
  return !topicUid || !postUid || topicUid === postUid;
}

function matchesPublishedIndex(topic: Topic, post: PostingRecord): boolean {
  if (post.status !== "published") return false;
  if (post.topicId && post.topicId === topic.topicId) return true;
  return sameUserOrUnknown(topic, post) && titleLooksMatched(topic.title, post.title);
}

export function resolveRemainingTopics(
  topics: Topic[],
  posts: PostingRecord[]
): ResolveResult {
  const publishedPosts = posts.filter((post) => post.status === "published");
  const remaining: Topic[] = [];
  const matched: Topic[] = [];

  for (const topic of topics) {
    if (publishedPosts.some((post) => matchesPublishedIndex(topic, post))) {
      matched.push(topic);
    } else {
      remaining.push(topic);
    }
  }

  return {
    remaining,
    matched,
    remaining_count: remaining.length,
    matched_count: matched.length,
  };
}
