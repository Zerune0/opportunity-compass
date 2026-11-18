import type { Metadata } from "next";
import { Bungee, Chivo, Silkscreen } from "next/font/google";
import Link from "next/link";
import { SiteNav } from "@/components/rpg";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opportunity Compass",
  description:
    "Helps students without resources or connections find real opportunities, understand eligibility and real-world barriers, and pick a growth route that works.",
};

const bungee = Bungee({ weight: "400", subsets: ["latin"], variable: "--font-bungee", display: "swap" });
const chivo = Chivo({ weight: ["400", "700", "900"], subsets: ["latin"], variable: "--font-chivo", display: "swap" });
const silkscreen = Silkscreen({ weight: "700", subsets: ["latin"], variable: "--font-silkscreen", display: "swap" });

const navItems = [
  { href: "/quests", label: "Quests" },
  { href: "/map", label: "Map" },
  { href: "/passport", label: "Passport" },
  { href: "/organizer", label: "Organizer" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bungee.variable} ${chivo.variable} ${silkscreen.variable}`}>
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
