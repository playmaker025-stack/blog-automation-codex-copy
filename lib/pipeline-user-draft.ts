import { normalizeUserId } from "./utils/normalize.ts";

export type PipelineDraftTopicMode = "list" | "direct";

export interface PipelineUserDraftInput {
  userId: string;
  topicMode: PipelineDraftTopicMode;
  selectedTopicId: string;
  directTopicTitle: string;
  directMainKeyword: string;
  directSubKeyword: string;
  autoApprove: boolean;
}

export interface PipelineUserDraft extends PipelineUserDraftInput {
  updatedAt: string;
}

export function normalizePipelineUserDraft(input: PipelineUserDraftInput): PipelineUserDraft {
  return {
    userId: normalizeUserId(input.userId),
    topicMode: input.topicMode === "direct" ? "direct" : "list",
    selectedTopicId: input.selectedTopicId.trim(),
    directTopicTitle: input.directTopicTitle.trim(),
    directMainKeyword: input.directMainKeyword.trim(),
    directSubKeyword: input.directSubKeyword.trim(),
    autoApprove: Boolean(input.autoApprove),
    updatedAt: new Date().toISOString(),
  };
}

export function hasMeaningfulPipelineDraft(input: PipelineUserDraftInput): boolean {
  return Boolean(
    input.selectedTopicId.trim() ||
    input.directTopicTitle.trim() ||
    input.directMainKeyword.trim() ||
    input.directSubKeyword.trim() ||
    input.autoApprove
  );
}

export function buildPipelineUserDraftPayload(input: PipelineUserDraftInput): PipelineUserDraft {
  return normalizePipelineUserDraft(input);
}
