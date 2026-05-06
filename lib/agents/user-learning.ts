import { fileExists, readFile, readJsonFile, writeFile, writeJsonFile } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import { normalizeUserId } from "@/lib/utils/normalize";
import type {
  CorpusIndex,
  CorpusSampleMeta,
  PostingIndex,
  PostingRecord,
  Topic,
  TopicIndex,
  UserProfile,
} from "@/lib/types/github-data";
import type { PublicationLearningSummary } from "./types";

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

interface ExemplarEntry {
  sampleId: string;
  title: string;
  category: string;
  tags: string[];
  relevanceScore: number;
  styleNotes: string;
  excerpt: string;
  wordCount: number;
  publishedAt: string;
}

interface ExemplarIndex {
  userId: string;
  exemplars: ExemplarEntry[];
  lastCurated: string;
}

const STOPWORDS = new Set([
  "전자담배",
  "추천",
  "후기",
  "리뷰",
  "정리",
  "가이드",
  "방법",
  "이유",
  "기준",
  "인천",
  "만수동",
  "만수르",
  "입호흡",
  "폐호흡",
]);

function takeTop<T>(items: T[], count: number): T[] {
  return items.slice(0, count);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildExcerpt(markdown: string): string {
  return normalizeWhitespace(
    markdown
      .replace(/^#+\s*/gm, "")
      .replace(/[`>*_~-]/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  ).slice(0, 240);
}

function tokenizeTitle(title: string): string[] {
  return title
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function readProfile(userId: string): Promise<UserProfile | null> {
  const path = Paths.userProfile(userId);
  if (!(await fileExists(path))) return null;
  const { data } = await readJsonFile<UserProfile>(path);
  return data;
}

async function loadTopicsMap(): Promise<Map<string, Topic>> {
  if (!(await fileExists(Paths.topicsIndex()))) {
    return new Map();
  }
  const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
  return new Map(data.topics.map((topic) => [topic.topicId, topic] as const));
}

async function loadPublishedPosts(userId: string): Promise<PostingRecord[]> {
  if (!(await fileExists(Paths.postingListIndex()))) {
    return [];
  }
  const { data } = await readJsonFile<PostingIndex>(Paths.postingListIndex());
  return data.posts
    .filter((post) => normalizeUserId(post.userId) === userId && post.status === "published")
    .sort((left, right) => {
      const scoreDelta = (right.evalScore ?? -1) - (left.evalScore ?? -1);
      if (scoreDelta !== 0) return scoreDelta;
      return new Date(right.publishedAt ?? right.updatedAt).getTime() - new Date(left.publishedAt ?? left.updatedAt).getTime();
    });
}

function makeSampleId(postId: string): string {
  return `published-${postId}`;
}

async function ensureCorpusDirectoriesFromPost(params: {
  userId: string;
  post: PostingRecord;
  topic: Topic | null;
  profile: UserProfile | null;
}): Promise<{ meta: CorpusSampleMeta; exemplar: ExemplarEntry } | null> {
  const { userId, post, topic, profile } = params;
  const contentPath = Paths.postContent(post.postId);
  if (!(await fileExists(contentPath))) return null;

  const { content, sha } = await readFile(contentPath);
  const sampleId = makeSampleId(post.postId);
  const samplePath = Paths.corpusSample(userId, sampleId);
  const sampleSha = (await fileExists(samplePath)) ? (await readFile(samplePath)).sha : null;
  if (!sampleSha || sha !== sampleSha) {
    await writeFile(
      samplePath,
      content,
      `chore: sync corpus sample ${sampleId}`,
      sampleSha
    );
  }

  const meta: CorpusSampleMeta = {
    sampleId,
    title: post.title,
    category: topic?.category || "published-post",
    tags: topic?.tags ?? [],
    wordCount: post.wordCount || content.length,
    publishedAt: post.publishedAt ?? post.updatedAt,
    filePath: samplePath,
  };

  const tone = profile?.writingStyle?.tone ?? "friendly";
  const styleNotes = [
    `tone=${tone}`,
    topic?.contentKind ? `contentKind=${topic.contentKind}` : null,
    topic?.category ? `category=${topic.category}` : null,
  ].filter(Boolean).join(", ");

  const exemplar: ExemplarEntry = {
    sampleId,
    title: post.title,
    category: meta.category,
    tags: meta.tags,
    relevanceScore: Math.max(0.35, Math.min(0.99, (post.evalScore ?? 70) / 100)),
    styleNotes,
    excerpt: buildExcerpt(content),
    wordCount: meta.wordCount,
    publishedAt: meta.publishedAt,
  };

  return { meta, exemplar };
}

async function writeCorpusArtifacts(params: {
  userId: string;
  metas: CorpusSampleMeta[];
  exemplars: ExemplarEntry[];
}): Promise<void> {
  const { userId, metas, exemplars } = params;
  const now = new Date().toISOString();

  const corpusPath = Paths.corpusIndex(userId);
  const corpusCurrent = (await fileExists(corpusPath))
    ? await readJsonFile<CorpusIndex>(corpusPath)
    : { data: { userId, samples: [], lastUpdated: now }, sha: null };

  const exemplarPath = Paths.exemplarIndex(userId);
  const exemplarCurrent = (await fileExists(exemplarPath))
    ? await readJsonFile<ExemplarIndex>(exemplarPath)
    : { data: { userId, exemplars: [], lastCurated: now }, sha: null };

  const sampleMap = new Map(corpusCurrent.data.samples.map((item) => [item.sampleId, item] as const));
  for (const meta of metas) sampleMap.set(meta.sampleId, meta);
  const samples = [...sampleMap.values()]
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime())
    .slice(0, 5);

  const exemplarMap = new Map(exemplarCurrent.data.exemplars.map((item) => [item.sampleId, item] as const));
  for (const exemplar of exemplars) exemplarMap.set(exemplar.sampleId, exemplar);
  const nextExemplars = [...exemplarMap.values()]
    .sort((left, right) => {
      const relevanceDelta = right.relevanceScore - left.relevanceScore;
      if (relevanceDelta !== 0) return relevanceDelta;
      return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    })
    .slice(0, 5);

  await writeJsonFile(
    corpusPath,
    { userId, samples, lastUpdated: now },
    `chore: update corpus index for ${userId}`,
    corpusCurrent.sha
  );
  await writeJsonFile(
    exemplarPath,
    { userId, exemplars: nextExemplars, lastCurated: now },
    `chore: update exemplar index for ${userId}`,
    exemplarCurrent.sha
  );
}

export async function ensureUserCorpusSeeded(userId: string): Promise<{ seeded: boolean; sampleCount: number }> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return { seeded: false, sampleCount: 0 };

  const corpusPath = Paths.corpusIndex(normalizedUserId);
  if (await fileExists(corpusPath)) {
    const { data } = await readJsonFile<CorpusIndex>(corpusPath);
    if (data.samples.length >= 3 && (await fileExists(Paths.exemplarIndex(normalizedUserId)))) {
      return { seeded: false, sampleCount: data.samples.length };
    }
  }

  const [posts, topicsMap, profile] = await Promise.all([
    loadPublishedPosts(normalizedUserId),
    loadTopicsMap(),
    readProfile(normalizedUserId),
  ]);

  const prepared = await Promise.all(
    takeTop(posts, 5).map((post) =>
      ensureCorpusDirectoriesFromPost({
        userId: normalizedUserId,
        post,
        topic: topicsMap.get(post.topicId) ?? null,
        profile,
      })
    )
  );
  const usable = prepared.filter(Boolean) as Array<{ meta: CorpusSampleMeta; exemplar: ExemplarEntry }>;
  if (usable.length === 0) {
    return { seeded: false, sampleCount: 0 };
  }

  await writeCorpusArtifacts({
    userId: normalizedUserId,
    metas: usable.map((item) => item.meta),
    exemplars: usable.map((item) => item.exemplar),
  });

  return { seeded: true, sampleCount: usable.length };
}

export async function syncPublishedPostToUserCorpus(params: {
  post: PostingRecord;
  topic: Topic | null;
}): Promise<boolean> {
  const userId = normalizeUserId(params.post.userId);
  if (!userId) return false;

  const profile = await readProfile(userId);
  const prepared = await ensureCorpusDirectoriesFromPost({
    userId,
    post: params.post,
    topic: params.topic,
    profile,
  });
  if (!prepared) return false;

  await writeCorpusArtifacts({
    userId,
    metas: [prepared.meta],
    exemplars: [prepared.exemplar],
  });
  return true;
}

async function loadLearningEntries(userId: string): Promise<PublicationLearningEntry[]> {
  const normalizedUserId = normalizeUserId(userId);
  const learningPath = Paths.contentLearning(normalizedUserId);
  const [posts, topicsMap] = await Promise.all([
    loadPublishedPosts(normalizedUserId),
    loadTopicsMap(),
  ]);
  const fallbackEntries = posts.map((post) => {
    const topic = topicsMap.get(post.topicId) ?? null;
    return {
      postId: post.postId,
      topicId: post.topicId,
      userId: normalizedUserId,
      title: post.title,
      naverPostUrl: post.naverPostUrl,
      evalScore: post.evalScore,
      wordCount: post.wordCount,
      publishedAt: post.publishedAt,
      topicSource: topic?.source ?? null,
      contentKind: topic?.contentKind ?? null,
      learnedAt: post.updatedAt,
    };
  });

  if (await fileExists(learningPath)) {
    const { data } = await readJsonFile<PublicationLearningLedger>(learningPath);
    const merged = new Map<string, PublicationLearningEntry>();
    for (const entry of [...data.entries, ...fallbackEntries]) {
      merged.set(entry.postId, entry);
    }
    return [...merged.values()];
  }

  return fallbackEntries;
}

export async function getPublicationLearningSummary(userId: string): Promise<PublicationLearningSummary | null> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  const entries = await loadLearningEntries(normalizedUserId);
  if (entries.length === 0) return null;

  const titleFrequency = new Map<string, number>();
  for (const title of entries.map((entry) => entry.title)) {
    for (const token of tokenizeTitle(title)) {
      titleFrequency.set(token, (titleFrequency.get(token) ?? 0) + 1);
    }
  }

  const topKeywords = [...titleFrequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([token]) => token);

  const contentKindFrequency = new Map<string, number>();
  for (const kind of entries.map((entry) => entry.contentKind).filter(Boolean) as string[]) {
    contentKindFrequency.set(kind, (contentKindFrequency.get(kind) ?? 0) + 1);
  }
  const dominantContentKinds = [...contentKindFrequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([kind]) => kind);

  const avgEvalScore = average(entries.map((entry) => entry.evalScore).filter((value): value is number => value !== null));
  const avgWordCount = average(entries.map((entry) => entry.wordCount).filter((value) => value > 0));
  const recentTitles = entries
    .slice()
    .sort((left, right) => new Date(right.publishedAt ?? right.learnedAt).getTime() - new Date(left.publishedAt ?? left.learnedAt).getTime())
    .slice(0, 3)
    .map((entry) => entry.title);
  const bestPerforming = entries
    .filter((entry) => entry.evalScore !== null)
    .sort((left, right) => (right.evalScore ?? -1) - (left.evalScore ?? -1))[0] ?? null;
  const lastPublishedAt = entries
    .map((entry) => entry.publishedAt ?? entry.learnedAt)
    .sort()
    .at(-1) ?? null;

  const guidance = [
    avgEvalScore !== null ? `최근 발행 글 평균 평가 점수는 ${avgEvalScore}점입니다.` : null,
    avgWordCount !== null ? `최근 발행 글 평균 분량은 ${avgWordCount}자입니다.` : null,
    topKeywords.length > 0 ? `반복되는 제목 키워드는 ${topKeywords.join(", ")} 입니다.` : null,
    dominantContentKinds.length > 0 ? `자주 발행되는 글 구조는 ${dominantContentKinds.join(", ")} 입니다.` : null,
    recentTitles.length > 0 ? `최근 발행 제목 예시는 ${recentTitles.join(" / ")} 입니다.` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    source: (await fileExists(Paths.contentLearning(normalizedUserId)))
      ? "content-learning"
      : "published-posts-fallback",
    totalEntries: entries.length,
    avgEvalScore,
    avgWordCount,
    recentTitles,
    topKeywords,
    dominantContentKinds,
    bestPerformingTitle: bestPerforming?.title ?? null,
    lastPublishedAt,
    guidance,
  };
}
