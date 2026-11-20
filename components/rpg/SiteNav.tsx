"use client";

import Link from "next/link";
import { useViewPreference } from "./view-preference";
import { usePathname } from "next/navigation";

type SiteNavProps = {
  items: { href: string; label: string }[];
};

export function SiteNav({ items }: SiteNavProps) {
  const [view, chooseView] = useViewPreference();
  const pathname = usePathname() ?? "";
  const hasViewChoice = ["/map", "/journal", "/passport"].includes(pathname);
  return (
    <>
    <ul className="shell-links">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link href={item.href} className="shell-link" aria-current={current ? "page" : undefined}>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
    {hasViewChoice && <div className="view-choice" role="group" aria-label="View preference" aria-describedby="view-choice-note">
      <button className="rpg-button rpg-button--secondary" aria-pressed={view === "adventure"} onClick={() => chooseView("adventure")}>Adventure View</button>
      <button className="rpg-button rpg-button--secondary" aria-pressed={view === "classic"} onClick={() => chooseView("classic")}>Classic View</button>
      <p id="view-choice-note">Same information and actions, different layouts.</p>
    </div>}
    </>
  );
}
