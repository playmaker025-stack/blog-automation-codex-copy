import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

let store = new Map();

const gh = {
  async fileExists(path) {
    return store.has(path);
  },
  async readJsonFile(path) {
    if (!store.has(path)) throw new Error(`Not found: ${path}`);
    const entry = store.get(path);
    return { data: structuredClone(entry.data), sha: entry.sha };
  },
  async writeJsonFile(path, data, _message, _sha) {
    const sha = `sha-${Math.random().toString(36).slice(2, 9)}`;
    store.set(path, { data: structuredClone(data), sha });
    return sha;
  },
};

const ALLOWED_TRANSITIONS = {
  draft_ready: ["waiting_for_user_approval"],
  waiting_for_user_approval: ["approved_pending_record_update", "draft_ready"],
  approved_pending_record_update: ["records_updated"],
  records_updated: ["released"],
  released: [],
};

function statePath(pipelineId) {
  return `data/pipeline-ledger/approval-states/${pipelineId}.json`;
}

async function initApprovalState(params) {
  const now = new Date().toISOString();
  const record = {
    pipelineId: params.pipelineId,
    topicId: params.topicId,
    userId: params.userId,
    state: "draft_ready",
    history: [{ from: null, to: "draft_ready", reason: "pipeline started", at: now, actor: "system" }],
    createdAt: now,
    updatedAt: now,
  };
  await gh.writeJsonFile(statePath(params.pipelineId), record, "init", null);
  return record;
}

async function transitionApprovalState(params) {
  const path = statePath(params.pipelineId);
  if (!(await gh.fileExists(path))) return { success: false, error: "missing" };
  const { data: record, sha } = await gh.readJsonFile(path);
  const allowed = ALLOWED_TRANSITIONS[record.state] ?? [];
  if (!allowed.includes(params.to)) {
    return { success: false, error: `invalid transition: ${record.state} -> ${params.to}`, record };
  }
  const now = new Date().toISOString();
  const updated = {
    ...record,
    state: params.to,
    history: [...record.history, { from: record.state, to: params.to, reason: params.reason, at: now, actor: params.actor ?? "system" }],
    updatedAt: now,
  };
  await gh.writeJsonFile(path, updated, `state -> ${params.to}`, sha);
  return { success: true, record: updated };
}

async function forceApprovalState(params) {
  const path = statePath(params.pipelineId);
  if (!(await gh.fileExists(path))) return { success: false, error: "missing" };
  const { data: record, sha } = await gh.readJsonFile(path);
  const now = new Date().toISOString();
  const updated = {
    ...record,
    state: params.to,
    history: [...record.history, { from: record.state, to: params.to, reason: `[FORCE] ${params.reason}`, at: now, actor: params.actor }],
    updatedAt: now,
  };
  await gh.writeJsonFile(path, updated, `force -> ${params.to}`, sha);
  return { success: true, record: updated };
}

async function getApprovalState(pipelineId) {
  const path = statePath(pipelineId);
  if (!(await gh.fileExists(path))) return null;
  const { data } = await gh.readJsonFile(path);
  return data;
}

const LOG_PATH = "data/pipeline-ledger/operation-log.json";

async function appendLog(pipelineId, entry) {
  const exists = await gh.fileExists(LOG_PATH);
  const current = exists ? (await gh.readJsonFile(LOG_PATH)).data : { entries: [], lastUpdated: "" };
  const sha = exists ? (await gh.readJsonFile(LOG_PATH)).sha : null;
  const now = new Date().toISOString();
  const newEntry = { ...entry, pipelineId, at: now };
  await gh.writeJsonFile(LOG_PATH, { entries: [...current.entries, newEntry], lastUpdated: now }, "log", sha);
}

async function getLogEntries(filter = {}) {
  if (!(await gh.fileExists(LOG_PATH))) return [];
  const { data } = await gh.readJsonFile(LOG_PATH);
  let entries = data.entries;
  if (filter.type) entries = entries.filter((entry) => entry.type === filter.type);
  if (filter.pipelineId) entries = entries.filter((entry) => entry.pipelineId === filter.pipelineId);
  return entries;
}

