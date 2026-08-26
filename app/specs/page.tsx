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

/** 한 번에 그리는 카드 수. 전부 그리면 화면이 멎는다. */
const PAGE_SIZE = 40;

function PendingSection({
  pending,
  label,
  busy,
  onDecide,
  onBulk,
}: {
  pending: Candidate[];
  label: (f: string) => string;
  busy: string | null;
  onDecide: (c: Candidate, action: "승인" | "거절", value?: string) => void;
  onBulk: (ids: string[], action: "승인" | "거절", overrides: Record<string, string>) => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 363개를 한꺼번에 그리면 화면이 멎는다. 실측으로 PC가 버벅였다.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visible = pending.slice(0, visibleCount);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = (list: Candidate[]) => setSelected(new Set(list.map((c) => c.id)));

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold text-zinc-700">확인 대기</h2>
      {pending.length === 0 ? (
        <p className="rounded border border-zinc-200 bg-zinc-50 px-4 py-5 text-center text-sm text-zinc-500">
          확인할 후보가 없습니다. 새 글이 발행되면 여기에 쌓입니다.
        </p>
      ) : (
        <div className="space-y-3">
          {/* 하나씩 누르면 후보당 커밋 2개가 나간다. 묶어서 한 번에 보낸다. */}
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-white/95 px-3 py-2 backdrop-blur">
            <span className="text-sm font-medium text-zinc-700">{selected.size}건 선택</span>
            <button
              type="button"
              onClick={() => selectAll(pending.filter((c) => c.verdict !== "충돌"))}
              className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              신규 전체 선택 ({pending.filter((c) => c.verdict !== "충돌").length})
            </button>
            <button
              type="button"
              onClick={() => selectAll(visible)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              보이는 것 전체
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              선택 해제
            </button>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                disabled={selected.size === 0 || busy === "bulk"}
                onClick={() => onBulk([...selected], "승인", edits)}
                className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40"
              >
                {busy === "bulk" ? "처리 중…" : `선택 ${selected.size}건 승인`}
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || busy === "bulk"}
                onClick={() => onBulk([...selected], "거절", edits)}
                className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-600 disabled:opacity-40"
              >
                거절
              </button>
            </div>
          </div>

          {visible.map((c) => {
            const conflict = c.verdict === "충돌";
            return (
              <article
                key={c.id}
                className={`rounded border px-4 py-3 ${
                  conflict ? "border-red-200 bg-red-50/40" : "border-zinc-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mr-1 h-4 w-4 self-center accent-zinc-900"
                  />
                  <span className="font-semibold text-zinc-900">{c.product}</span>
                  <span className="text-sm text-zinc-500">{label(c.field)}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      conflict ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {conflict ? "기존값과 다름" : "신규"}
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

                <p className="mt-1.5 text-[11px] text-zinc-400">출처: {c.postTitle ?? c.postId}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={edits[c.id] ?? c.value}
                    onChange={(e) => setEdits((p) => ({ ...p, [c.id]: e.target.value }))}
                    className="w-44 rounded border border-zinc-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => onDecide(c, "승인", edits[c.id])}
                    className="rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {busy === c.id ? "…" : "승인"}
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => onDecide(c, "거절")}
                    className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                  >
                    거절
                  </button>
                  <span className="text-[11px] text-zinc-400">값을 고쳐서 승인해도 됩니다</span>
                </div>
              </article>
            );
          })}
          {visibleCount < pending.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              더 보기 ({pending.length - visibleCount}건 남음)
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
