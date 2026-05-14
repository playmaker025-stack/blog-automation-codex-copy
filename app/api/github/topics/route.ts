import { NextRequest, NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, fileExists } from "@/lib/github/repository";
import { Paths } from "@/lib/github/paths";
import type { TopicIndex, Topic } from "@/lib/types/github-data";
import { randomUUID } from "crypto";
import { normalizeUserId } from "@/lib/utils/normalize";

const EMPTY_INDEX: TopicIndex = { topics: [], lastUpdated: "" };

async function loadIndex(): Promise<{ data: TopicIndex; sha: string | null }> {
  const path = Paths.topicsIndex();
  if (!(await fileExists(path))) {
    return { data: { ...EMPTY_INDEX, lastUpdated: new Date().toISOString() }, sha: null };
  }
  const { data, sha } = await readJsonFile<TopicIndex>(path);
  return { data, sha };
}

// Retry helper for GitHub SHA conflicts and transient API failures.
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 8): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const retryable = status === 409 || status === 422 || status === 429 || status === 500 || status === 503;
      if (retryable && attempt < maxAttempts - 1) {
        const base = status === 429 ? 400 : 50;
        const jitter = Math.floor(Math.random() * base) + base;
        await new Promise((r) => setTimeout(r, jitter * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("withRetry: unreachable");
}

function compactTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  const userId = request.nextUrl.searchParams.get("userId");

  try {
    const { data: index } = await loadIndex();
    let topics = index.topics;
    if (status) topics = topics.filter((t) => t.status === status);
    if (userId) {
      const uid = normalizeUserId(userId);
      topics = topics.filter((t) => normalizeUserId(t.assignedUserId ?? "") === uid);
    }
    return NextResponse.json({ topics });
  } catch (err) {
    console.error("[GET /api/github/topics]", err);
    return NextResponse.json({ error: "토픽 목록 조회 실패" }, { status: 500 });
  }
}

// 글목록 교체 저장: 진행 중/발행 완료 항목은 유지하고 나머지를 새 목록으로 교체
// body: { items: Array<{ title: string; blog?: string }> }
export async function PUT(request: NextRequest) {
  let body: { items: Array<{ title: string; blog?: string }> };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 본문 파싱 실패" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items 배열이 필요합니다." }, { status: 400 });
  }

  try {
    let replaced = 0;
    let kept = 0;

    await withRetry(async () => {
      const { data: existing, sha } = await loadIndex();
      const now = new Date().toISOString();

      const locked = existing.topics.filter(
        (t) => t.status === "in-progress" || t.status === "published"
      );
      const lockedTitles = new Set(locked.map((t) => t.title.toLowerCase().trim()));

      const blogToUserId = (blog?: string): string | null =>
        blog ? blog.toLowerCase() : null;

      const newTopics: Topic[] = body.items
        .filter((item) => !lockedTitles.has(item.title.toLowerCase().trim()))
        .map((item) => ({
          topicId: `topic-${randomUUID().slice(0, 8)}`,
          title: item.title.trim(),
          description: "",
          category: item.blog ? `${item.blog} blog` : "general",
          tags: [],
          source: "imported",
          feasibility: null,
          relatedSources: [],
          status: "draft" as const,
          assignedUserId: blogToUserId(item.blog) ? normalizeUserId(blogToUserId(item.blog)!) : null,
          createdAt: now,
          updatedAt: now,
        }));

      const updated: TopicIndex = {
        topics: [...locked, ...newTopics],
        lastUpdated: now,
      };

      await writeJsonFile(
        Paths.topicsIndex(),
        updated,
        `feat: replace topics list (${newTopics.length} items)`,
        sha
      );

      replaced = newTopics.length;
      kept = locked.length;
    });

    return NextResponse.json({ replaced, kept });
  } catch (err) {
    console.error("[PUT /api/github/topics]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "글목록 교체 실패" },
      { status: 500 }
    );
  }
}

// 단일 토픽 수정
export async function PATCH(request: NextRequest) {
  let body: { topicId: string } & Partial<Topic>;
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 본문 파싱 실패" }, { status: 400 });
  }

  if (!body.topicId) {
    return NextResponse.json({ error: "topicId가 필요합니다." }, { status: 400 });
  }

  try {
    await withRetry(async () => {
      const { data: index, sha } = await loadIndex();
      const exists = index.topics.find((t) => t.topicId === body.topicId);
      if (!exists) throw Object.assign(new Error("토픽을 찾을 수 없습니다."), { notFound: true });

      const now = new Date().toISOString();
      const { topicId, ...patch } = body;
      const updated: TopicIndex = {
        topics: index.topics.map((t) =>
          t.topicId === topicId ? { ...t, ...patch, topicId, updatedAt: now } : t
        ),
        lastUpdated: now,
      };

      await writeJsonFile(Paths.topicsIndex(), updated, `chore: update topic ${topicId}`, sha);
    });

    return NextResponse.json({ updated: true });
  } catch (err) {
    if ((err as { notFound?: boolean }).notFound) {
      return NextResponse.json({ error: "토픽을 찾을 수 없습니다." }, { status: 404 });
    }
    console.error("[PATCH /api/github/topics]", err);
    return NextResponse.json({ error: "토픽 수정 실패" }, { status: 500 });
  }
}

