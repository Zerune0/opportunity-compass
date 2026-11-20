"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import type { ViewPreference } from "@/lib/types";
import { useViewPreference, viewToggleApplies, viewToggleHint } from "./view-preference";

type SiteNavProps = {
  items: { href: string; label: string }[];
};

const viewLabels: Record<ViewPreference, string> = { adventure: "Adventure View", classic: "Classic View" };

export function SiteNav({ items }: SiteNavProps) {
  const pathname = usePathname() ?? "";
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
    {/* Not rendered at all on pages the preference does not change. */}
    {viewToggleApplies(pathname) && <ViewToggle pathname={pathname} />}
    </>
  );
}

function ViewToggle({ pathname }: { pathname: string }) {
  const [view, chooseView] = useViewPreference();
  // The confirmation belongs to the page it was given on; another page starts without one.
  const [confirmed, setConfirmed] = useState<{ path: string; view: ViewPreference } | null>(null);
  const hint = viewToggleHint(pathname);
  const choose = (next: ViewPreference) => {
    chooseView(next);
    setConfirmed({ path: pathname, view: next });
  };
  return (
    <div className="shell-view view-choice">
      <div className="rpg-row" role="group" aria-label="View preference">
        {(["adventure", "classic"] as const).map((option) => (
          <button key={option} type="button" className="rpg-button rpg-button--secondary" aria-pressed={view === option} onClick={() => choose(option)}>
            {view === option && <span aria-hidden="true">✓ </span>}
            {viewLabels[option]}
          </button>
        ))}
        <span className="rpg-small" role="status" aria-live="polite">
          {confirmed?.path === pathname ? `${viewLabels[confirmed.view]} is on.` : ""}
        </span>
      </div>
      {hint && (
        <p className="rpg-small rpg-muted">
          {hint.text}
          {hint.href && <>{" "}<a href={hint.href}>{hint.linkLabel}</a></>}
        </p>
      )}
    </div>
  );
}
