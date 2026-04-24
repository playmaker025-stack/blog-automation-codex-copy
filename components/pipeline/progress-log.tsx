"use client";

import type { SSEEvent } from "@/lib/agents/types";

interface Props {
  events: SSEEvent[];
}

export function PipelineProgressLog({ events }: Props) {
  return (
    <div className="rounded-xl bg-zinc-950 p-4 font-mono text-xs">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-semibold text-zinc-300">로그 / 처리 내역</p>
        <span className="text-[11px] text-zinc-500">{events.length}건</span>
      </div>
      <div className="max-h-48 space-y-1.5 overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-zinc-600">파이프라인 실행 대기 중</p>
        ) : (
          events.map((event, index) => {
            const data = event.data as Record<string, unknown>;
            const message = (data?.message as string) ?? event.type;
            const color =
              event.type === "error"
                ? "text-red-400"
                : event.type === "stage_change"
                  ? "text-blue-400"
                  : "text-zinc-400";

            return (
              <p key={`${event.timestamp}-${index}`} className={color}>
                <span className="text-zinc-600">
                  {new Date(event.timestamp).toLocaleTimeString("ko-KR")}
                </span>{" "}
                {message}
              </p>
            );
          })
        )}
      </div>
    </div>
  );
}
