"use client";

import { useState } from "react";
import {
  MAX_TARGET_KEYWORDS,
  isUsableQuery,
  normalizeQuery,
} from "@/lib/agents/post-outcome";

/**
 * 이 글이 노린 검색어를 사람이 넣는 자리.
 *
 * 왜 여러 개인가: 글 하나가 여러 말을 노리는 건 정상이다. 어느 말로 실제로
 * 걸리는지는 재봐야 알고, 그 차이 자체가 다음 글의 재료다. 하나만 받으면
 * 사장님이 머릿속에 갖고 있는 나머지를 앱이 영영 모른다.
 *
 * 엔터나 쉼표로 하나씩 넣는다. 붙여넣기로 여러 줄을 한 번에 넣어도 된다.
 */
export function KeywordInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const added = raw
      .split(/[,\n]/)
      .map(normalizeQuery)
      .filter(isUsableQuery)
      .filter((query) => !value.includes(query));

    if (added.length > 0) onChange([...value, ...added].slice(0, MAX_TARGET_KEYWORDS));
    setDraft("");
  };

  const full = value.length >= MAX_TARGET_KEYWORDS;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((keyword) => (
          <span
            key={keyword}
            className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs rounded-full pl-2.5 pr-1 py-1"
          >
            {keyword}
            <button
              type="button"
              onClick={() => onChange(value.filter((item) => item !== keyword))}
              className="w-4 h-4 rounded-full hover:bg-blue-200 text-blue-500 leading-none"
              aria-label={`${keyword} 빼기`}
            >
              ×
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-zinc-400">아직 없음 — 넣지 않으면 앱이 제목으로 추측합니다</span>
        )}
      </div>

      <input
        value={draft}
        autoFocus={autoFocus}
        disabled={full}
        onChange={(e) => {
          // 쉼표를 치는 순간 하나가 확정된다. 엔터를 몰라도 넣을 수 있게.
          if (e.target.value.includes(",")) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={
          full
            ? `검색어는 ${MAX_TARGET_KEYWORDS}개까지입니다`
            : "예: 부평 전자담배 추천 (엔터로 하나씩, 여러 개 가능)"
        }
        className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-zinc-50"
      />
    </div>
  );
}
