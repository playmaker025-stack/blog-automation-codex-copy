/**
 * 완료 판정, material change 감지, 승인 게이트, 토픽 선택 검증을 담당하는 순수 함수 모듈.
 * GitHub I/O 없이 동작하므로 단위 테스트에 적합하다.
 */

import type { PostingRecord, Topic } from "@/lib/types/github-data";

export interface CrossCheckResult {
  complete: boolean;
  reason: string;
}

export function isTopicComplete(
  topicId: string,
  posts: PostingRecord[],
  topics: Topic[]
): CrossCheckResult {
  const matchingPost = posts.find((post) => post.topicId === topicId && post.status === "published");
  const matchingTopic = topics.find((topic) => topic.topicId === topicId && topic.status === "published");

  if (!matchingPost && !matchingTopic) {
    return { complete: false, reason: "posting-list와 index 모두에 발행 기록이 없습니다." };
  }
  if (!matchingPost) {
    return { complete: false, reason: "posting-list에 published 기록이 없습니다." };
  }
  if (!matchingTopic) {
    return { complete: false, reason: "index에 published 기록이 없습니다." };
  }
  return { complete: true, reason: "posting-list와 index 모두 published 상태입니다." };
}

const MATERIAL_THRESHOLD = 0.45;

export function isMaterialChange(
  originalTitle: string,
  proposedTitle: string
): boolean {
  if (!originalTitle) return false;
  const similarity = titleSimilarity(originalTitle, proposedTitle);
  return similarity < MATERIAL_THRESHOLD;
}

function titleSimilarity(a: string, b: string): number {
  const left = a.toLowerCase().replace(/\s+/g, "");
  const right = b.toLowerCase().replace(/\s+/g, "");
  if (left === right) return 1;
  if (!left || !right) return 0;

  const maxLen = Math.max(left.length, right.length);
  const distance = levenshtein(left, right);
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[a.length][b.length];
}

export class ApprovalGate {
  private approvedState = false;
  private readonly pipelineId: string;

  constructor(pipelineId: string) {
    this.pipelineId = pipelineId;
  }

  grant(): void {
    this.approvedState = true;
  }

  assertApproved(): void {
    if (!this.approvedState) {
      throw new Error(
        `[ApprovalGate] 파이프라인 "${this.pipelineId}": 승인 없이 index update를 시도할 수 없습니다.`
      );
    }
  }

  get approved(): boolean {
    return this.approvedState;
  }
}

export interface TopicSelectionResult {
  valid: boolean;
  reason: string;
}

export function validateTopicSelection(
  topicId: string,
  topics: Topic[]
): TopicSelectionResult {
  const topic = topics.find((item) => item.topicId === topicId);
  if (!topic) {
    return { valid: false, reason: `topicId "${topicId}"를 index에서 찾을 수 없습니다.` };
  }
  if (topic.status === "published") {
    return { valid: false, reason: "이미 발행된 토픽입니다." };
  }
  if (topic.status === "archived") {
    return { valid: false, reason: "보관된 토픽은 선택할 수 없습니다." };
  }
  if (topic.status === "in-progress") {
    return { valid: false, reason: "현재 다른 작업에서 진행 중인 토픽입니다. 완료 후 다시 시도해 주세요." };
  }
  return { valid: true, reason: `토픽 "${topic.title}" 선택 가능` };
}
