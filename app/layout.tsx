import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opportunity Compass",
  description:
    "帮助缺少资源和人脉的学生发现真实机会、看懂资格与现实障碍、选择走得通的成长路线。",
};

const navItems = [
  { href: "/quests", label: "机会 Quests" },
  { href: "/map", label: "成长地图 Map" },
  { href: "/passport", label: "技能护照 Passport" },
  { href: "/organizer", label: "主办方 Organizer" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <header className="border-b border-gray-200">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold">
              Opportunity Compass
            </Link>
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
