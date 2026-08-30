import { NextRequest, NextResponse } from "next/server";
import { readFile, readJsonFile, writeFile, writeJsonFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { PostingIndex, PostingRecord, TopicIndex } from "@/lib/types/github-data";
import { normalizeUserId } from "@/lib/utils/normalize";
import {
  buildOutcomeTracking,
  normalizeTargetKeywords,
  type OutcomeTracking,
  type TargetKeyword,
} from "@/lib/agents/post-outcome";
import {
  runAfterPublishMaintenance,
  type AfterPublishMaintenanceResult,
} from "@/lib/agents/publication-maintenance";

const EMPTY_INDEX: PostingIndex = { posts: [], lastUpdated: "" };

async function loadIndex(): Promise<{ data: PostingIndex; sha: string | null }> {
  const path = Paths.postingListIndex();
  if (!(await fileExists(path))) {
    return { data: { ...EMPTY_INDEX, lastUpdated: new Date().toISOString() }, sha: null };
  }
  const { data, sha } = await readJsonFile<PostingIndex>(path);
  return { data, sha };
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  const status = request.nextUrl.searchParams.get("status");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");

  try {
    const { data: index } = await loadIndex();
    let posts = index.posts;
    if (userId) {
      const uid = normalizeUserId(userId);
      posts = posts.filter((p) => normalizeUserId(p.userId) === uid);
    }
    if (status) posts = posts.filter((p) => p.status === status);

    // 최신 순 정렬
    posts = posts
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, limit);

    return NextResponse.json({ posts });
  } catch (err) {
    console.error("[GET /api/github/posts]", err);
    return NextResponse.json({ error: "포스팅 목록 조회 실패" }, { status: 500 });
  }
}

// 인덱스 항목 수정
/**
 * 이 글이 어떤 검색어를 노렸는지 확정한다.
 *
 * 토픽에 targetKeyword가 있으면 그걸 쓰고, 없으면 제목 앞부분을 쓴다.
 * 제목 앞쪽에 핵심 키워드를 놓는 게 이 앱의 작성 규칙이라 실제로 맞는 경우가 많다.
 * 완벽하진 않지만, 아무것도 기록하지 않는 것보다 낫다 — 나중에 화면에서 고칠 수 있다.
 */
async function resolveTargetKeywords(
  topicId: string,
  title: string,
  declared?: string[]
): Promise<TargetKeyword[]> {
  // 사장님이 직접 넣은 게 있으면 그것만 쓴다. 추측을 섞으면 성적이 오염된다.
  if (declared && declared.length > 0) {
    return normalizeTargetKeywords(
      declared.map((query) => ({ query, role: "primary" as const, source: "user" as const }))
    );
  }

  const fromTitle: TargetKeyword = {
    query: title.trim().split(/\s+/).slice(0, 3).join(" "),
    role: "primary",
    source: "title_guess",
  };

  const fallback = fromTitle.query ? [fromTitle] : [];
  if (!topicId) return normalizeTargetKeywords(fallback);

  try {
    if (!(await fileExists(Paths.topicsIndex()))) return normalizeTargetKeywords(fallback);
    const { data } = await readJsonFile<TopicIndex>(Paths.topicsIndex());
    const topic = data.topics.find((item) => item.topicId === topicId);
    const target = topic?.targetKeyword?.trim();
    return normalizeTargetKeywords(
      target
        ? [{ query: target, role: "primary" as const, source: "topic" as const }, fromTitle]
        : fallback
    );
  } catch {
    return normalizeTargetKeywords(fallback);
  }
}

/**
 * 이미 있는 계약의 검색어만 갈아끼운다.
 *
 * 계약을 통째로 새로 만들지 않는 이유: 글 주소와 발행 당시 제목은 그대로 두어야
 * 예전 관측이 어느 글의 것인지 남는다. 검색어별 관측 기록은 색인이 검색어 단위로
 * 들고 있으므로, 새 검색어는 기록이 없어 곧바로 다시 재기 시작한다.
 */
