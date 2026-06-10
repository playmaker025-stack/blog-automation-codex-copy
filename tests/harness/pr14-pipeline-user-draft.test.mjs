import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildPipelineUserDraftPayload,
  hasMeaningfulPipelineDraft,
} from "../../lib/pipeline-user-draft.ts";
import { normalizeUserId } from "../../lib/utils/normalize.ts";

const ROOT = process.cwd();
const pipelinePageSource = readFileSync(path.join(ROOT, "app", "pipeline", "page.tsx"), "utf8");
const pipelineStoreSource = readFileSync(path.join(ROOT, "lib", "store", "pipeline-store.ts"), "utf8");
const pipelineDraftRouteSource = readFileSync(
  path.join(ROOT, "app", "api", "pipeline", "draft", "route.ts"),
  "utf8"
);

describe("PR 사용자별 임시저장", () => {
  test("사용자 ID는 대소문자와 user- 접두어를 무시하고 같은 사용자로 정규화한다", () => {
    assert.equal(normalizeUserId(" Mansur "), "mansur");
    assert.equal(normalizeUserId("USER-mansur"), "mansur");
    assert.equal(normalizeUserId("user-MANSUR"), "mansur");
  });

  test("임시저장 payload는 사용자별로 정규화되고 입력값을 정리한다", () => {
    const draft = buildPipelineUserDraftPayload({
      userId: " USER-Mansur ",
      topicMode: "direct",
      selectedTopicId: " topic-1 ",
      directTopicTitle: "  부평 전자담배 액상 추천  ",
      directMainKeyword: "  부평 전자담배 액상 추천 ",
      directSubKeyword: " 입호흡 전자담배 추천 ",
      autoApprove: true,
    });

    assert.equal(draft.userId, "mansur");
    assert.equal(draft.topicMode, "direct");
    assert.equal(draft.selectedTopicId, "topic-1");
    assert.equal(draft.directTopicTitle, "부평 전자담배 액상 추천");
    assert.equal(draft.directMainKeyword, "부평 전자담배 액상 추천");
    assert.equal(draft.directSubKeyword, "입호흡 전자담배 추천");
    assert.equal(draft.autoApprove, true);
    assert.match(draft.updatedAt, /^\d{4}-\d{2}-\d{2}T/u);
  });

  test("내용이 있는 사용자별 입력만 의미 있는 임시저장으로 판단한다", () => {
    assert.equal(
      hasMeaningfulPipelineDraft({
        userId: "mansur",
        topicMode: "list",
        selectedTopicId: "",
        directTopicTitle: "",
        directMainKeyword: "",
        directSubKeyword: "",
        autoApprove: false,
      }),
      false
    );

    assert.equal(
      hasMeaningfulPipelineDraft({
        userId: "mansur",
        topicMode: "direct",
        selectedTopicId: "",
        directTopicTitle: "",
        directMainKeyword: "부평 전자담배 액상 추천",
        directSubKeyword: "",
        autoApprove: false,
      }),
      true
    );
  });

  test("파이프라인 화면은 사용자별 임시저장 API를 불러오고 저장한다", () => {
    assert.match(pipelinePageSource, /\/api\/pipeline\/draft\?userId=/u);
    assert.match(pipelinePageSource, /fetch\("\/api\/pipeline\/draft", \{/u);
    assert.match(pipelinePageSource, /사용자별 임시저장을 불러왔습니다/u);
    assert.match(pipelinePageSource, /사용자별 임시저장이 저장되었습니다/u);
  });

  test("스토어의 사용자 전환 비교는 정규화된 userId 기준으로 동작한다", () => {
    assert.match(
      pipelineStoreSource,
      /normalizeUserId\(s\.userId\) === normalizeUserId\(id\)/u
    );
  });

  test("임시저장 API는 정규화된 사용자 키로 저장 경로를 고정한다", () => {
    assert.match(pipelineDraftRouteSource, /const userId = normalizeUserId\(rawUserId\)/u);
    assert.match(pipelineDraftRouteSource, /const draft = buildPipelineUserDraftPayload\(body\)/u);
    assert.match(pipelineDraftRouteSource, /Paths\.pipelineUserDraft\(draft\.userId\)/u);
  });
});
