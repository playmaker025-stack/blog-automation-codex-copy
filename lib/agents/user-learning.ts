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

interface WritingProfile {
  userId: string;
  updatedAt: string;
  sourceSampleCount: number;
  sourceExemplarCount: number;
  averageWordCount: number | null;
  recentTitles: string[];
  topKeywords: string[];
  structureRules: string[];
  toneRules: string[];
  openingPatterns: string[];
  closingPatterns: string[];
  ctaPatterns: string[];
  representativeExcerpts: string[];
}

const MAX_STORED_CORPUS_SAMPLES = 30;
const MAX_STORED_EXEMPLARS = 30;
const MAX_PROFILE_TITLES = 8;
const MAX_PROFILE_EXCERPTS = 5;

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

function stripMarkdown(markdown: string): string {
  return normalizeWhitespace(
    markdown
      .replace(/^#+\s*/gm, "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[`>*_~-]/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  );
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function htmlToText(html: string): string {
  return normalizeWhitespace(
    decodeBasicHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function toAbsoluteNaverFrameUrl(sourceUrl: string, frameSrc: string): string | null {
  try {
    return new URL(frameSrc, sourceUrl).toString();
  } catch {
    return null;
  }
}

async function fetchTextFromUrl(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BlogAutomationLearning/1.0)",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return null;
  return response.text();
}

async function fetchPublishedMarkdownFromNaver(post: PostingRecord): Promise<string | null> {
  if (!post.naverPostUrl || !/^https:\/\/blog\.naver\.com\//i.test(post.naverPostUrl)) {
    return null;
  }

  try {
    const firstHtml = await fetchTextFromUrl(post.naverPostUrl);
    if (!firstHtml) return null;

    const frameMatch =
      firstHtml.match(/<iframe[^>]+(?:id|name)=["']?mainFrame["']?[^>]+src=["']([^"']+)["']/i) ??
      firstHtml.match(/<iframe[^>]+src=["']([^"']*PostView[^"']+)["']/i);
    const frameUrl = frameMatch?.[1]
      ? toAbsoluteNaverFrameUrl(post.naverPostUrl, frameMatch[1])
      : null;
    const html = frameUrl ? await fetchTextFromUrl(frameUrl) : firstHtml;
    if (!html) return null;

    const text = htmlToText(html);
    if (text.length < 500) return null;

    return `# ${post.title}\n\n${text.slice(0, 20000)}`;
  } catch {
    return null;
  }
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
  const existingContent = (await fileExists(contentPath))
    ? await readFile(contentPath)
    : null;
  const fetchedContent = existingContent ? null : await fetchPublishedMarkdownFromNaver(post);
  if (!existingContent && !fetchedContent) return null;

  if (!existingContent && fetchedContent) {
    await writeFile(
      contentPath,
      fetchedContent,
      `chore: cache published content ${post.postId}`,
      null
    );
  }

  const content = existingContent?.content ?? fetchedContent ?? "";
  const sha = existingContent?.sha ?? null;
  const sampleId = makeSampleId(post.postId);
  const samplePath = Paths.corpusSample(userId, sampleId);
  const sampleSha = (await fileExists(samplePath)) ? (await readFile(samplePath)).sha : null;
  if (!sampleSha || (sha && sha !== sampleSha)) {
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

function buildWritingProfile(params: {
  userId: string;
  samples: CorpusSampleMeta[];
  exemplars: ExemplarEntry[];
}): WritingProfile {
  const { userId, samples, exemplars } = params;
  const sortedSamples = samples
    .slice()
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());
  const sortedExemplars = exemplars
    .slice()
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());

  const titleFrequency = new Map<string, number>();
  for (const title of sortedSamples.map((sample) => sample.title)) {
    for (const token of tokenizeTitle(title)) {
      titleFrequency.set(token, (titleFrequency.get(token) ?? 0) + 1);
    }
  }

  const topKeywords = [...titleFrequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([token]) => token);
  const averageWordCount = average(sortedSamples.map((sample) => sample.wordCount).filter((count) => count > 0));
  const representativeExcerpts = sortedExemplars
    .map((exemplar) => stripMarkdown(exemplar.excerpt))
    .filter((excerpt) => excerpt.length > 0)
    .slice(0, MAX_PROFILE_EXCERPTS);

  return {
    userId,
    updatedAt: new Date().toISOString(),
    sourceSampleCount: samples.length,
    sourceExemplarCount: exemplars.length,
    averageWordCount,
    recentTitles: sortedSamples.slice(0, MAX_PROFILE_TITLES).map((sample) => sample.title),
    topKeywords,
    structureRules: [
      "제목의 핵심 키워드를 도입부 초반에 자연스럽게 반복한다.",
      "본문은 검색자가 바로 비교하거나 결정할 수 있게 문제, 기준, 선택지를 순서대로 풀어낸다.",
      "마무리는 과장된 결론보다 방문/상담/확인 행동으로 부드럽게 연결한다.",
    ],
    toneRules: [
      "친근하지만 정보가 먼저 보이는 설명형 문장을 우선한다.",
      "홍보 문구만 반복하지 말고 실제 사용 상황과 선택 기준을 함께 쓴다.",
      "사용자 블로그의 기존 제목과 표현을 우선 참고하되 금지 표현은 별도 규칙을 따른다.",
    ],
    openingPatterns: [
      "검색자가 지금 궁금해하는 상황을 먼저 짚고 주제를 연결한다.",
      "지역, 제품군, 증상 같은 구체 단서를 첫 문단에 배치한다.",
    ],
    closingPatterns: [
      "핵심 선택 기준을 짧게 다시 정리한다.",
      "필요하면 매장 방문, 비교 상담, 추가 확인 같은 다음 행동으로 연결한다.",
    ],
    ctaPatterns: [
      "궁금한 제품이나 액상 취향을 기준으로 상담받을 수 있다는 식의 낮은 압박 CTA를 사용한다.",
    ],
    representativeExcerpts,
  };
}

async function writeWritingProfile(params: {
  userId: string;
  samples: CorpusSampleMeta[];
  exemplars: ExemplarEntry[];
}): Promise<void> {
  const profilePath = Paths.writingProfile(params.userId);
  const current = (await fileExists(profilePath))
    ? await readJsonFile<WritingProfile>(profilePath)
    : { data: null, sha: null };
  await writeJsonFile(
    profilePath,
    buildWritingProfile(params),
    `chore: update writing profile for ${params.userId}`,
    current.sha
  );
}

async function writeWritingProfileFromStoredArtifacts(userId: string): Promise<number> {
  const corpusPath = Paths.corpusIndex(userId);
  const exemplarPath = Paths.exemplarIndex(userId);
  if (!(await fileExists(corpusPath)) || !(await fileExists(exemplarPath))) return 0;

  const [{ data: corpus }, { data: exemplarIndex }] = await Promise.all([
    readJsonFile<CorpusIndex>(corpusPath),
    readJsonFile<ExemplarIndex>(exemplarPath),
  ]);
  await writeWritingProfile({
    userId,
    samples: corpus.samples,
    exemplars: exemplarIndex.exemplars,
  });
  return corpus.samples.length;
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
    .slice(0, MAX_STORED_CORPUS_SAMPLES);

  const exemplarMap = new Map(exemplarCurrent.data.exemplars.map((item) => [item.sampleId, item] as const));
  for (const exemplar of exemplars) exemplarMap.set(exemplar.sampleId, exemplar);
  const nextExemplars = [...exemplarMap.values()]
    .sort((left, right) => {
      const relevanceDelta = right.relevanceScore - left.relevanceScore;
      if (relevanceDelta !== 0) return relevanceDelta;
      return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    })
    .slice(0, MAX_STORED_EXEMPLARS);

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
  await writeWritingProfile({ userId, samples, exemplars: nextExemplars });
}

export async function ensureUserCorpusSeeded(userId: string): Promise<{ seeded: boolean; sampleCount: number }> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return { seeded: false, sampleCount: 0 };

  const corpusPath = Paths.corpusIndex(normalizedUserId);
  if (await fileExists(corpusPath)) {
    const { data } = await readJsonFile<CorpusIndex>(corpusPath);
    if (data.samples.length >= 3 && (await fileExists(Paths.exemplarIndex(normalizedUserId)))) {
      if (!(await fileExists(Paths.writingProfile(normalizedUserId)))) {
        await writeWritingProfileFromStoredArtifacts(normalizedUserId);
      }
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

async function loadWritingProfile(userId: string): Promise<WritingProfile | null> {
  const path = Paths.writingProfile(userId);
  if (!(await fileExists(path))) return null;
  const { data } = await readJsonFile<WritingProfile>(path);
  return data;
}

export async function getPublicationLearningSummary(userId: string): Promise<PublicationLearningSummary | null> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  const [entries, writingProfile] = await Promise.all([
    loadLearningEntries(normalizedUserId),
    loadWritingProfile(normalizedUserId),
  ]);
  if (entries.length === 0 && !writingProfile) return null;

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
  const avgWordCount =
    average(entries.map((entry) => entry.wordCount).filter((value) => value > 0)) ??
    writingProfile?.averageWordCount ??
    null;
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

  const profileKeywords = writingProfile?.topKeywords ?? [];
  const mergedKeywords = topKeywords.length > 0 ? topKeywords : profileKeywords.slice(0, 5);
  const mergedRecentTitles =
    recentTitles.length > 0 ? recentTitles : writingProfile?.recentTitles.slice(0, 3) ?? [];

  const guidance = [
    avgEvalScore !== null ? `최근 발행 글 평균 평가 점수는 ${avgEvalScore}점입니다.` : null,
    avgWordCount !== null ? `최근 발행/레퍼런스 글 평균 분량은 약 ${avgWordCount}자입니다.` : null,
    mergedKeywords.length > 0 ? `반복되는 제목 키워드는 ${mergedKeywords.join(", ")} 입니다.` : null,
    dominantContentKinds.length > 0 ? `자주 발행되는 글 구조는 ${dominantContentKinds.join(", ")} 입니다.` : null,
    mergedRecentTitles.length > 0 ? `최근 참고 제목 예시는 ${mergedRecentTitles.join(" / ")} 입니다.` : null,
    writingProfile
      ? `누적 작성 프로필은 ${writingProfile.sourceSampleCount}개 샘플과 ${writingProfile.sourceExemplarCount}개 대표 예문으로 갱신되어 있습니다.`
      : null,
    ...(writingProfile?.toneRules.slice(0, 2) ?? []),
    ...(writingProfile?.structureRules.slice(0, 2) ?? []),
  ].filter((item): item is string => Boolean(item));

  return {
    source: writingProfile
      ? "writing-profile"
      : (await fileExists(Paths.contentLearning(normalizedUserId)))
      ? "content-learning"
      : "published-posts-fallback",
    totalEntries: Math.max(entries.length, writingProfile?.sourceSampleCount ?? 0),
    avgEvalScore,
    avgWordCount,
    recentTitles: mergedRecentTitles,
    topKeywords: mergedKeywords,
    dominantContentKinds,
    bestPerformingTitle: bestPerforming?.title ?? null,
    lastPublishedAt,
    guidance,
  };
}
