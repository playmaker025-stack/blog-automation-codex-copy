"use client";

import { useEffect, useRef } from "react";
import type { SSEEvent } from "@/lib/agents/types";

interface Props {
  events: SSEEvent[];
  streamingBody: string;
}

export function PipelineStream({ events, streamingBody }: Props) {
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
        <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-2 border-b border-zinc-100 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <p className="text-xs text-zinc-500 font-medium">본문 생성 중</p>
            </div>
            <span className="text-[11px] text-zinc-400 shrink-0">
              {streamingBody.length.toLocaleString()}자
            </span>
          </div>
          <div className="px-5 py-4 min-h-[28rem] max-h-[calc(100vh-14rem)] overflow-y-auto bg-zinc-950">
            <pre className="text-sm text-white whitespace-pre-wrap font-sans leading-7">
              {streamingBody}
            </pre>
          </div>
        </div>
      )}

      <div
        ref={logRef}
        className="bg-zinc-950 rounded-lg p-4 h-32 overflow-y-auto font-mono text-xs"
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
    </div>
  );
}