function runPostAuditGate({ auditReport, minScore = 70 }) {
  if (!auditReport) return { passed: true, blockedBy: null, reason: "skip" };
  if (!auditReport.pass || auditReport.aggregateScore < minScore) {
    return { passed: false, blockedBy: "audit_not_approved", reason: `score below threshold: ${auditReport.aggregateScore}` };
  }
  return { passed: true, blockedBy: null, reason: `passed: ${auditReport.aggregateScore}` };
}

function buildCompletionSupport(strategy, title) {
  const seeds = [...strategy.keywords, ...title.split(/\s+/), "네이버블로그", "블로그초안", "정보글"]
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set();
  const hashtags = [];
  for (const seed of seeds) {
    const tag = `#${seed.replace(/[^\p{L}\p{N}]/gu, "")}`;
    if (tag.length > 1 && !seen.has(tag)) {
      seen.add(tag);
      hashtags.push(tag);
    }
    if (hashtags.length === 10) break;
  }
  while (hashtags.length < 10) hashtags.push(`#추천태그${hashtags.length + 1}`);
  const slug = title.replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-").toLowerCase() || "blog-draft";
  return {
    hashtags,
    imageFileNames: [
      `${slug}-01-cover.jpg`,
      `${slug}-02-main-subject.jpg`,
      `${slug}-03-detail-cut.jpg`,
      `${slug}-04-comparison.jpg`,
      `${slug}-05-checklist.jpg`,
      `${slug}-06-closing.jpg`,
    ],
  };
}

async function simulatePipelineRun(pipelineId, evalScore) {
  const postId = `post-${pipelineId}`;
  const strategy = { keywords: ["부평전자담배", "입문기기"], title: "부평 전자담배 입문 기기 추천" };

  await initApprovalState({ pipelineId, topicId: "t-001", userId: "u-001" });
  await transitionApprovalState({ pipelineId, to: "waiting_for_user_approval", reason: "approval requested" });
  await transitionApprovalState({ pipelineId, to: "approved_pending_record_update", reason: "approved" });

  await gh.writeJsonFile("data/posting-list/index.json", {
    posts: [{ postId, topicId: "t-001", status: "draft", wordCount: 1200, title: strategy.title }],
    lastUpdated: "",
  }, "draft", null);

  await transitionApprovalState({ pipelineId, to: "records_updated", reason: "records updated" });

  const auditReport = { pass: evalScore >= 70, aggregateScore: evalScore };
  const postGate = runPostAuditGate({ auditReport });
  const completionSupport = buildCompletionSupport(strategy, strategy.title);
  const { data: list, sha } = await gh.readJsonFile("data/posting-list/index.json");

  if (!postGate.passed) {
    await gh.writeJsonFile("data/posting-list/index.json",
      { posts: list.posts.map((post) => post.postId === postId ? { ...post, status: "ready", evalScore } : post), lastUpdated: "" },
      "low-score draft saved", sha
    );
    await transitionApprovalState({ pipelineId, to: "released", reason: `Draft saved with eval warning: ${postGate.reason}` });
    await appendLog(pipelineId, { type: "gate_result", gate: "post-audit", passed: false, blockedBy: postGate.blockedBy, reason: postGate.reason, evalScore });
    return { stage: "complete", postStatus: "ready", approvalState: "released", pass: false, ...completionSupport };
  }

  await gh.writeJsonFile("data/posting-list/index.json",
    { posts: list.posts.map((post) => post.postId === postId ? { ...post, status: "approved", evalScore } : post), lastUpdated: "" },
    "approved", sha
  );
  await transitionApprovalState({ pipelineId, to: "released", reason: "released" });
  await appendLog(pipelineId, { type: "gate_result", gate: "post-audit", passed: true, blockedBy: null, reason: postGate.reason, evalScore });
  return { stage: "complete", postStatus: "approved", approvalState: "released", pass: true, ...completionSupport };
}

