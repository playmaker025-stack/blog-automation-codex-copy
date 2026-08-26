"use client";

/**
 * 사양 원장 화면.
 *
 * 두 갈래로 들어온다.
 *   1) 발행글에서 자동으로 뽑은 후보를 승인/거절
 *   2) 사장님이 아는 값을 직접 입력·수정·삭제
 *
 * 둘 다 필요하다. 글에 안 적힌 사양도 많고, 이미 들어간 값을 바로잡아야 할
 * 때도 있다. 고치려면 사람을 거쳐야 하는 구조면 그게 병목이 된다.
 *
 * 승인/저장한 값만 원장에 들어가고, 원장에 있는 값만 글쓰기에 쓰인다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

type Verdict = "신규" | "충돌" | "동일";

interface Candidate {
  id: string;
  product: string;
  field: string;
  value: string;
  evidence: string;
  postId: string;
  postTitle?: string;
  verdict: Verdict;
  /** 지금 값 그대로 승인이 되는지. false면 고쳐야 한다. */
  coercible?: boolean;
}

interface Spec {
  name: string;
  category: string;
  source: string;
  verifiedAt: string;
  aliases?: string[];
  notes?: string[];
  [key: string]: unknown;
}

interface Registry {
  products: Spec[];
  domainNotes?: string[];
}

interface Payload {
  ok: boolean;
  registry: Registry;
  pending: Candidate[];
  counts: { pending: number; conflict: number; decided: number; products: number };
  fieldLabels: Record<string, string>;
}

const BOOL_FIELDS = new Set([
  "wattControl",
  "airflowControl",
  "batteryRechargeable",
  "liquidRefillable",
]);

