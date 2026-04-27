import type { PipelineStage } from "@/lib/types/agent";

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "strategy-planning", label: "전략 수립" },
  { key: "awaiting-approval", label: "승인 대기" },
  { key: "writing", label: "본문 작성" },
  { key: "evaluating", label: "평가 진행" },
  { key: "complete", label: "완료" },
];

const STAGE_ORDER: PipelineStage[] = [
  "idle",
  "strategy-planning",
  "awaiting-approval",
  "writing",
  "evaluating",
  "gate_blocked",
  "complete",
  "failed",
];

function stageIndex(stage: PipelineStage): number {
  return STAGE_ORDER.indexOf(stage);
}

interface Props {
  currentStage: PipelineStage;
}

export function StageIndicator({ currentStage }: Props) {
  const currentIdx = stageIndex(currentStage);
  const isFailed = currentStage === "failed";
  const isGateBlocked = currentStage === "gate_blocked";

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {STAGES.map((stage, index) => {
        const itemIdx = stageIndex(stage.key);
        const done = !isFailed && currentIdx > itemIdx;
        const active = !isFailed && !isGateBlocked && currentIdx === itemIdx;
        const gateWarning = isGateBlocked && stage.key === "evaluating";

        return (
          <div key={stage.key} className="flex items-center shrink-0">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                  gateWarning
                    ? "border-amber-500 bg-amber-50 text-amber-600"
                    : done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : active
                        ? "border-blue-500 bg-blue-50 text-blue-600"
                        : "border-zinc-300 bg-white text-zinc-400"
                }`}
              >
                {gateWarning ? "!" : done ? "✓" : index + 1}
              </div>
              <span
                className={`mt-1 text-xs whitespace-nowrap ${
                  gateWarning
                    ? "text-amber-600 font-medium"
                    : done
                      ? "text-emerald-600"
                      : active
                        ? "text-blue-600 font-medium"
                        : "text-zinc-400"
                }`}
              >
                {stage.label}
              </span>
            </div>
            {index < STAGES.length - 1 && (
              <div className={`w-12 h-0.5 mb-4 transition-colors ${done ? "bg-emerald-400" : "bg-zinc-200"}`} />
            )}
          </div>
        );
      })}

      {isFailed && <div className="ml-4 text-sm text-red-500 font-medium">실패</div>}
      {isGateBlocked && <div className="ml-4 text-sm text-amber-600 font-medium">평가 주의</div>}
    </div>
  );
}