function reviseKeywords(
  tracking: OutcomeTracking,
  declared: string[],
  at: string
): OutcomeTracking {
  const keywords = normalizeTargetKeywords(
    declared.map((query) => ({ query, role: "primary" as const, source: "user" as const }))
  );
  if (keywords.length === 0) return tracking;
  return { ...tracking, targetKeywords: keywords, keywordsRevisedAt: at };
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      postId: string;
      content?: string;
      /** 화면에서 넘어오는 "이 글이 노린 검색어" 목록. 여러 개다. */
      targetKeywords?: string[];
    } & Partial<PostingRecord>;
    if (!body.postId) {
      return NextResponse.json({ error: "postId가 필요합니다." }, { status: 400 });
    }

    const { data: index, sha } = await loadIndex();
    const exists = index.posts.find((p) => p.postId === body.postId);
    if (!exists) {
      return NextResponse.json({ error: "포스팅을 찾을 수 없습니다." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { postId, content, targetKeywords: declaredKeywords, ...patch } = body;
    const publishing = patch.status === "published";

    // 발행하는 순간 추적 계약을 박는다. 나중에 주제가 바뀌어도 뭘 측정했는지 남는다.
    const trackingUrl = patch.naverPostUrl ?? exists.naverPostUrl;
    const outcomeTracking = exists.outcomeTracking
      // 계약이 이미 있으면 검색어만 갈아끼운다.
      ? declaredKeywords
        ? reviseKeywords(exists.outcomeTracking, declaredKeywords, now)
        : null
      : publishing || declaredKeywords
        ? buildOutcomeTracking({
            naverPostUrl: trackingUrl,
            title: patch.title ?? exists.title,
            content: content ?? "",
            targetKeywords: await resolveTargetKeywords(
              exists.topicId,
              patch.title ?? exists.title,
              declaredKeywords
            ),
          })
        : null;
    let updatedPost: PostingRecord | null = null;
    const updated: PostingIndex = {
      posts: index.posts.map((p) =>
        p.postId === postId
          ? (updatedPost = {
              ...p,
              ...patch,
              ...(outcomeTracking ? { outcomeTracking } : {}),
              publishedAt: publishing ? (patch.publishedAt ?? p.publishedAt ?? now) : (patch.publishedAt ?? p.publishedAt),
              updatedAt: now,
            })
          : p
      ),
      lastUpdated: now,
    };

    await writeJsonFile(
      Paths.postingListIndex(),
      updated,
      `chore: update post ${postId}`,
      sha
    );

    if (typeof content === "string") {
      const contentPath = Paths.postContent(postId);
      const contentSha = (await fileExists(contentPath)) ? (await readFile(contentPath)).sha : null;
      await writeFile(
        contentPath,
        content,
        `chore: update post content ${postId}`,
        contentSha
      );
    }

    if (publishing && exists.topicId) {
      await markTopicPublished(exists.topicId).catch((err: unknown) => {
        console.warn("[PATCH /api/github/posts] topic publish update failed", err);
      });
    }

    let maintenance: AfterPublishMaintenanceResult | null = null;
    if (publishing && updatedPost) {
      maintenance = await runAfterPublishMaintenance({ post: updatedPost }).catch((err: unknown) => {
        console.warn("[PATCH /api/github/posts] after publish maintenance failed", err);
        return null;
      });
    }

    return NextResponse.json({
      updated: true,
      learned: maintenance?.learned ?? false,
      corpusSynced: maintenance?.corpusSynced ?? false,
      autoGeneratedTopics: maintenance?.generatedCount ?? 0,
    });
  } catch (err) {
    console.error("[PATCH /api/github/posts]", err);
    return NextResponse.json({ error: "포스팅 수정 실패" }, { status: 500 });
  }
}

async function markTopicPublished(topicId: string): Promise<void> {
  const path = Paths.topicsIndex();
  if (!(await fileExists(path))) return;

  const { data: index, sha } = await readJsonFile<TopicIndex>(path);
  const now = new Date().toISOString();
  const updated: TopicIndex = {
    topics: index.topics.map((topic) =>
      topic.topicId === topicId ? { ...topic, status: "published", updatedAt: now } : topic
    ),
    lastUpdated: now,
  };

  await writeJsonFile(path, updated, `chore: topic ${topicId} -> published`, sha);
}

// 인덱스 항목 삭제
export async function DELETE(request: NextRequest) {
  const postId = request.nextUrl.searchParams.get("postId");
  if (!postId) {
    return NextResponse.json({ error: "postId가 필요합니다." }, { status: 400 });
  }

  try {
    const { data: index, sha } = await loadIndex();
    const before = index.posts.length;
    const updated: PostingIndex = {
      posts: index.posts.filter((p) => p.postId !== postId),
      lastUpdated: new Date().toISOString(),
    };

    if (updated.posts.length === before) {
      return NextResponse.json({ error: "포스팅을 찾을 수 없습니다." }, { status: 404 });
    }

    await writeJsonFile(
      Paths.postingListIndex(),
      updated,
      `chore: delete post ${postId}`,
      sha
    );

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[DELETE /api/github/posts]", err);
    return NextResponse.json({ error: "포스팅 삭제 실패" }, { status: 500 });
  }
}

// blog URL에서 블로그 ID 추출 → userId 매핑
async function resolveBlogUserId(blog: string | undefined, url: string | undefined): Promise<string> {
  // blog 컬럼이 이미 userId 형식 (a~e)이면 그대로 사용
  if (blog && /^[a-e]$/i.test(blog.trim())) return blog.trim().toLowerCase();

  // URL에서 블로그 ID 추출
  const blogId = url?.match(/blog\.naver\.com\/([^/?#]+)/)?.[1]?.toLowerCase()
    ?? blog?.toLowerCase().replace(/블로그$/, "").trim();

  if (!blogId) return "imported";

  // 프로필 조회로 매핑
  try {
    const { readJsonFile, fileExists } = await import("@/lib/github/repository");
    const { Paths } = await import("@/lib/github/paths");
    for (const uid of ["a", "b", "c", "d", "e"]) {
      const path = Paths.userProfile(uid);
      if (!(await fileExists(path))) continue;
      const { data } = await readJsonFile<{ naverBlogUrl?: string }>(path);
      const profileBlogId = data.naverBlogUrl?.match(/blog\.naver\.com\/([^/?#]+)/)?.[1]?.toLowerCase();
      if (profileBlogId && profileBlogId === blogId) return uid;
    }
  } catch {
    // 조회 실패 시 fallthrough
  }
  return "imported";
}

// 일괄 가져오기 — 한 번에 읽고 한 번에 쓰기 (SHA 충돌 방지)
// body: { records: Array<{ title: string; url?: string; userId?: string; blog?: string }> }
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as {
      records: Array<{ title: string; url?: string; userId?: string; blog?: string }>;
    };
    if (!Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "records 배열이 필요합니다." }, { status: 400 });
    }

    const { data: index, sha } = await loadIndex();
    const now = new Date().toISOString();

    // 중복 감지: URL 또는 제목이 이미 존재하는 항목 제외
    const existingUrls = new Set(
      index.posts.map((p) => p.naverPostUrl?.toLowerCase()).filter(Boolean)
    );
    const existingTitles = new Set(index.posts.map((p) => p.title.toLowerCase()));

    const { randomUUID } = await import("crypto");
    let duplicates = 0;
    const newPosts: PostingRecord[] = [];

    for (const r of body.records) {
      const urlKey = r.url?.trim().toLowerCase();
      const titleKey = r.title.trim().toLowerCase();
      if ((urlKey && existingUrls.has(urlKey)) || existingTitles.has(titleKey)) {
        duplicates++;
        continue;
      }
      const resolvedUserId = normalizeUserId(r.userId ?? await resolveBlogUserId(r.blog, r.url));
      newPosts.push({
        postId: `post-import-${randomUUID().slice(0, 8)}`,
        topicId: "",
        userId: resolvedUserId,
        title: r.title.trim(),
        status: "published" as const,
        naverPostUrl: r.url?.trim() || null,
        evalScore: null,
        wordCount: 0,
        compositionSessionId: null,
        pendingApproval: null,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      // 이번 배치 내 중복도 방지
      if (urlKey) existingUrls.add(urlKey);
      existingTitles.add(titleKey);
    }

    if (newPosts.length > 0) {
      const updated: PostingIndex = {
        posts: [...index.posts, ...newPosts],
        lastUpdated: now,
      };
      await writeJsonFile(
        Paths.postingListIndex(),
        updated,
        `feat: bulk import ${newPosts.length} posts`,
        sha
      );
    }

    let learned = 0;
    let corpusSynced = 0;
    for (const post of newPosts) {
      const maintenance = await runAfterPublishMaintenance({
        post,
        autoGenerateTopics: false,
      }).catch((err: unknown) => {
        console.warn("[PUT /api/github/posts] after import learning failed", err);
        return null;
      });
      if (maintenance?.learned) learned += 1;
      if (maintenance?.corpusSynced) corpusSynced += 1;
    }

    return NextResponse.json({ added: newPosts.length, duplicates, learned, corpusSynced });
  } catch (err) {
    console.error("[PUT /api/github/posts]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "일괄 가져오기 실패" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Omit<PostingRecord, "createdAt" | "updatedAt"> & {
      targetKeywords?: string[];
    };

    if (!body.postId || !body.userId || !body.title) {
      return NextResponse.json(
        { error: "postId, userId, title이 필요합니다." },
        { status: 400 }
      );
    }

    const { data: index, sha } = await loadIndex();

    const now = new Date().toISOString();
    // 글목록에 넣을 때 노린 검색어를 같이 받는다. 나중에 추측으로 채우면
    // 그 추측이 그대로 성적표가 된다.
    const tracking = buildOutcomeTracking({
      naverPostUrl: body.naverPostUrl ?? null,
      title: body.title,
      content: "",
      targetKeywords: await resolveTargetKeywords(
        body.topicId ?? "",
        body.title,
        body.targetKeywords
      ),
      at: now,
      backfilled: true,
    });

    const newRecord: PostingRecord = {
      ...body,
      ...(tracking ? { outcomeTracking: tracking } : {}),
      userId: normalizeUserId(body.userId),
      status: body.status ?? "draft",
      naverPostUrl: body.naverPostUrl ?? null,
      evalScore: body.evalScore ?? null,
      wordCount: body.wordCount ?? 0,
      compositionSessionId: body.compositionSessionId ?? null,
      pendingApproval: body.pendingApproval ?? null,
      publishedAt: body.publishedAt ?? (body.status === "published" ? now : null),
      createdAt: now,
      updatedAt: now,
    };

    const updated: PostingIndex = {
      posts: [...index.posts, newRecord],
      lastUpdated: now,
    };

    await writeJsonFile(
      Paths.postingListIndex(),
      updated,
      `feat: add post record "${newRecord.title}"`,
      sha
    );

    if (newRecord.status === "published" && newRecord.topicId) {
      await markTopicPublished(newRecord.topicId).catch((err: unknown) => {
        console.warn("[POST /api/github/posts] topic publish update failed", err);
      });
    }

    const maintenance = newRecord.status === "published"
      ? await runAfterPublishMaintenance({ post: newRecord }).catch((err: unknown) => {
          console.warn("[POST /api/github/posts] after publish maintenance failed", err);
          return null;
        })
      : null;

    return NextResponse.json(
      {
        post: newRecord,
        learned: maintenance?.learned ?? false,
        corpusSynced: maintenance?.corpusSynced ?? false,
        autoGeneratedTopics: maintenance?.generatedCount ?? 0,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/github/posts]", err);
    return NextResponse.json({ error: "포스팅 기록 생성 실패" }, { status: 500 });
  }
}
