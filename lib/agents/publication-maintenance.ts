import { randomUUID } from "crypto";
import { readJsonFile, writeJsonFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { normalizeUserId } from "@/lib/utils/normalize";
import { resolveRemainingTopics } from "@/lib/skills/remaining-topic-resolver";
import type { PostingIndex, PostingRecord, Topic, TopicIndex } from "@/lib/types/github-data";
import { runTopicGenerator, type GeneratedTopic } from "./topic-generator";
import { syncPublishedPostToUserCorpus } from "./user-learning";

interface PublicationLearningEntry {
  postId: string;
  topicId: string;
  userId: string;
  title: string;
  naverPostUrl: string | null;
  evalScore: number | null;
  wordCount: number;
  publishedAt: string | null;
  topicSource: Topic["source"] | null;
  contentKind: Topic["contentKind"] | null;
  learnedAt: string;
}

interface PublicationLearningLedger {
  userId: string;
  entries: PublicationLearningEntry[];
  updatedAt: string;
}

function isPlanningTopic(topic: Topic): boolean {
  return topic.source !== "direct";
}

function userMatches(userId: string, value: string | null | undefined): boolean {
  return normalizeUserId(value ?? "") === userId;
}

function learningPath(userId: string): string {
  return `data/content-learning/${userId}.json`;
}

async function appendPublicationLearning(params: {
  post: PostingRecord;
  topic: Topic | null;
}): Promise<void> {
  const userId = normalizeUserId(params.post.userId);
  if (!userId) return;

  const path = learningPath(userId);
  const now = new Date().toISOString();
  const current = (await fileExists(path))
    ? await readJsonFile<PublicationLearningLedger>(path)
    : { data: { userId, entries: [], updatedAt: now }, sha: null };

  const entry: PublicationLearningEntry = {
    postId: params.post.postId,
    topicId: params.post.topicId,
    userId,
    title: params.post.title,
    naverPostUrl: params.post.naverPostUrl,
    evalScore: params.post.evalScore,
    wordCount: params.post.wordCount,
    publishedAt: params.post.publishedAt,
    topicSource: params.topic?.source ?? null,
    contentKind: params.topic?.contentKind ?? null,
    learnedAt: now,
  };

  const entries = [
    entry,
    ...current.data.entries.filter((item) => item.postId !== params.post.postId),
  ].slice(0, 200);

  await writeJsonFile(
    path,
    { userId, entries, updatedAt: now },
    `chore: learn published post ${params.post.postId}`,
    current.sha
  );
}

function generatedToTopic(generated: GeneratedTopic, userId: string, now: string): Topic {
  return {
    topicId: `topic-${randomUUID().slice(0, 8)}`,
    title: generated.title.trim(),
    description: generated.description?.trim() ?? "",
    category: generated.category?.trim() || `${userId} blog`,
    tags: generated.tags ?? [],
    source: "generated",
    contentKind: generated.contentKind,
    feasibility: null,
    relatedSources: [],
    status: "draft",
    assignedUserId: userId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function runAfterPublishMaintenance(params: {
  post: PostingRecord;
}): Promise<{ generatedCount: number; learned: boolean }> {
  const userId = normalizeUserId(params.post.userId);
  if (!userId) return { generatedCount: 0, learned: false };
  if (!(await fileExists(Paths.topicsIndex()))) return { generatedCount: 0, learned: false };

  const { data: topicsIndex } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
  const topic = topicsIndex.topics.find((item) => item.topicId === params.post.topicId) ?? null;
  await appendPublicationLearning({ post: params.post, topic });
  await syncPublishedPostToUserCorpus({ post: params.post, topic }).catch(() => false);

  const userTopics = topicsIndex.topics
    .filter(isPlanningTopic)
    .filter((item) => userMatches(userId, item.assignedUserId));

  const { data: postsIndex } = await readJsonFile<PostingIndex>(Paths.postingListIndex());
  const userPublishedPosts = postsIndex.posts.filter(
    (post) => post.status === "published" && userMatches(userId, post.userId)
  );
  const remaining = resolveRemainingTopics(userTopics, userPublishedPosts).remaining;
  if (remaining.length > 0 || userPublishedPosts.length === 0) {
    return { generatedCount: 0, learned: true };
  }

  const result = await runTopicGenerator({
    userId,
    publishedTopics: userTopics.filter((item) => item.status === "published"),
    publishedPosts: userPublishedPosts,
  });

  if (result.generatedTopics.length === 0) return { generatedCount: 0, learned: true };

  const now = new Date().toISOString();
  const { data: latestTopics, sha } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
  const latestUserTopics = latestTopics.topics
    .filter(isPlanningTopic)
    .filter((item) => userMatches(userId, item.assignedUserId));
  const latestRemaining = resolveRemainingTopics(latestUserTopics, userPublishedPosts).remaining;
  if (latestRemaining.length > 0) return { generatedCount: 0, learned: true };

  const existingTitles = new Set(latestTopics.topics.map((item) => item.title.trim().toLowerCase()));
  const newTopics = result.generatedTopics
    .filter((item) => !existingTitles.has(item.title.trim().toLowerCase()))
    .map((item) => generatedToTopic(item, userId, now));

  if (newTopics.length === 0) return { generatedCount: 0, learned: true };

  await writeJsonFile(
    Paths.topicsIndex(),
    { topics: [...latestTopics.topics, ...newTopics], lastUpdated: now },
    `feat: auto-generate ${newTopics.length} topics for ${userId}`,
    sha
  );

  return { generatedCount: newTopics.length, learned: true };
}
