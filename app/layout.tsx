import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blog Automation",
  description: "네이버 블로그 그룹화 작성 시스템",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <body className="flex flex-col lg:flex-row min-h-full bg-zinc-50 antialiased">
        <Sidebar />
        <main className="flex-1 overflow-auto min-w-0">{children}</main>
      </body>
    </html>
  );
}
