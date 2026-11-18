import type { Metadata } from "next";
import { Bungee, Chivo, Silkscreen } from "next/font/google";
import Link from "next/link";
import { SiteNav } from "@/components/rpg";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opportunity Compass",
  description:
    "帮助缺少资源和人脉的学生发现真实机会、看懂资格与现实障碍、选择走得通的成长路线。",
};

const bungee = Bungee({ weight: "400", subsets: ["latin"], variable: "--font-bungee", display: "swap" });
const chivo = Chivo({ weight: ["400", "700", "900"], subsets: ["latin"], variable: "--font-chivo", display: "swap" });
const silkscreen = Silkscreen({ weight: "700", subsets: ["latin"], variable: "--font-silkscreen", display: "swap" });

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
    <html lang="zh-CN" className={`${bungee.variable} ${chivo.variable} ${silkscreen.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="shell-bar crt">
          <nav className="shell-bar__inner" aria-label="Main navigation">
            <Link href="/" className="shell-mark">
              Opportunity Compass
            </Link>
            <SiteNav items={navItems} />
          </nav>
        </header>
        <main className="shell-main">{children}</main>
      </body>
    </html>
  );
}