describe("Phase 5 current completion policy", () => {
  beforeEach(() => { store.clear(); });

  test("low eval score completes the write and saves a ready draft", async () => {
    const result = await simulatePipelineRun("pipe-low-001", 55);
    assert.equal(result.stage, "complete");
    assert.equal(result.postStatus, "ready");
    assert.equal(result.approvalState, "released");
    assert.equal(result.pass, false);

    const { data: list } = await gh.readJsonFile("data/posting-list/index.json");
    assert.equal(list.posts[0].status, "ready");
    assert.equal(list.posts[0].evalScore, 55);
  });

  test("low eval score still returns hashtags and image file names", async () => {
    const result = await simulatePipelineRun("pipe-low-002", 58);
    assert.equal(result.hashtags.length, 10);
    assert.equal(result.imageFileNames.length, 6);
    assert.ok(result.imageFileNames.every((name) => name.endsWith(".jpg")));
  });

  test("passing eval score approves the post", async () => {
    const result = await simulatePipelineRun("pipe-pass-001", 85);
    assert.equal(result.stage, "complete");
    assert.equal(result.postStatus, "approved");
    assert.equal(result.approvalState, "released");
    assert.equal(result.pass, true);
  });
});

describe("Phase 5 approval state machine", () => {
  beforeEach(() => { store.clear(); });

  test("normal approval flow reaches released", async () => {
    const pipelineId = "pipe-sm-001";
    await initApprovalState({ pipelineId, topicId: "t-1", userId: "u-1" });
    for (const to of ["waiting_for_user_approval", "approved_pending_record_update", "records_updated", "released"]) {
      const result = await transitionApprovalState({ pipelineId, to, reason: "test" });
      assert.equal(result.success, true);
    }
    const final = await getApprovalState(pipelineId);
    assert.equal(final.state, "released");
    assert.equal(final.history.length, 5);
  });

  test("released is final unless admin force is used", async () => {
    const pipelineId = "pipe-sm-released";
    await initApprovalState({ pipelineId, topicId: "t", userId: "u" });
    for (const to of ["waiting_for_user_approval", "approved_pending_record_update", "records_updated", "released"]) {
      await transitionApprovalState({ pipelineId, to, reason: "test" });
    }
    const result = await transitionApprovalState({ pipelineId, to: "draft_ready", reason: "invalid" });
    assert.equal(result.success, false);
  });

  test("admin force transition is recorded", async () => {
    const pipelineId = "pipe-sm-force";
    await initApprovalState({ pipelineId, topicId: "t", userId: "u" });
    const result = await forceApprovalState({ pipelineId, to: "released", reason: "manual recovery", actor: "admin" });
    assert.equal(result.success, true);
    const state = await getApprovalState(pipelineId);
    assert.equal(state.state, "released");
    assert.ok(state.history.at(-1).reason.startsWith("[FORCE]"));
  });
});

describe("Phase 5 operation logging", () => {
  beforeEach(() => { store.clear(); });

  test("gate_result and pipeline_failure logs accumulate", async () => {
    await appendLog("pipe-log-001", { type: "gate_result", gate: "post-audit", passed: false, blockedBy: "audit_not_approved", reason: "score 65", evalScore: 65 });
    await appendLog("pipe-log-001", { type: "pipeline_failure", stage: "writing", topicId: "t", userId: "u", message: "network timeout", recoveredTopicToDraft: true });

    const gates = await getLogEntries({ type: "gate_result" });
    const failures = await getLogEntries({ type: "pipeline_failure" });
    assert.equal(gates.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].recoveredTopicToDraft, true);
  });

  test("pipelineId filter returns only matching entries", async () => {
    await appendLog("pipe-A", { type: "gate_result", gate: "pre-write", passed: true, blockedBy: null, reason: "ok" });
    await appendLog("pipe-B", { type: "gate_result", gate: "post-audit", passed: false, blockedBy: "audit_not_approved", reason: "low" });
    const entries = await getLogEntries({ pipelineId: "pipe-A" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].pipelineId, "pipe-A");
  });
});
