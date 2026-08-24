"use client";

/**
 * 사양 원장 화면.
 *
 * 발행글에서 자동으로 뽑은 사양 후보를 사장님이 승인/거절하는 곳이다.
 * 승인해야만 원장에 들어가고, 원장에 들어가야만 글쓰기에 쓰인다.
 *
 * 화면 설계에서 중요한 것 하나: 근거 문장을 크게 보여준다. 원문을 열어봐야
 * 판단할 수 있으면 목록이 밀리고, 밀리면 아무도 안 보게 되고, 그러면 자동
 * 추출은 있으나 마나가 된다.
 */

import { useCallback, useEffect, useState } from "react";

type Verdict = "신규" | "충돌" | "동일";

interface Candidate {
  id: string;
  product: string;
  field: string;
  value: string;
  evidence: string;
  postId: string;
  postTitle?: string;
  extractedAt: string;
  verdict: Verdict;
}

interface Spec {
  name: string;
  category: string;
  source: string;
  verifiedAt: string;
  notes?: string[];
  [key: string]: unknown;
}

interface Payload {
  ok: boolean;
  registry: { products: Spec[]; domainNotes?: string[] };
  pending: Candidate[];
  counts: { pending: number; conflict: number; decided: number; products: number };
  fieldLabels: Record<string, string>;
}

const HIDDEN_FIELDS = new Set(["name", "aliases", "category", "source", "verifiedAt", "notes"]);

export default function SpecsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/specs", { cache: "no-store" });
      const json = (await res.json()) as Payload;
      if (json.ok) setData(json);
      else setError("불러오지 못했습니다.");
    } catch {
      setError("불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (c: Candidate, action: "승인" | "거절") => {
    setBusy(c.id);
    setError(null);
    try {
      const res = await fetch("/api/specs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, action, value: edits[c.id] }),
      });
      const json = (await res.json()) as Payload & { error?: string };
      if (!json.ok) throw new Error(json.error ?? "처리에 실패했습니다.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const label = (f: string) => data?.fieldLabels[f] ?? f;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">사양 원장</h1>
        <p className="mt-1 text-sm text-zinc-500">
          발행글에서 자동으로 뽑은 제품 사양입니다. 승인해야 원장에 들어가고, 원장에 있는 값만
          글쓰기에 쓰입니다.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && (
        <div className="mb-6 grid grid-cols-4 gap-3">
          <Stat label="확인 대기" value={data.counts.pending} tone={data.counts.pending > 0 ? "amber" : "zinc"} />
          <Stat label="기존값과 충돌" value={data.counts.conflict} tone={data.counts.conflict > 0 ? "red" : "zinc"} />
          <Stat label="등록 제품" value={data.counts.products} />
          <Stat label="처리 완료" value={data.counts.decided} />
        </div>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">확인 대기</h2>

        {data?.pending.length === 0 && (
          <p className="rounded border border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
            확인할 후보가 없습니다. 새 글이 발행되면 여기에 쌓입니다.
          </p>
        )}

        <div className="space-y-3">
          {data?.pending.map((c) => {
            const conflict = c.verdict === "충돌";
            return (
              <article
                key={c.id}
                className={`rounded border px-4 py-3 ${
                  conflict ? "border-red-200 bg-red-50/40" : "border-zinc-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold text-zinc-900">{c.product}</span>
                  <span className="text-sm text-zinc-500">{label(c.field)}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      conflict ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {c.verdict === "충돌" ? "기존값과 다름" : "신규"}
                  </span>
                </div>

                {/* 근거가 이 화면의 핵심. 원문을 안 열고 판단할 수 있어야 한다. */}
                {c.evidence ? (
                  <blockquote className="mt-2 border-l-2 border-zinc-300 pl-3 text-sm leading-relaxed text-zinc-600">
                    {c.evidence}
                  </blockquote>
                ) : (
                  <p className="mt-2 text-sm text-amber-600">
                    근거 문장이 없습니다. 원문을 확인하고 판단하세요.
                  </p>
                )}

                <p className="mt-1.5 text-[11px] text-zinc-400">
                  출처: {c.postTitle ?? c.postId}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={edits[c.id] ?? c.value}
                    onChange={(e) => setEdits((p) => ({ ...p, [c.id]: e.target.value }))}
                    className="w-44 rounded border border-zinc-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => void decide(c, "승인")}
                    className="rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {busy === c.id ? "…" : "승인"}
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => void decide(c, "거절")}
                    className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                  >
                    거절
                  </button>
                  <span className="text-[11px] text-zinc-400">값을 고쳐서 승인해도 됩니다</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          등록된 사양 ({data?.registry.products.length ?? 0}개)
        </h2>
        <div className="space-y-2">
          {data?.registry.products.map((p) => {
            const fields = Object.entries(p).filter(
              ([k, v]) => !HIDDEN_FIELDS.has(k) && v !== undefined && v !== null
            );
            return (
              <details key={p.name} className="rounded border border-zinc-200 bg-white px-4 py-2">
                <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                  {p.name}
                  <span className="ml-2 text-xs font-normal text-zinc-400">
                    {p.category} · {fields.length}개 항목
                  </span>
                </summary>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {fields.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                      <dt className="text-zinc-500">{label(k)}</dt>
                      <dd className="text-right font-medium text-zinc-800">
                        {typeof v === "boolean" ? (v ? "가능" : "불가") : String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {p.notes && p.notes.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-500">
                    {p.notes.map((n, i) => (
                      <li key={i}>· {n}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[10px] text-zinc-400">출처: {p.source}</p>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number;
  tone?: "zinc" | "amber" | "red";
}) {
  const color =
    tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-zinc-900";
  return (
    <div className="rounded border border-zinc-200 bg-white px-3 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