export default function SpecsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  /** 원장 편집 공통 호출. 실패 사유를 그대로 화면에 띄운다. */
  const edit = useCallback(
    async (body: Record<string, unknown>, busyKey: string, okMessage: string) => {
      setBusy(busyKey);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/specs/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!json.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
        await load();
        setNotice(okMessage);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const decide = async (c: Candidate, action: "승인" | "거절", value?: string) => {
    setBusy(c.id);
    setError(null);
    try {
      const res = await fetch("/api/specs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, action, value }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "처리에 실패했습니다.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const bulk = async (
    ids: string[],
    action: "승인" | "거절",
    overrides: Record<string, string>
  ) => {
    setBusy("bulk");
    setError(null);
    try {
      const res = await fetch("/api/specs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action, overrides }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        applied?: number;
        failed?: Array<{ id: string; reason: string }>;
      };
      if (!json.ok) throw new Error(json.error ?? "일괄 처리에 실패했습니다.");
      // 실패는 조용히 넘기지 않는다. 뭐가 안 들어갔는지 보여야 한다.
      if (json.failed && json.failed.length > 0) {
        setError(
          `${json.applied ?? 0}건 처리, ${json.failed.length}건 실패. 예: ${json.failed[0].reason}`
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const labels = data?.fieldLabels ?? {};
  const label = (f: string) => labels[f] ?? f;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">사양 원장</h1>
        <p className="mt-1 text-sm text-zinc-500">
          원장에 있는 값만 글쓰기에 쓰입니다. 발행글에서 뽑은 후보를 승인하거나, 아래에서 직접
          입력·수정할 수 있습니다.
        </p>
      </header>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {data && (
        <div className="mb-6 grid grid-cols-4 gap-3">
          <Stat label="확인 대기" value={data.counts.pending} tone={data.counts.pending ? "amber" : "zinc"} />
          <Stat label="기존값과 충돌" value={data.counts.conflict} tone={data.counts.conflict ? "red" : "zinc"} />
          <Stat label="등록 제품" value={data.counts.products} />
          <Stat label="처리 완료" value={data.counts.decided} />
        </div>
      )}

      <PendingSection
        pending={data?.pending ?? []}
        label={label}
        busy={busy}
        onDecide={decide}
        onBulk={bulk}
      />

      <DomainNotesSection
        notes={data?.registry.domainNotes ?? []}
        busy={busy === "domainNotes"}
        onSave={(notes) => edit({ action: "setDomainNotes", notes }, "domainNotes", "업종 규칙을 저장했습니다.")}
      />

      <AddProductForm
        busy={busy === "addProduct"}
        onAdd={(name, category) =>
          edit({ action: "addProduct", name, category }, "addProduct", `${name}을(를) 추가했습니다.`)
        }
      />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">
          등록된 사양 ({data?.registry.products.length ?? 0}개)
        </h2>
        <div className="space-y-2">
          {data?.registry.products.map((p) => (
            <ProductCard
              key={p.name}
              spec={p}
              allFields={Object.keys(labels)}
              label={label}
              busy={busy}
              onEdit={edit}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ── 확인 대기 ────────────────────────────────────────────────

/** 한 번에 그리는 제품 카드 수. 전부 그리면 화면이 멎는다. */
const PAGE_SIZE = 10;

function PendingSection({
  pending,
  label,
  busy,
  onBulk,
}: {
  pending: Candidate[];
  label: (f: string) => string;
  busy: string | null;
  onDecide: (c: Candidate, action: "승인" | "거절", value?: string) => void;
  onBulk: (ids: string[], action: "승인" | "거절", overrides: Record<string, string>) => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  // 기본은 "포함". 사장님이 훑어보다 이상한 것만 빼는 흐름이 자연스럽다.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // 해석 못 하는 값은 처음부터 빼둔다. 눌러봐야 실패하는 걸 버튼에 넣으면 안 된다.
  const autoExcluded = useMemo(
    () => new Set(pending.filter((c) => c.coercible === false).map((c) => c.id)),
    [pending]
  );
  const isOff = (c: Candidate) =>
    excluded.has(c.id) || (autoExcluded.has(c.id) && !edits[c.id]?.trim());
  const [visibleProducts, setVisibleProducts] = useState(PAGE_SIZE);

  const groups = useMemo(() => {
    const byProduct = new Map<string, Candidate[]>();
    for (const c of pending) {
      const list = byProduct.get(c.product) ?? [];
      list.push(c);
      byProduct.set(c.product, list);
    }
    return [...byProduct.entries()]
      .map(([product, items]) => ({
        product,
        items,
        conflicts: items.filter((i) => i.verdict === "충돌").length,
      }))
      // 기존 값과 다른 게 있는 제품을 먼저 본다.
      .sort((a, b) => b.conflicts - a.conflicts || b.items.length - a.items.length);
  }, [pending]);

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visible = groups.slice(0, visibleProducts);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-zinc-700">확인 대기</h2>
        <span className="text-xs text-zinc-500">
          제품 {groups.length}개 · 항목 {pending.length}건
        </span>
      </div>

      {pending.length === 0 ? (
        <p className="rounded border border-zinc-200 bg-zinc-50 px-4 py-5 text-center text-sm text-zinc-500">
          확인할 후보가 없습니다. 새 글이 발행되면 여기에 쌓입니다.
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map(({ product, items, conflicts }) => {
            const included = items.filter((i) => !isOff(i));
            const droppedCount = items.length - included.length;
            return (
              <article key={product} className="rounded-lg border border-zinc-200 bg-white">
                <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
                  <span className="text-base font-semibold text-zinc-900">{product}</span>
                  <span className="text-xs text-zinc-500">{items.length}개 항목</span>
                  {conflicts > 0 && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">
                      기존값과 다른 것 {conflicts}개
                    </span>
                  )}
                </header>

                <div className="divide-y divide-zinc-100">
                  {items.map((c) => {
                    const off = isOff(c);
                    const conflict = c.verdict === "충돌";
                    return (
                      <div
                        key={c.id}
                        className={`px-4 py-3 ${off ? "bg-zinc-50 opacity-60" : conflict ? "bg-red-50/40" : ""}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!off}
                            onChange={() => toggle(c.id)}
                            className="h-4 w-4 accent-zinc-900"
                          />
                          <span className="w-28 shrink-0 text-sm text-zinc-500">{label(c.field)}</span>
                          <input
                            value={edits[c.id] ?? c.value}
                            onChange={(e) => setEdits((p) => ({ ...p, [c.id]: e.target.value }))}
                            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100"
                          />
                          {conflict && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">
                              기존값과 다름
                            </span>
                          )}
                          {c.coercible === false && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                              값을 고쳐야 승인됩니다
                            </span>
                          )}
                        </div>

                        {/* 근거가 이 화면의 핵심. 원문을 안 열고 판단할 수 있어야 한다. */}
                        {c.evidence ? (
                          <blockquote className="mt-1.5 ml-6 border-l-2 border-zinc-300 pl-3 text-[13px] leading-relaxed text-zinc-600">
                            {c.evidence}
                          </blockquote>
                        ) : (
                          <p className="mt-1.5 ml-6 text-[13px] text-amber-600">
                            근거 문장이 없습니다. 원문을 확인하고 판단하세요.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <footer className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-3">
                  <button
                    type="button"
                    disabled={included.length === 0 || busy === "bulk"}
                    onClick={() => onBulk(included.map((i) => i.id), "승인", edits)}
                    className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                  >
                    {busy === "bulk" ? "처리 중…" : `확인 완료 — ${included.length}건 승인`}
                  </button>
                  {droppedCount > 0 && (
                    <button
                      type="button"
                      disabled={busy === "bulk"}
                      onClick={() =>
                        onBulk(
                          items.filter((i) => isOff(i)).map((i) => i.id),
                          "거절",
                          edits
                        )
                      }
                      className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 disabled:opacity-40"
                    >
                      뺀 {droppedCount}건 거절
                    </button>
                  )}
                  <span className="text-[11px] text-zinc-400">
                    값을 고쳐서 승인해도 됩니다. 체크를 풀면 그 항목만 빠집니다.
                  </span>
                </footer>
              </article>
            );
          })}

          {visibleProducts < groups.length && (
            <button
              type="button"
              onClick={() => setVisibleProducts((n) => n + PAGE_SIZE)}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              더 보기 (제품 {groups.length - visibleProducts}개 남음)
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ── 업종 용어 규칙 ───────────────────────────────────────────

function DomainNotesSection({
  notes,
  busy,
  onSave,
}: {
  notes: string[];
  busy: boolean;
  onSave: (notes: string[]) => void;
}) {
  const [text, setText] = useState(notes.join("\n"));
  const [open, setOpen] = useState(false);
  useEffect(() => setText(notes.join("\n")), [notes]);

  return (
    <section className="mb-6 rounded border border-zinc-200 bg-white px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold text-zinc-700">
          업종 용어와 단위 규칙 ({notes.length}개)
        </span>
        <span className="text-xs text-zinc-400">{open ? "닫기" : "열기"}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
            제품에 딸리지 않는 공통 규칙입니다. 한 줄에 하나씩 쓰세요. 예: &ldquo;1% 이하가 기본
            농도, 1%를 넘으면 고농도&rdquo;. 글쓰기 프롬프트 맨 앞에 들어갑니다.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs leading-relaxed"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(text.split("\n"))}
            className="mt-2 rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </section>
  );
}

// ── 제품 추가 ────────────────────────────────────────────────

function AddProductForm({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (name: string, category: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("기기");

  return (
    <section className="mb-6 rounded border border-dashed border-zinc-300 px-4 py-3">
      <p className="mb-2 text-sm font-semibold text-zinc-700">제품 직접 추가</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="제품명 (예: 하복)"
          className="w-52 rounded border border-zinc-300 px-2 py-1 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        >
          <option value="기기">기기</option>
          <option value="일회용">일회용</option>
          <option value="액상">액상</option>
          <option value="소모품">소모품</option>
        </select>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={async () => {
            if (await onAdd(name.trim(), category)) setName("");
          }}
          className="rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {busy ? "…" : "추가"}
        </button>
        <span className="text-[11px] text-zinc-400">추가 후 아래에서 사양을 채우세요</span>
      </div>
    </section>
  );
}

// ── 제품 카드 ────────────────────────────────────────────────

function ProductCard({
  spec,
  allFields,
  label,
  busy,
  onEdit,
}: {
  spec: Spec;
  allFields: string[];
  label: (f: string) => string;
  busy: string | null;
  onEdit: (body: Record<string, unknown>, key: string, msg: string) => Promise<boolean>;
}) {
  const setFields = useMemo(
    () => allFields.filter((f) => spec[f] !== undefined && spec[f] !== null),
    [allFields, spec]
  );
  const unsetFields = useMemo(
    () => allFields.filter((f) => spec[f] === undefined || spec[f] === null),
    [allFields, spec]
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");
  const [notesText, setNotesText] = useState((spec.notes ?? []).join("\n"));
  const [aliasText, setAliasText] = useState((spec.aliases ?? []).join(", "));

  useEffect(() => setNotesText((spec.notes ?? []).join("\n")), [spec.notes]);
  useEffect(() => setAliasText((spec.aliases ?? []).join(", ")), [spec.aliases]);

  const display = (v: unknown) => (typeof v === "boolean" ? (v ? "가능" : "불가") : String(v));
  const key = (suffix: string) => `${spec.name}:${suffix}`;

  return (
    <details className="rounded border border-zinc-200 bg-white px-4 py-2">
      <summary className="cursor-pointer text-sm font-medium text-zinc-800">
        {spec.name}
        <span className="ml-2 text-xs font-normal text-zinc-400">
          {spec.category} · {setFields.length}개 항목
        </span>
      </summary>

      <div className="mt-3 space-y-1">
        {setFields.map((f) => (
          <div key={f} className="flex flex-wrap items-center gap-2 border-b border-zinc-100 py-1">
            <span className="w-44 shrink-0 text-xs text-zinc-500">{label(f)}</span>
            <input
              value={drafts[f] ?? display(spec[f])}
              onChange={(e) => setDrafts((p) => ({ ...p, [f]: e.target.value }))}
              className="w-40 rounded border border-zinc-300 px-2 py-0.5 text-xs"
            />
            {BOOL_FIELDS.has(f) && (
              <span className="text-[10px] text-zinc-400">가능 / 불가</span>
            )}
            <button
              type="button"
              disabled={busy === key(f)}
              onClick={() =>
                onEdit(
                  { action: "setField", product: spec.name, field: f, value: drafts[f] ?? display(spec[f]) },
                  key(f),
                  `${spec.name} ${label(f)}을(를) 저장했습니다.`
                )
              }
              className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              disabled={busy === key(f)}
              onClick={() =>
                onEdit(
                  { action: "clearField", product: spec.name, field: f },
                  key(f),
                  `${spec.name} ${label(f)}을(를) 비웠습니다.`
                )
              }
              className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:text-red-600"
              title="값을 비우면 미확인 상태로 돌아가 경고만 뜹니다"
            >
              비우기
            </button>
          </div>
        ))}
      </div>

      {unsetFields.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={newField}
            onChange={(e) => setNewField(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1 text-xs"
          >
            <option value="">항목 추가…</option>
            {unsetFields.map((f) => (
              <option key={f} value={f}>
                {label(f)}
              </option>
            ))}
          </select>
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="값"
            className="w-36 rounded border border-zinc-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={!newField || !newValue.trim() || busy === key("add")}
            onClick={async () => {
              const ok = await onEdit(
                { action: "setField", product: spec.name, field: newField, value: newValue },
                key("add"),
                `${spec.name}에 ${label(newField)}을(를) 추가했습니다.`
              );
              if (ok) {
                setNewField("");
                setNewValue("");
              }
            }}
            className="rounded bg-zinc-900 px-2.5 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            추가
          </button>
        </div>
      )}

      <div className="mt-4 space-y-3 border-t border-zinc-100 pt-3">
        <EditableList
          title="별칭 (쉼표로 구분)"
          value={aliasText}
          onChange={setAliasText}
          rows={1}
          hint="본문에 다른 표기로 나올 수 있는 이름"
          busy={busy === key("aliases")}
          onSave={() =>
            onEdit(
              { action: "setAliases", product: spec.name, aliases: aliasText.split(",") },
              key("aliases"),
              `${spec.name} 별칭을 저장했습니다.`
            )
          }
        />
        <EditableList
          title="메모 (한 줄에 하나)"
          value={notesText}
          onChange={setNotesText}
          rows={4}
          hint="사양표에 안 들어가는 매장 노하우. 프롬프트에 그대로 들어갑니다."
          busy={busy === key("notes")}
          onSave={() =>
            onEdit(
              { action: "setNotes", product: spec.name, notes: notesText.split("\n") },
              key("notes"),
              `${spec.name} 메모를 저장했습니다.`
            )
          }
        />
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2">
        <p className="text-[10px] text-zinc-400">출처: {spec.source}</p>
        <button
          type="button"
          disabled={busy === key("delete")}
          onClick={() => {
            if (!window.confirm(`${spec.name}을(를) 원장에서 지울까요?`)) return;
            void onEdit(
              { action: "deleteProduct", name: spec.name },
              key("delete"),
              `${spec.name}을(를) 지웠습니다.`
            );
          }}
          className="text-[11px] text-zinc-400 hover:text-red-600"
        >
          제품 삭제
        </button>
      </div>
    </details>
  );
}

function EditableList({
  title,
  value,
  onChange,
  rows,
  hint,
  busy,
  onSave,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  hint: string;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-zinc-600">{title}</p>
      <p className="mb-1 text-[10px] text-zinc-400">{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded border border-zinc-300 px-2 py-1 text-xs leading-relaxed"
      />
      <button
        type="button"
        disabled={busy}
        onClick={onSave}
        className="mt-1 rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
      >
        {busy ? "저장 중…" : "저장"}
      </button>
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
