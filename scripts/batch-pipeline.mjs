#!/usr/bin/env node
/**
 * batch-pipeline.mjs
 * draft 상태 토픽 전체를 순차 파이프라인 실행 (전략 자동승인)
 *
 * 사용법:
 *   APP_URL=https://blog-automation-production-c462.up.railway.app node scripts/batch-pipeline.mjs
 *   node scripts/batch-pipeline.mjs --dry-run      # 목록만 출력
 *   node scripts/batch-pipeline.mjs --user a       # 특정 사용자만
 *   node scripts/batch-pipeline.mjs --limit 5      # 최대 N개만
 */

const BASE_URL =
  process.env.APP_URL ||
  "https://blog-automation-production-c462.up.railway.app";

const INTER_TOPIC_DELAY_MS = 10_000; // 토픽 간 대기 (10초)
const PIPELINE_TIMEOUT_MS  = 9 * 60 * 1000; // 토픽당 최대 9분

// ── CLI 인수 파싱 ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const USER_FILTER = args.includes("--user")
  ? args[args.indexOf("--user") + 1]
  : null;
const LIMIT = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1], 10)
  : Infinity;

// ── draft 토픽 조회 ──────────────────────────────────────────────────────────
async function fetchDraftTopics() {
  const url = `${BASE_URL}/api/github/topics?status=draft`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`topics 조회 실패: HTTP ${res.status}`);
  const { topics } = await res.json();
  let filtered = topics.filter((t) => t.status === "draft");
  if (USER_FILTER) filtered = filtered.filter((t) => t.assignedUserId === USER_FILTER);
  if (isFinite(LIMIT)) filtered = filtered.slice(0, LIMIT);
  return filtered;
}

// ── 파이프라인 실행 (SSE 스트림 처리) ────────────────────────────────────────
async function runPipeline(topic) {
  const { topicId, assignedUserId: userId = "a", title } = topic;

  return new Promise(async (resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("timeout (9분)"));
    }, PIPELINE_TIMEOUT_MS);

    try {
      const res = await fetch(`${BASE_URL}/api/pipeline/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, userId }),
      });

      if (!res.ok) {
        clearTimeout(timer);
        reject(new Error(`pipeline/run HTTP ${res.status}`));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let approved = false;

      const approveStrategy = async (pipelineId, proposedTitle) => {
        log(topicId, `전략 승인 → "${proposedTitle}"`);
        const ar = await fetch(`${BASE_URL}/api/pipeline/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId, approved: true }),
        });
        if (!ar.ok) log(topicId, `⚠️  승인 응답 HTTP ${ar.status}`);
        else log(topicId, "전략 승인 완료");
      };

      while (true) {
        if (timedOut) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          let event;
          try { event = JSON.parse(chunk.slice(6)); } catch { continue; }

          const { type, data = {} } = event;

          if (type === "stage_change") {
            log(topicId, `단계: ${data.message ?? data.stage ?? ""}`);
          } else if (type === "progress") {
            // 너무 많으면 생략
          } else if (type === "approval_required" && !approved) {
            approved = true;
            await approveStrategy(data.pipelineId, data.proposedTitle ?? title);
          } else if (type === "result") {
            const score = data.score ?? data.evalScore ?? "-";
            const words = data.wordCount ?? "-";
            log(topicId, `✅ 완료 — 점수: ${score} / 단어수: ${words}`);
            clearTimeout(timer);
            resolve({ topicId, status: "done", score, wordCount: words });
            return;
          } else if (type === "gate_blocked") {
            log(topicId, `🚫 게이트 차단: ${data.message ?? ""}`);
            clearTimeout(timer);
            resolve({ topicId, status: "gate_blocked", message: data.message });
            return;
          } else if (type === "rejected") {
            log(topicId, `❌ 거절: ${data.message ?? ""}`);
            clearTimeout(timer);
            resolve({ topicId, status: "rejected", message: data.message });
            return;
          } else if (type === "error") {
            log(topicId, `❌ 오류: ${data.message ?? ""}`);
            clearTimeout(timer);
            reject(new Error(data.message ?? "unknown error"));
            return;
          }
        }
      }

      // 스트림이 이벤트 없이 종료된 경우
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("timeout (9분)"));
      } else {
        resolve({ topicId, status: "stream_ended" });
      }
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

// ── 로그 헬퍼 ────────────────────────────────────────────────────────────────
function log(topicId, msg) {
  const ts = new Date().toLocaleTimeString("ko-KR");
  console.log(`[${ts}] [${topicId.slice(-8)}] ${msg}`);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n배치 파이프라인`);
  console.log(`앱 URL : ${BASE_URL}`);
  if (USER_FILTER) console.log(`사용자 필터: ${USER_FILTER}`);
  if (isFinite(LIMIT)) console.log(`최대 처리: ${LIMIT}개`);
  if (DRY_RUN) console.log("(DRY-RUN 모드 — 실행하지 않음)\n");

  let topics;
  try {
    topics = await fetchDraftTopics();
  } catch (err) {
    console.error("❌ 토픽 조회 실패:", err.message);
    process.exit(1);
  }

  if (topics.length === 0) {
    console.log("\n처리할 draft 토픽이 없습니다.");
    return;
  }

  console.log(`\ndraft 토픽 ${topics.length}개:\n`);
  topics.forEach((t, i) =>
    console.log(`  ${i + 1}. [${t.assignedUserId}] ${t.title} (${t.topicId})`)
  );

  if (DRY_RUN) return;

  console.log("\n\n--- 실행 시작 ---\n");

  const results = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    console.log(`\n[${i + 1}/${topics.length}] "${topic.title}"`);

    try {
      const result = await runPipeline(topic);
      results.push({ ...result, title: topic.title, error: null });
    } catch (err) {
      log(topic.topicId, `❌ 실패: ${err.message}`);
      results.push({
        topicId: topic.topicId,
        title: topic.title,
        status: "error",
        error: err.message,
      });
    }

    if (i < topics.length - 1) {
      console.log(`\n다음 토픽까지 ${INTER_TOPIC_DELAY_MS / 1000}초 대기...`);
      await new Promise((r) => setTimeout(r, INTER_TOPIC_DELAY_MS));
    }
  }

  // ── 결과 요약 ──────────────────────────────────────────────────────────────
  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\n\n=== 배치 결과 ===");
  console.log(`전체: ${results.length}개`);
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}개`));

  const failed = results.filter((r) => r.status === "error");
  if (failed.length > 0) {
    console.log("\n실패 목록:");
    failed.forEach((r) => console.log(`  - ${r.title} → ${r.error}`));
  }
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
