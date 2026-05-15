"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드", icon: "▦", admin: false },
  { href: "/topics", label: "글목록", icon: "◇", admin: false },
  { href: "/pipeline", label: "글쓰기 실행", icon: "▶", admin: false },
  { href: "/posts", label: "발행 인덱스", icon: "≡", admin: false },
  { href: "/eval", label: "운영 리포트", icon: "◉", admin: true },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full shrink-0 bg-zinc-900 text-zinc-100 lg:min-h-screen lg:w-44">
      <div className="border-b border-zinc-800 px-4 py-4 lg:py-6">
        <p className="text-xs uppercase tracking-widest text-zinc-500">Blog Automation</p>
        <p className="mt-1 text-sm font-semibold text-white">네이버 블로그</p>
      </div>

      <nav className="flex flex-1 overflow-x-auto py-2 lg:block lg:py-4">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 whitespace-nowrap px-4 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-zinc-800 font-medium text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.admin && (
                <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">관리자</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="hidden border-t border-zinc-800 px-4 py-4 text-xs text-zinc-600 lg:block">
        v1.0 운영 빌드
      </div>
    </aside>
  );
}
