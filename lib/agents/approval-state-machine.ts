/**
 * approval-state-machine ???뚯씠?꾨씪???뱀씤 ?먮쫫 ?곹깭 愿由? *
 * States:
 *   draft_ready                  ???꾨왂 ?꾨즺, ?뱀씤 ?붿껌 ?? *   waiting_for_user_approval    ???뱀씤 ?붿껌 諛쒖넚, ?ъ슜???묐떟 ?湲? *   approved_pending_record_update ???ъ슜???뱀씤, posting-list/index 誘몃컲?? *   records_updated              ??posting-list + index 諛섏쁺 ?꾨즺
 *   audit_failed                 ??post-audit gate 李⑤떒 (draft 蹂댁〈, 諛고룷 遺덇?)
 *   released                     ??紐⑤뱺 gate ?듦낵, 理쒖쥌 諛고룷 ?꾨즺
 *
 * ?덉슜 ?꾩씠:
 *   draft_ready                  ??waiting_for_user_approval
 *   waiting_for_user_approval    ??approved_pending_record_update (?뱀씤)
 *   waiting_for_user_approval    ??draft_ready (嫄곗젅 ???ъ떆??媛??
 *   approved_pending_record_update ??records_updated
 *   records_updated              ??audit_failed (gate 李⑤떒)
 *   records_updated              ??released (gate ?듦낵)
 *   audit_failed                 ??records_updated (愿由ъ옄 ?섎룞 蹂듦뎄)
 *
 * ???寃쎈줈: data/pipeline-ledger/approval-states/{pipelineId}.json
 */

import { writeJsonFile, readJsonFile, fileExists } from "@/lib/github/repository";

// ============================================================
// ???// ============================================================

export type ApprovalState =
  | "draft_ready"
  | "waiting_for_user_approval"
  | "approved_pending_record_update"
  | "records_updated"
  | "audit_failed"
  | "released";

export interface ApprovalStateRecord {
  pipelineId: string;
  topicId: string;
  userId: string;
  state: ApprovalState;
  history: Array<{
    from: ApprovalState | null;
    to: ApprovalState;
    reason: string;
    at: string;
    actor: string; // "system" | userId
  }>;
  createdAt: string;
  updatedAt: string;
  // 李⑤떒 ?뺣낫 (audit_failed ?곹깭????
  gateBlockedBy?: string;
  gateBlockedReason?: string;
  gateBlockedAt?: string;
}

// Allowed state transitions.
const ALLOWED_TRANSITIONS: Record<ApprovalState, ApprovalState[]> = {
  draft_ready:                      ["waiting_for_user_approval"],
  waiting_for_user_approval:        ["approved_pending_record_update", "draft_ready"],
  approved_pending_record_update:   ["records_updated"],
  records_updated:                  ["audit_failed", "released"],
  audit_failed:                     ["records_updated"],   // 愿由ъ옄 蹂듦뎄
  released:                         [],                    // 理쒖쥌 ?곹깭 ???꾩씠 ?놁쓬
};

// ============================================================
// 寃쎈줈
// ============================================================

function statePath(pipelineId: string): string {
  return `data/pipeline-ledger/approval-states/${pipelineId}.json`;
}

// ============================================================
// ?쎄린 / ?곌린
// ============================================================

export async function getApprovalState(
  pipelineId: string
): Promise<ApprovalStateRecord | null> {
  const path = statePath(pipelineId);
  if (!(await fileExists(path))) return null;
  const { data } = await readJsonFile<ApprovalStateRecord>(path);
  return data;
}

export async function initApprovalState(params: {
  pipelineId: string;
  topicId: string;
  userId: string;
}): Promise<ApprovalStateRecord> {
  const path = statePath(params.pipelineId);
  const now = new Date().toISOString();
  const record: ApprovalStateRecord = {
    pipelineId: params.pipelineId,
    topicId: params.topicId,
    userId: params.userId,
    state: "draft_ready",
    history: [{ from: null, to: "draft_ready", reason: "?뚯씠?꾨씪???쒖옉", at: now, actor: "system" }],
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonFile(path, record, `feat: init approval state ${params.pipelineId}`, null);
  return record;
}

export async function transitionApprovalState(params: {
  pipelineId: string;
  to: ApprovalState;
  reason: string;
  actor?: string;
  gateInfo?: { blockedBy?: string; reason?: string };
}): Promise<{ success: boolean; record: ApprovalStateRecord | null; error?: string }> {
  const path = statePath(params.pipelineId);

  if (!(await fileExists(path))) {
    return { success: false, record: null, error: `approval state ?놁쓬: ${params.pipelineId}` };
  }

  const { data: record, sha } = await readJsonFile<ApprovalStateRecord>(path);
  const allowed = ALLOWED_TRANSITIONS[record.state];

  if (!allowed.includes(params.to)) {
    return {
      success: false,
      record,
      error: `?꾩씠 遺덇?: ${record.state} ??${params.to} (?덉슜: ${allowed.join(", ") || "?놁쓬"})`,
    };
  }

  const now = new Date().toISOString();
  const updated: ApprovalStateRecord = {
    ...record,
    state: params.to,
    history: [
      ...record.history,
      { from: record.state, to: params.to, reason: params.reason, at: now, actor: params.actor ?? "system" },
    ],
    updatedAt: now,
    // gate 李⑤떒 ?뺣낫
    ...(params.to === "audit_failed" && params.gateInfo
      ? {
          gateBlockedBy: params.gateInfo.blockedBy,
          gateBlockedReason: params.gateInfo.reason,
          gateBlockedAt: now,
        }
      : {}),
    // Clear gate blocking info after release.
    ...(params.to === "released"
      ? { gateBlockedBy: undefined, gateBlockedReason: undefined, gateBlockedAt: undefined }
      : {}),
  };

  await writeJsonFile(path, updated, `chore: approval state ${params.pipelineId} ??${params.to}`, sha);
  return { success: true, record: updated };
}

// ============================================================
// ?곹깭 媛뺤젣 ?ㅼ젙 (愿由ъ옄 蹂듦뎄??
// ============================================================

export async function forceApprovalState(params: {
  pipelineId: string;
  to: ApprovalState;
  reason: string;
  actor: string;
}): Promise<{ success: boolean; record: ApprovalStateRecord | null; error?: string }> {
  const path = statePath(params.pipelineId);
  if (!(await fileExists(path))) {
    return { success: false, record: null, error: `approval state ?놁쓬: ${params.pipelineId}` };
  }

  const { data: record, sha } = await readJsonFile<ApprovalStateRecord>(path);
  const now = new Date().toISOString();

  const updated: ApprovalStateRecord = {
    ...record,
    state: params.to,
    history: [
      ...record.history,
      {
        from: record.state,
        to: params.to,
        reason: `[FORCE] ${params.reason}`,
        at: now,
        actor: params.actor,
      },
    ],
    updatedAt: now,
  };

  await writeJsonFile(path, updated, `admin: force approval state ${params.pipelineId} ??${params.to}`, sha);
  return { success: true, record: updated };
}
