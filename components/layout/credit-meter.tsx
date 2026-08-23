"use client";

/**
 * credit-meter — 사이드바 상시 게이지 + 크레딧 소진 시 전역 배너.
 *
 * Anthropic은 잔액 조회 API를 주지 않는다. 그래서 두 갈래로 보여준다.
 *
 * 1) 추정 잔액 — 앱이 센 사용액을 사용자가 찍어둔 잔액 스냅샷에서 뺀다.
 *    "며칠 남았나"까지 계산해서 충전 시점을 미리 알 수 있게 한다.
 * 2) 실제 장애 — 계정 단위 거부(크레딧 소진, 키 오류)가 실제로 나면
 *    추정과 무관하게 화면 최상단에 빨간 배너를 띄운다. 추정이 틀렸어도
 *    이건 사실이다.
 */

import { useCallback, useEffect, useState } from "react";

const CONSOLE_URL = "https://console.anthropic.com/settings/billing";
const POLL_MS = 60_000;

type Level = "unknown" | "healthy" | "low" | "critical" | "empty";

interface Summary {
  todayUsd: number;
  todayCalls: number;
  monthUsd: number;
  last7DaysUsd: number;
  lifetimeUsd: number;
  lifetimeCalls: number;
  dailyAvgUsd: number;
  byModel: Array<{ model: string; calls: number; usd: number }>;
  estimatedRemainingUsd: number | null;
  spentSinceMarkUsd: number | null;
  markedAt: string | null;
  markedBalanceUsd: number | null;
  daysLeft: number | null;
  hasUnpriced: boolean;
  daily: Array<{ date: string; usd: number; calls: number }>;
}

interface Health {
  state: "unknown" | "ok" | "blocked";
  message: string | null;
  blockedAt: string | null;
  label: string | null;
}

interface UsagePayload {
  ok: boolean;
  summary: Summary;
  level: Level;
  health: Health;
}

const LEVEL_STYLE: Record<Level, { dot: string; bar: string; text: string; label: string }> = {
  healthy: { dot: "bg-emerald-400", bar: "bg-emerald-400", text: "text-emerald-300", label: "여유" },
  low: { dot: "bg-amber-400", bar: "bg-amber-400", text: "text-amber-300", label: "곧 충전" },
  critical: { dot: "bg-orange-500", bar: "bg-orange-500", text: "text-orange-300", label: "충전 필요" },
  empty: { dot: "bg-red-500", bar: "bg-red-500", text: "text-red-300", label: "소진" },
  unknown: { dot: "bg-zinc-600", bar: "bg-zinc-600", text: "text-zinc-400", label: "미설정" },
};

const usd = (n: number): string => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);

function formatDays(days: number | null): string {
  if (days === null) return "";
  if (days < 1) return "하루 미만";
  if (days > 90) return "90일+";
  return `약 ${Math.floor(days)}일`;
}

export function CreditMeter() {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      const json = (await res.json()) as UsagePayload;
      if (json.ok) setData(json);
    } catch {
      // 조회 실패는 조용히 넘긴다. 다음 폴링에서 다시 시도한다.
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const saveBalance = async () => {
    const balanceUsd = Number(input.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(balanceUsd) || balanceUsd < 0) {
      setError("숫자를 입력하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balanceUsd }),
      });
      const json = (await res.json()) as UsagePayload & { error?: string };
      if (!json.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
      setData(json);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const level: Level = data?.level ?? "unknown";
  const style = LEVEL_STYLE[level];
  const summary = data?.summary;
  const blocked = data?.health.state === "blocked";

  // 게이지 채움 비율. 스냅샷 잔액 대비 남은 비율이다.
  const ratio =
    summary && summary.markedBalanceUsd && summary.markedBalanceUsd > 0 && summary.estimatedRemainingUsd !== null
      ? Math.max(0, Math.min(1, summary.estimatedRemainingUsd / summary.markedBalanceUsd))
      : 0;

  return (
    <>
      {blocked && (
        <div className="fixed inset-x-0 top-0 z-50 border-b border-red-800 bg-red-950/95 px-4 py-2.5 text-sm text-red-100 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">API 호출이 차단됨</span>
            <span className="text-red-200/90">{data?.health.message}</span>
            <a
              href={CONSOLE_URL}
              target="_blank"
              rel="noreferrer"
              className="ml-auto rounded bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-950 hover:bg-white"
            >
              콘솔에서 충전하기 →
            </a>
          </div>
        </div>
      )}

      <div className="border-t border-zinc-800 px-4 py-3 text-xs">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
          <span className="flex-1 truncate text-zinc-300">
            {summary?.estimatedRemainingUsd !== null && summary
              ? usd(Math.max(0, summary.estimatedRemainingUsd))
              : "잔액 미설정"}
          </span>
          <span className={`shrink-0 ${style.text}`}>
            {summary?.daysLeft !== null && summary ? formatDays(summary.daysLeft) : style.label}
          </span>
        </button>

        {summary?.estimatedRemainingUsd !== null && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all ${style.bar}`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
        )}

        {open && (
          <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3 text-zinc-400">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Stat label="오늘" value={usd(summary?.todayUsd ?? 0)} sub={`${summary?.todayCalls ?? 0}회`} />
              <Stat label="이번 달" value={usd(summary?.monthUsd ?? 0)} />
              <Stat label="일평균" value={usd(summary?.dailyAvgUsd ?? 0)} sub="돌린 날 기준" />
              <Stat label="누적" value={usd(summary?.lifetimeUsd ?? 0)} sub={`${summary?.lifetimeCalls ?? 0}회`} />
            </div>

            {summary && summary.byModel.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">모델별</p>
                {summary.byModel.slice(0, 4).map((m) => (
                  <div key={m.model} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] text-zinc-500">
                      {m.model.replace(/^claude-/, "").replace(/-\d{8}$/, "")}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-300">{usd(m.usd)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">
                콘솔 잔액 입력
              </p>
              <div className="flex gap-1.5">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveBalance();
                  }}
                  placeholder="예: 20.00"
                  inputMode="decimal"
                  className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void saveBalance()}
                  disabled={saving}
                  className="shrink-0 rounded bg-zinc-700 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
                >
                  {saving ? "…" : "기록"}
                </button>
              </div>
              {error && <p className="text-[11px] text-red-400">{error}</p>}
              <p className="text-[10px] leading-relaxed text-zinc-600">
                콘솔에서 본 잔액을 찍어두면 이후 사용액을 빼서 추정합니다. 어긋나면 다시 찍으면
                맞춰집니다.
                {summary?.markedAt && (
                  <>
                    {" "}
                    마지막 기준: {new Date(summary.markedAt).toLocaleDateString("ko-KR")}{" "}
                    {usd(summary.markedBalanceUsd ?? 0)}
                  </>
                )}
              </p>
            </div>

            {summary?.hasUnpriced && (
              <p className="text-[10px] leading-relaxed text-amber-500/80">
                단가표에 없는 모델이 섞여 있어 일부는 Opus 등급으로 추정했습니다.
              </p>
            )}

            <a
              href={CONSOLE_URL}
              target="_blank"
              rel="noreferrer"
              className="block text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
            >
              콘솔에서 실제 잔액 확인 →
            </a>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="tabular-nums text-zinc-200">{value}</p>
      {sub && <p className="text-[10px] text-zinc-600">{sub}</p>}
    </div>
  );
}
