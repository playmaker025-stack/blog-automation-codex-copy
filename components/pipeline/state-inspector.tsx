"use client";

import type { SSEEvent } from "@/lib/agents/types";

export interface InspectorState {
  selected_topic: string | null;
  remaining_topics_count: number | null;
  strategy_plan_created: boolean;
  approval_required_emitted: boolean;
  approval_received: boolean | null;
  pre_write_gate_result: "pass" | "blocked" | null;
  draft_output_created: boolean;
  blocking_reason: string | null;
}

export const INITIAL_INSPECTOR_STATE: InspectorState = {
  selected_topic: null,
  remaining_topics_count: null,
  strategy_plan_created: false,
  approval_required_emitted: false,
  approval_received: null,
  pre_write_gate_result: null,
  draft_output_created: false,
  blocking_reason: null,
};

export function applyEventToInspector(
  prev: InspectorState,
  event: SSEEvent
): InspectorState {
  if (event.type === "stage_change") {
    if (event.stage === "writing" || event.stage === "evaluating" || event.stage === "complete") {
      return { ...prev, pre_write_gate_result: prev.pre_write_gate_result ?? "pass" };
    }
    return prev;
  }

  if (event.type === "approval_required") {
    return { ...prev, strategy_plan_created: true, approval_required_emitted: true };
  }

  if (event.type === "rejected") {
    return { ...prev, approval_received: false };
  }

  if (event.type === "result") {
    return {
      ...prev,
      pre_write_gate_result: prev.pre_write_gate_result ?? "pass",
      draft_output_created: true,
    };
  }

  if (event.type === "gate_blocked") {
    const data = event.data as { reason?: string; blockedBy?: string } | null;
    return {
      ...prev,
      pre_write_gate_result: "blocked",
      blocking_reason: data?.reason ?? data?.blockedBy ?? "사전 검수에서 차단됨",
    };
  }

  if (event.type === "error") {
    const data = event.data as { message?: string } | null;
    return {
      ...prev,
      blocking_reason: prev.blocking_reason ?? (data?.message ?? "알 수 없는 오류"),
    };
  }

  if (event.type === "progress") {
    const message = ((event.data as { message?: string } | null)?.message ?? "").toLowerCase();
    if (message.includes("pre-write gate 통과") || message.includes("pre-write gate passed")) {
      return { ...prev, pre_write_gate_result: "pass" };
    }
    if (message.includes("pre-write gate 차단") || message.includes("gate_blocked")) {
      return { ...prev, pre_write_gate_result: "blocked", blocking_reason: message };
    }
  }

  return prev;
}

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="inline-block w-2 h-2 rounded-full bg-zinc-300" />;
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
  );
}

interface PipelineStateInspectorProps {
  state: InspectorState;
}

export function PipelineStateInspector({ state }: PipelineStateInspectorProps) {
  const awaitingApproval =
    state.approval_required_emitted &&
    state.approval_received === null &&
    !state.draft_output_created;

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "선택 주제",
      value: state.selected_topic
        ? <span className="inline-block max-w-[220px] truncate text-zinc-800">{state.selected_topic}</span>
        : <span className="text-zinc-400">-</span>,
    },
    {
      label: "남은 주제 수",
      value: state.remaining_topics_count !== null
        ? <span className="font-mono text-zinc-700">{state.remaining_topics_count}개</span>
        : <span className="text-zinc-400">-</span>,
    },
    {
      label: "전략 수립",
      value: (
        <span className="flex items-center gap-1.5">
          <StatusDot ok={state.strategy_plan_created ? true : null} />
          {state.strategy_plan_created ? "완료" : "대기"}
        </span>
      ),
    },
    {
      label: "승인 요청",
      value: (
        <span className="flex items-center gap-1.5">
          <StatusDot ok={state.approval_required_emitted ? true : null} />
          {state.approval_required_emitted ? "발행됨" : "대기"}
        </span>
      ),
    },
    {
      label: "승인 응답",
      value: (
        <span className="flex items-center gap-1.5">
          <StatusDot ok={state.approval_received} />
          {state.approval_received === null ? "미응답" : state.approval_received ? "승인" : "거절"}
        </span>
      ),
    },
    {
      label: "pre-write gate",
      value: (
        <span className="flex items-center gap-1.5">
          <StatusDot
            ok={state.pre_write_gate_result === "pass" ? true : state.pre_write_gate_result === "blocked" ? false : null}
          />
          {state.pre_write_gate_result === "pass" ? "통과" : state.pre_write_gate_result === "blocked" ? "차단" : "대기"}
        </span>
      ),
    },
    {
      label: "본문 작성",
      value: (
        <span className="flex items-center gap-1.5">
          <StatusDot ok={state.draft_output_created ? true : null} />
          {state.draft_output_created ? "완료" : "대기"}
        </span>
      ),
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
      {awaitingApproval && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <p className="text-xs font-semibold text-amber-700">승인 대기 중입니다. 승인 창에서 전략을 확인해 주세요.</p>
        </div>
      )}

      <div className="p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">파이프라인 상태</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {rows.map(({ label, value }) => (
            <div key={label} className="contents">
              <span className="text-xs text-zinc-400">{label}</span>
              <span className="text-xs">{value}</span>
            </div>
          ))}
        </div>

        {state.blocking_reason && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p className="mb-1 text-xs font-semibold text-red-600">차단 / 오류 사유</p>
            <p className="break-all text-xs text-red-700">{state.blocking_reason}</p>
          </div>
        )}
      </div>
    </div>
  );
}
