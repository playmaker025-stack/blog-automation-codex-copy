"use client";

/**
 * 문체 학습 현황 패널.
 *
 * 그동안 "사용자 문체가 어느 정도 학습됐는지" 볼 방법이 없었다. 그래서 대표 발췌
 * 25개 중 18개가 네이버 UI 문구라는 걸 아무도 몰랐고, 사장님 d는 발행이 뜸한
 * 사이 문체 지문 없이 일반론만 가진 프로필로 몇 달을 보냈다.
 */

import { useCallback, useEffect, useState } from "react";

interface ProfileHealth {
  userId: string;
  exists: boolean;
  updatedAt: string | null;
  sampleCount: number;
  excerptCount: number;
  contaminatedExcerpts: number;
  hasFingerprint: boolean;
  signaturePhrases: string[];
}

interface RebuildResult {
  userId: string;
  sampleCount?: number;
  refreshedExcerpts?: number;
  droppedSamples?: string[];
  error?: string;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("ko-KR");
}

function summarize(results: RebuildResult[]): string {
  const failed = results.filter((r) => r.error);
  const refreshed = results.reduce((sum, r) => sum + (r.refreshedExcerpts ?? 0), 0);
  const dropped = results.reduce((sum, r) => sum + (r.droppedSamples?.length ?? 0), 0);
  const parts = [`발췌 ${refreshed}개 새로 뽑음`];
  if (dropped > 0) parts.push(`본문 없는 샘플 ${dropped}개 제외`);
  if (failed.length > 0) parts.push(`실패 ${failed.length}명`);
  return parts.join(" · ");
}

export default function ProfileHealthPanel() {
  const [health, setHealth] = useState<ProfileHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 관리자 키는 sessionStorage에만 둔다. 탭을 닫으면 사라진다.
  const [adminKey, setAdminKey] = useState("");
  const [needsKey, setNeedsKey] = useState(false);

  useEffect(() => {
    setAdminKey(sessionStorage.getItem("admin-key") ?? "");
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/profile-rebuild?_t=${Date.now()}`)
      .then((r) => r.json())
      .then((data: { health?: ProfileHealth[] }) => setHealth(data.health ?? []))
      .catch(() => setError("학습 현황을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const rebuild = useCallback((userId?: string) => {
    setBusy(userId ?? "all");
    setMessage(null);
    setError(null);
    fetch("/api/admin/profile-rebuild", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": adminKey },
      body: JSON.stringify(userId ? { userId } : {}),
    })
      .then((r) => r.json())
      .then(
        (data: {
          code?: string;
          error?: string;
          results?: RebuildResult[];
          health?: ProfileHealth[];
        }) => {
          if (data.code === "admin_key_required" || data.code === "admin_key_missing") {
            setNeedsKey(true);
            setError(data.error ?? "관리자 키가 필요합니다.");
            return;
          }
          setNeedsKey(false);
          if (data.health) setHealth(data.health);
          if (data.results) setMessage(summarize(data.results));
        }
      )
      .catch(() => setError("재학습에 실패했습니다."))
      .finally(() => setBusy(null));
  }, [adminKey]);

  const needsWork = health.filter((h) => h.contaminatedExcerpts > 0 || !h.hasFingerprint).length;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700">문체 학습 현황</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            AI가 사장님 말투를 흉내 낼 때 본보기로 쓰는 글의 상태입니다.
          </p>
        </div>
        <button
          onClick={() => rebuild()}
          disabled={busy !== null}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 text-white disabled:opacity-40"
        >
          {busy === "all" ? "재학습 중…" : "전원 재학습"}
        </button>
      </div>

      {needsWork > 0 && !loading && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {needsWork}명의 본보기에 네이버 화면 문구가 섞여 있거나 말투 분석이 안 돼 있습니다.
          재학습하면 고쳐집니다.
        </p>
      )}
      {message && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
          {message}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {needsKey && (
        <div className="flex items-center gap-2 mb-3">
          <input
            type="password"
            value={adminKey}
            onChange={(event) => setAdminKey(event.target.value)}
            placeholder="관리자 키 (ADMIN_API_KEY)"
            className="flex-1 text-xs border border-zinc-200 rounded-lg px-2 py-1.5"
          />
          <button
            onClick={() => {
              sessionStorage.setItem("admin-key", adminKey);
              setNeedsKey(false);
              setError(null);
            }}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          >
            저장
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 bg-zinc-100 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {health.map((row) => (
            <div
              key={row.userId}
              className="flex items-center justify-between py-2 border-b border-zinc-50 last:border-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-800">{row.userId}</span>
                  <span className="text-xs text-zinc-400">글 {row.sampleCount}편</span>
                  {row.contaminatedExcerpts > 0 ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-600">
                      본보기 {row.contaminatedExcerpts}/{row.excerptCount} 오염
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                      본보기 깨끗
                    </span>
                  )}
                  {row.hasFingerprint ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                      말투 분석됨
                    </span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                      말투 미분석
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 mt-0.5 truncate">
                  {formatDate(row.updatedAt)}
                  {row.signaturePhrases.length > 0 && ` · 자주 쓰는 말: ${row.signaturePhrases.join(" / ")}`}
                </p>
              </div>
              <button
                onClick={() => rebuild(row.userId)}
                disabled={busy !== null}
                className="text-xs px-2.5 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 shrink-0 ml-3"
              >
                {busy === row.userId ? "재학습 중…" : "재학습"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
