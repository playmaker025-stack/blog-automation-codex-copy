"use client";

import { useEffect, useRef } from "react";
import type { SSEEvent } from "@/lib/agents/types";

interface Props {
  events: SSEEvent[];
  streamingBody: string;
  showLogs?: boolean;
}

export function PipelineStream({ events, streamingBody, showLogs = true }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  const progressEvents = events.filter(
    (event) =>
      event.type === "stage_change" ||
      event.type === "progress" ||
      event.type === "error"
  );

  return (
    <div className="space-y-3">
      {streamingBody && (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              <p className="text-xs font-medium text-zinc-500">본문 생성 중</p>
            </div>
            <span className="shrink-0 text-[11px] text-zinc-400">
              {streamingBody.length.toLocaleString()}자
            </span>
          </div>
          <div className="min-h-[28rem] max-h-[calc(100vh-14rem)] overflow-y-auto bg-zinc-950 px-5 py-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-white">
              {streamingBody}
            </pre>
          </div>
        </div>
      )}

      {showLogs && (
        <div
          ref={logRef}
          className="h-32 overflow-y-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs"
        >
          {progressEvents.length === 0 ? (
            <p className="text-zinc-600">파이프라인 실행 대기 중</p>
          ) : (
            progressEvents.map((event, index) => {
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
      )}
    </div>
  );
}