// 단일 토픽 삭제
export async function DELETE(request: NextRequest) {
  const topicId = request.nextUrl.searchParams.get("topicId");
  const seriesId = request.nextUrl.searchParams.get("seriesId");
  if (!topicId && !seriesId) {
    return NextResponse.json({ error: "topicId 또는 seriesId가 필요합니다." }, { status: 400 });
  }

  try {
    let notFound = false;
    let inProgress = false;
    let published = false;
    let deletedCount = 0;

    await withRetry(async () => {
      const { data: index, sha } = await loadIndex();

      if (seriesId) {
        const targets = index.topics.filter((t) => t.seriesId === seriesId);
        if (targets.length === 0) { notFound = true; return; }
        if (targets.some((target) => target.status === "in-progress")) { inProgress = true; return; }
        if (targets.some((target) => target.status === "published")) { published = true; return; }

        deletedCount = targets.length;
        const updated: TopicIndex = {
          topics: index.topics.filter((t) => t.seriesId !== seriesId),
          lastUpdated: new Date().toISOString(),
        };

        await writeJsonFile(Paths.topicsIndex(), updated, `chore: delete topic series ${seriesId}`, sha);
        return;
      }

      const target = index.topics.find((t) => t.topicId === topicId);
      if (!target) { notFound = true; return; }
      if (target.status === "in-progress") { inProgress = true; return; }
      if (target.status === "published") { published = true; return; }

      deletedCount = 1;

      const updated: TopicIndex = {
        topics: index.topics.filter((t) => t.topicId !== topicId),
        lastUpdated: new Date().toISOString(),
      };

      await writeJsonFile(Paths.topicsIndex(), updated, `chore: delete topic ${topicId}`, sha);
    });

    if (notFound) return NextResponse.json({ error: "토픽을 찾을 수 없습니다." }, { status: 404 });
    if (inProgress) return NextResponse.json({ error: "진행 중인 토픽은 삭제할 수 없습니다." }, { status: 400 });
    if (published) {
      return NextResponse.json({ error: "발행된 토픽이 포함되어 있어 삭제할 수 없습니다." }, { status: 400 });
    }
    return NextResponse.json({ deleted: true, deletedCount });
  } catch (err) {
    console.error("[DELETE /api/github/topics]", err);
    return NextResponse.json({ error: "토픽 삭제 실패" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Partial<Topic>;
  try {
    body = await request.json() as Partial<Topic>;
  } catch {
    return NextResponse.json({ error: "요청 본문 파싱 실패" }, { status: 400 });
  }

  if (!body.title) {
    return NextResponse.json({ error: "title이 필요합니다." }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const newTopic: Topic = {
      topicId: body.topicId?.trim() || `topic-${randomUUID().slice(0, 8)}`,
      title: body.title,
      description: body.description ?? "",
      category: body.category ?? "일반",
      tags: body.tags ?? [],
      source: body.source ?? "manual",
      contentKind: body.contentKind,
      seriesId: body.seriesId,
      seriesRole: body.seriesRole,
      targetMainKeyword: body.targetMainKeyword,
      sequenceOrder: body.sequenceOrder,
      prerequisiteTopicIds: body.prerequisiteTopicIds,
      feasibility: null,
      relatedSources: body.relatedSources ?? [],
      status: "draft",
      assignedUserId: body.assignedUserId ? normalizeUserId(body.assignedUserId) : null,
      createdAt: now,
      updatedAt: now,
    };

    await withRetry(async () => {
      const { data: index, sha } = await loadIndex();
      const duplicate = index.topics.find(
        (topic) =>
          compactTitle(topic.title) === compactTitle(newTopic.title) &&
          normalizeUserId(topic.assignedUserId ?? "") === normalizeUserId(newTopic.assignedUserId ?? "") &&
          topic.status !== "archived" &&
          !(newTopic.source === "direct" && topic.status === "published")
      );
      if (duplicate) {
        const mergedTopic: Topic = {
          ...duplicate,
          description: newTopic.description || duplicate.description,
          category: newTopic.category || duplicate.category,
          tags: newTopic.tags.length > 0 ? newTopic.tags : duplicate.tags,
          source: newTopic.source ?? duplicate.source,
          contentKind: newTopic.contentKind ?? duplicate.contentKind,
          seriesId: newTopic.seriesId ?? duplicate.seriesId,
          seriesRole: newTopic.seriesRole ?? duplicate.seriesRole,
          targetMainKeyword: newTopic.targetMainKeyword ?? duplicate.targetMainKeyword,
          sequenceOrder: newTopic.sequenceOrder ?? duplicate.sequenceOrder,
          prerequisiteTopicIds: newTopic.prerequisiteTopicIds ?? duplicate.prerequisiteTopicIds,
          assignedUserId: newTopic.assignedUserId ?? duplicate.assignedUserId,
          updatedAt: now,
        };
        const updated: TopicIndex = {
          topics: index.topics.map((topic) =>
            topic.topicId === duplicate.topicId ? mergedTopic : topic
          ),
          lastUpdated: now,
        };
        await writeJsonFile(
          Paths.topicsIndex(),
          updated,
          `chore: enrich topic "${mergedTopic.title}" with incoming metadata`,
          sha
        );
        Object.assign(newTopic, mergedTopic);
        return;
      }
      const updated: TopicIndex = {
        topics: [...index.topics, newTopic],
        lastUpdated: now,
      };
      await writeJsonFile(
        Paths.topicsIndex(),
        updated,
        `feat: add topic "${newTopic.title}"`,
        sha
      );
    });

    return NextResponse.json({ topic: newTopic }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/github/topics]", err);
    return NextResponse.json({ error: "토픽 생성 실패" }, { status: 500 });
  }
}
