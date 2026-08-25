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
import { buildStyleFingerprint, type StyleFingerprint } from "./style-fingerprint";
import { stripNaverChrome, hasNaverChrome, isUsableCorpusText } from "./naver-chrome.ts";
import { rankByOutcome } from "./post-outcome.ts";
import { loadOutcomeSummaries } from "./post-outcome-store";

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
  styleFingerprint: StyleFingerprint;
  representativeExcerpts: string[];
}

const MAX_STORED_CORPUS_SAMPLES = 30;
const MAX_STORED_EXEMPLARS = 30;
const MAX_PROFILE_TITLES = 8;
const MAX_PROFILE_EXCERPTS = 5;
/** 발췌 길이. 240자는 문체 지문을 뽑기에 너무 짧다 — 종결어미 표본이 두세 개밖에 안 나온다. */
const EXCERPT_LENGTH = 600;

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

/**
 * 발췌는 문체 학습의 원재료다 — 프롬프트에 "이 문장 흐름을 그대로 복제하라"로 실리고
 * 종결어미·반복 표현 지문도 여기서 뽑는다. 그래서 네이버 UI를 먼저 걷어내야 한다.
 * 걷어내기 전에는 앞부분이 통째로 헤더·검색창·공감 위젯이었다.
 */
function buildExcerpt(markdown: string): string {
  return normalizeWhitespace(
    stripNaverChrome(markdown)
      .text.replace(/^#+\s*/gm, "")
      .replace(/[`>*_~-]/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  ).slice(0, EXCERPT_LENGTH);
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

const NAVER_FETCH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchTextFromUrl(url: string, timeoutMs = 25000): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": NAVER_FETCH_UA,
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ko-KR,ko;q=0.9",
          "referer": "https://blog.naver.com/",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      return response.text();
    } catch {
      if (attempt === 1) return null;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
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

    let html: string | null = null;

    if (frameMatch?.[1]) {
      const frameUrl = toAbsoluteNaverFrameUrl(post.naverPostUrl, frameMatch[1]);
      if (frameUrl) html = await fetchTextFromUrl(frameUrl);
    }

    // iframe 없거나 실패 시 PostView URL 직접 구성 (fallback)
    if (!html || html.length < 500) {
      const blogMatch = post.naverPostUrl.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/);
      if (blogMatch) {
        const [, blogId, logNo] = blogMatch;
        const postViewUrl = `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}&redirect=Dlog&widgetTypeCall=true`;
        const fallback = await fetchTextFromUrl(postViewUrl);
        if (fallback && fallback.length > (html?.length ?? 0)) html = fallback;
      }
    }

    // 최후 수단: 첫 페이지 그대로 사용
    if (!html) html = firstHtml;

    // 페이지 전체의 태그를 벗긴 결과라 헤더·메뉴·푸터가 전부 섞여 있다. 본문만 남긴다.
    const text = stripNaverChrome(htmlToText(html)).text;
    if (text.length < 300) return null;

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
  // 예전에 저장된 발췌에는 네이버 UI가 그대로 들어 있다. 문체 지문이 "주소 변경 불가",
  // "후기 네이버"를 사장님 고유 표현으로 배운 원인이라 여기서 한 번 더 막는다.
  const cleanedExcerpts = sortedExemplars
    .map((exemplar) => stripMarkdown(stripNaverChrome(exemplar.excerpt).text))
    .filter((excerpt) => excerpt.length > 0 && !hasNaverChrome(excerpt));
  const representativeExcerpts = cleanedExcerpts.slice(0, MAX_PROFILE_EXCERPTS);
  // 지문은 저장 발췌 5개가 아니라 보유한 예문 전체에서 뽑는다. 표본이 클수록 반복 표현이 정확해진다.
  const styleFingerprint = buildStyleFingerprint(cleanedExcerpts);

  return {
    userId,
    updatedAt: new Date().toISOString(),
    sourceSampleCount: samples.length,
    sourceExemplarCount: exemplars.length,
    averageWordCount,
    recentTitles: sortedSamples.slice(0, MAX_PROFILE_TITLES).map((sample) => sample.title),
    topKeywords,
    ...buildDerivedStyleRules(styleFingerprint),
    styleFingerprint,
    representativeExcerpts,
  };
}

/**
 * 문체 규칙은 사용자 코퍼스에서 유도한다.
 *
 * 예전에는 이 5개 배열이 전부 하드코딩 상수였다. 그래서 사용자 5명 전원이
 * 바이트 단위로 동일한 "문체 규칙"을 가졌고, 프롬프트에 실어도 개인화 신호가 0이었다.
 * 지금은 실제 종결어미 분포와 반복 표현에서 규칙을 만들고, 근거가 없으면
 * 지어내지 않고 빈 배열을 둔다.
 */
function buildDerivedStyleRules(fingerprint: StyleFingerprint): {
  structureRules: string[];
  toneRules: string[];
  openingPatterns: string[];
  closingPatterns: string[];
  ctaPatterns: string[];
} {
  const toneRules: string[] = [];
  if (fingerprint.sentenceEndings.length > 0) {
    toneRules.push(
      `실제 종결어미 분포를 그대로 재현한다: ${fingerprint.sentenceEndings
        .map((item) => `${item.ending}(${item.count}회)`)
        .join(", ")}.`
    );
  }
  if (fingerprint.signaturePhrases.length > 0) {
    toneRules.push(
      `여러 글에 반복되는 고유 표현을 살린다: ${fingerprint.signaturePhrases.slice(0, 5).join(" / ")}.`
    );
  }

  return {
    structureRules: [],
    toneRules,
    openingPatterns: fingerprint.openingLines.map((line) => `실제 도입 예: "${line}"`),
    closingPatterns: fingerprint.closingLines.map((line) => `실제 마무리 예: "${line}"`),
    ctaPatterns: [],
  };
}

/**
 * sha 충돌을 한 번 재시도한다.
 *
 * 사장님이 글을 발행하면 프로덕션이 같은 파일(코퍼스·예문·프로필)을 쓴다. 읽은
 * 뒤 쓰기까지 사이에 바뀌면 GitHub이 sha 불일치로 거절한다. 실측으로 재학습을
 * 돌리는 동안 발행이 겹쳐 두 사용자가 실패했다. build가 현재 값을 받는 이유는
 * 재시도할 때 남의 변경을 덮어쓰지 않고 합치기 위해서다.
 */
async function writeJsonWithRetry<T>(
  path: string,
  build: (current: T | null) => T,
  message: string
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = (await fileExists(path))
      ? await readJsonFile<T>(path)
      : { data: null, sha: null };
    try {
      await writeJsonFile(path, build(current.data), message, current.sha);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (attempt === 1 || !/but expected|does not match|409/.test(detail)) throw error;
    }
  }
}

async function writeWritingProfile(params: {
  userId: string;
  samples: CorpusSampleMeta[];
  exemplars: ExemplarEntry[];
}): Promise<WritingProfile> {
  const profile = buildWritingProfile(params);
  await writeJsonWithRetry<WritingProfile>(
    Paths.writingProfile(params.userId),
    () => profile,
    `chore: update writing profile for ${params.userId}`
  );
  return profile;
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

export interface ProfileHealth {
  userId: string;
  exists: boolean;
  updatedAt: string | null;
  sampleCount: number;
  excerptCount: number;
  /** 네이버 UI가 남아 있는 대표 발췌 수. 0이 아니면 재학습이 필요하다. */
  contaminatedExcerpts: number;
  /** 종결어미 분포를 실제로 뽑아냈는지. 없으면 문체 규칙이 일반론뿐이다. */
  hasFingerprint: boolean;
  signaturePhrases: string[];
}

/** "문체가 어느 정도 학습됐나"를 화면에서 볼 수 있게 만든다. 그동안은 볼 방법이 없었다. */
export async function getProfileHealth(userId: string): Promise<ProfileHealth> {
  const normalizedUserId = normalizeUserId(userId);
  const profile = await loadWritingProfile(normalizedUserId);
  if (!profile) {
    return {
      userId: normalizedUserId,
      exists: false,
      updatedAt: null,
      sampleCount: 0,
      excerptCount: 0,
      contaminatedExcerpts: 0,
      hasFingerprint: false,
      signaturePhrases: [],
    };
  }

  const excerpts = profile.representativeExcerpts ?? [];
  return {
    userId: normalizedUserId,
    exists: true,
    updatedAt: profile.updatedAt ?? null,
    sampleCount: profile.sourceSampleCount ?? 0,
    excerptCount: excerpts.length,
    contaminatedExcerpts: excerpts.filter((excerpt) => hasNaverChrome(excerpt)).length,
    hasFingerprint: (profile.styleFingerprint?.sentenceEndings?.length ?? 0) > 0,
    signaturePhrases: profile.styleFingerprint?.signaturePhrases?.slice(0, 3) ?? [],
  };
}

export interface ProfileRebuildResult {
  userId: string;
  sampleCount: number;
  /** 네이버 UI를 걷어내고 새로 뽑은 발췌 수 */
  refreshedExcerpts: number;
  /** 본문 없이 UI만 담겨 학습에서 뺀 샘플 */
  droppedSamples: string[];
  hasFingerprint: boolean;
}

/** GitHub 왕복이 30번씩 나가지 않게 묶어서 읽는다. */
const REBUILD_CONCURRENCY = 6;

/**
 * 발행을 기다리지 않고 프로필을 다시 만든다.
 *
 * 왜 필요한가: 프로필은 발행할 때만 갱신된다. 그래서 발행이 뜸한 사용자는 학습이
 * 멈춘다 — 실측으로 사장님 d는 79편을 쓰고도 2026-08-20 이후 발행이 없어 문체
 * 지문이 아예 없었다. 저장된 발췌가 네이버 UI로 오염돼 있어도 발행 전에는 고칠
 * 방법이 없었다.
 *
 * 저장된 발췌를 그대로 쓰지 않고 코퍼스 원문을 다시 읽어 발췌를 새로 뽑는다.
 * 그래야 이미 저장된 오염이 씻긴다.
 */
export async function rebuildUserProfile(userId: string): Promise<ProfileRebuildResult> {
  const normalizedUserId = normalizeUserId(userId);
  const empty: ProfileRebuildResult = {
    userId: normalizedUserId,
    sampleCount: 0,
    refreshedExcerpts: 0,
    droppedSamples: [],
    hasFingerprint: false,
  };

  const corpusPath = Paths.corpusIndex(normalizedUserId);
  const exemplarPath = Paths.exemplarIndex(normalizedUserId);
  if (!(await fileExists(corpusPath)) || !(await fileExists(exemplarPath))) return empty;

  // sha는 여기서 잡지 않는다. 쓰기 직전에 다시 읽어야 충돌 창이 좁아진다.
  const [{ data: corpus }, { data: exemplarIndex }] = await Promise.all([
    readJsonFile<CorpusIndex>(corpusPath),
    readJsonFile<ExemplarIndex>(exemplarPath),
  ]);

  const droppedSamples: string[] = [];
  const refreshed: ExemplarEntry[] = [];
  let refreshedExcerpts = 0;

  const source = exemplarIndex.exemplars;
  for (let offset = 0; offset < source.length; offset += REBUILD_CONCURRENCY) {
    const batch = source.slice(offset, offset + REBUILD_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (exemplar) => {
        const samplePath = Paths.corpusSample(normalizedUserId, exemplar.sampleId);
        if (!(await fileExists(samplePath))) return { exemplar, usable: true, changed: false };
        const { content } = await readFile(samplePath);
        if (!isUsableCorpusText(stripNaverChrome(content).text)) {
          return { exemplar, usable: false, changed: false };
        }
        const excerpt = buildExcerpt(content);
        return {
          exemplar: { ...exemplar, excerpt },
          usable: true,
          changed: excerpt !== exemplar.excerpt,
        };
      })
    );
    for (const result of results) {
      if (!result.usable) {
        droppedSamples.push(result.exemplar.sampleId);
        continue;
      }
      if (result.changed) refreshedExcerpts += 1;
      refreshed.push(result.exemplar);
    }
  }

  const dropped = new Set(droppedSamples);
  const now = new Date().toISOString();

  // 재학습 도중 발행이 겹치면 프로덕션이 새 예문을 넣는다. 덮어쓰지 않고 합친다.
  const refreshedById = new Map(refreshed.map((entry) => [entry.sampleId, entry] as const));
  await writeJsonWithRetry<ExemplarIndex>(
    exemplarPath,
    (current) => {
      const base = current?.exemplars ?? exemplarIndex.exemplars;
      const merged = base.map((entry) => refreshedById.get(entry.sampleId) ?? entry);
      const seen = new Set(merged.map((entry) => entry.sampleId));
      for (const entry of refreshed) if (!seen.has(entry.sampleId)) merged.push(entry);
      return {
        ...(current ?? exemplarIndex),
        exemplars: merged.filter((entry) => !dropped.has(entry.sampleId)),
        lastCurated: now,
      };
    },
    `chore: rebuild exemplar excerpts for ${normalizedUserId}`
  );
  if (dropped.size > 0) {
    await writeJsonWithRetry<CorpusIndex>(
      corpusPath,
      (current) => {
        const base = current?.samples ?? corpus.samples;
        return {
          ...(current ?? corpus),
          samples: base.filter((sample) => !dropped.has(sample.sampleId)),
          lastUpdated: now,
        };
      },
      `chore: drop unusable corpus samples for ${normalizedUserId}`
    );
  }

  // 인덱스를 쓴 뒤 다시 읽는다. 재학습 도중 발행이 끝났다면 그 글은 인덱스에는
  // 병합돼 있는데, 시작 시점 목록으로 프로필을 만들면 프로필에서만 사라진다.
  // 그러면 코퍼스에는 있는 글이 문체 학습에는 안 잡히는 어긋난 상태가 된다.
  const [{ data: latestCorpus }, { data: latestExemplars }] = await Promise.all([
    readJsonFile<CorpusIndex>(corpusPath),
    readJsonFile<ExemplarIndex>(exemplarPath),
  ]);

  const profile = await writeWritingProfile({
    userId: normalizedUserId,
    samples: latestCorpus.samples,
    exemplars: latestExemplars.exemplars,
  });

  return {
    userId: normalizedUserId,
    sampleCount: latestCorpus.samples.length,
    refreshedExcerpts,
    droppedSamples,
    hasFingerprint: (profile.styleFingerprint?.sentenceEndings.length ?? 0) > 0,
  };
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
  await writeWritingProfileFromStoredArtifacts(userId);
  return true;
}

export async function syncMissingPublishedToCorpus(
  userId: string,
  limit = 15
): Promise<{ synced: number; skipped: number; failed: number }> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return { synced: 0, skipped: 0, failed: 0 };

  const posts = await loadPublishedPosts(normalizedUserId);
  if (posts.length === 0) return { synced: 0, skipped: 0, failed: 0 };

  const corpusPath = Paths.corpusIndex(normalizedUserId);
  const existingIds = new Set<string>();
  if (await fileExists(corpusPath)) {
    const { data } = await readJsonFile<CorpusIndex>(corpusPath);
    for (const s of data.samples) existingIds.add(s.sampleId);
  }

  const missing = posts.filter((p) => !existingIds.has(makeSampleId(p.postId)));
  const toProcess = missing.slice(0, limit);
  const skipped = missing.length - toProcess.length;

  if (toProcess.length === 0) return { synced: 0, skipped, failed: 0 };

  const [profile, topicsMap] = await Promise.all([
    readProfile(normalizedUserId),
    loadTopicsMap(),
  ]);

  let synced = 0;
  let failed = 0;
  const usable: Array<{ meta: CorpusSampleMeta; exemplar: ExemplarEntry }> = [];

  for (const post of toProcess) {
    const prepared = await ensureCorpusDirectoriesFromPost({
      userId: normalizedUserId,
      post,
      topic: topicsMap.get(post.topicId) ?? null,
      profile,
    }).catch(() => null);

    if (prepared) {
      usable.push(prepared);
      synced++;
    } else {
      failed++;
    }
  }

  if (usable.length > 0) {
    await writeCorpusArtifacts({
      userId: normalizedUserId,
      metas: usable.map((u) => u.meta),
      exemplars: usable.map((u) => u.exemplar),
    });
    await writeWritingProfileFromStoredArtifacts(normalizedUserId);
  }

  return { synced, skipped, failed };
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
  // "가장 잘한 글"은 실제 성과로 고른다.
  //
  // 예전에는 evalScore(앱이 스스로 매긴 점수) 1등을 뽑아 다음 글 전략에 넣었다.
  // 자기 채점을 성과로 착각하는 구조라, 실측을 도입해도 이 경로를 안 바꾸면
  // 내부 점수가 다시 승자를 정한다. 관측이 충분히 쌓인 글이 하나도 없으면
  // 예전 방식으로 물러서되, 그 사실을 source에 남겨 프롬프트가 구분하게 한다.
  const outcomeSummaries = await loadOutcomeSummaries(entries.map((entry) => entry.postId)).catch(
    () => new Map<string, ReturnType<typeof rankByOutcome>[number]["summary"]>()
  );
  const byOutcome = rankByOutcome(
    entries
      .map((entry) => ({ entry, summary: outcomeSummaries.get(entry.postId) }))
      .filter((item): item is { entry: typeof entries[number]; summary: NonNullable<typeof item.summary> } =>
        Boolean(item.summary)
      )
  );
  const bestPerforming = byOutcome[0]?.entry ??
    (entries
      .filter((entry) => entry.evalScore !== null)
      .sort((left, right) => (right.evalScore ?? -1) - (left.evalScore ?? -1))[0] ?? null);
  const bestPerformingSource: "measured_outcome" | "internal_score" | null =
    byOutcome.length > 0 ? "measured_outcome" : bestPerforming ? "internal_score" : null;
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
    bestPerformingSource,
    lastPublishedAt,
    guidance,
  };
}
