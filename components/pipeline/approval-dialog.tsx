"use client";

import { useState } from "react";
import type { ApprovalRequest, NaverLogicPlan } from "@/lib/agents/types";

interface Props {
  pipelineId: string;
  previousTitle: string;
  proposedTitle: string;
  rationale: string;
  outline: string[];
  naverLogic?: NaverLogicPlan;
  onApprove: (req: ApprovalRequest) => Promise<void>;
  onReject: () => void;
}

export function ApprovalDialog({
  pipelineId,
  previousTitle,
  proposedTitle,
  rationale,
  outline,
  naverLogic,
  onApprove,
  onReject,
}: Props) {
  const [modifications, setModifications] = useState("");
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove({ pipelineId, approved: true });
    } finally {
      setLoading(false);
    }
  };

  const handleApproveWithModifications = async () => {
    setLoading(true);
    try {
      await onApprove({
        pipelineId,
        approved: true,
        modifications: modifications.trim(),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReject = () => {
    setLoading(true);
    try {
      onReject();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border-2 border-amber-400 bg-white shadow-2xl">
        <div className="flex items-center gap-2 rounded-t-xl border-b border-amber-200 bg-amber-50 px-6 py-3">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
          <p className="text-sm font-semibold text-amber-700">승인 대기 중입니다. 전략을 확인한 뒤 다음 액션을 선택해 주세요.</p>
        </div>

        <div className="border-b border-zinc-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-zinc-900">전략 승인 요청</h2>
          <p className="mt-1 text-sm text-zinc-500">
            아래 전략을 승인하면 Master Writer가 본문 작성을 시작합니다.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          {previousTitle !== proposedTitle && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-xs font-medium text-amber-700">제목 변경</p>
              <p className="text-sm text-zinc-500 line-through">{previousTitle}</p>
              <p className="mt-0.5 text-sm font-medium text-zinc-900">{proposedTitle}</p>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">제안 제목</p>
            <p className="text-sm font-semibold text-zinc-900">{proposedTitle}</p>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">전략 근거</p>
            <ol className="space-y-1">
              {rationale
                .split(/(?=\d+\.\s)|\n/)
                .map((item) => item.trim())
                .filter(Boolean)
                .map((item, index) => (
                  <li key={`${item}-${index}`} className="text-sm text-zinc-700">{item}</li>
                ))}
            </ol>
          </div>

          {outline.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-zinc-500">아웃라인</p>
              <ol className="list-inside list-decimal space-y-1">
                {outline.map((heading, index) => (
                  <li key={`${heading}-${index}`} className="text-sm text-zinc-700">{heading}</li>
                ))}
              </ol>
            </div>
          )}

          {naverLogic && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
              <p className="mb-1 text-xs font-medium text-blue-700">네이버 로직 사전 검토</p>
              <p className="text-sm font-semibold text-zinc-900">{naverLogic.label}</p>
              <p className="mt-1 text-xs text-zinc-600">{naverLogic.reason}</p>
              <p className="mt-2 text-xs text-blue-700">목표 완성도 {naverLogic.completenessTarget}% 이상</p>
            </div>
          )}

          <div>
            <label htmlFor="approval-modifications" className="mb-1 block text-xs font-medium text-zinc-500">
              수정 요청 내용
            </label>
            <textarea
              id="approval-modifications"
              value={modifications}
              onChange={(event) => setModifications(event.target.value)}
              placeholder="수정 요청을 적고 '수정 요청 반영 후 계속'을 눌러 주세요."
              rows={2}
              className="w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-100 px-6 py-4">
          <button
            type="button"
            onClick={handleReject}
            disabled={loading}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-50"
          >
            거절
          </button>
          <button
            type="button"
            onClick={handleApproveWithModifications}
            disabled={loading || !modifications.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            수정 요청 반영 후 계속
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "처리 중" : "승인하고 작성 시작"}
          </button>
        </div>
      </div>
    </div>
  );
}
