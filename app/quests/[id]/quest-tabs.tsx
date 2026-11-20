"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type QuestTab = { id: string; label: string; badge?: string; content: ReactNode };

/** The tab named in ?tab= when it exists, otherwise the first tab. */
export function tabFromSearch(search: string, ids: string[]): string {
  const v = new URLSearchParams(search).get("tab");
  return v && ids.includes(v) ? v : ids[0];
}

/**
 * Quest details split into tabs so only one part shows at a time. The tab is kept in ?tab= (replaced, not pushed,
 * so Back still leaves the page), arrow keys move between tabs, and every panel prints.
 */
export function QuestTabs({ tabs }: { tabs: QuestTab[] }) {
  const ids = tabs.map((t) => t.id);
  const [active, setActive] = useState(ids[0]);
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const idsKey = ids.join(",");

  useEffect(() => {
    const timer = window.setTimeout(() => setActive(tabFromSearch(window.location.search, idsKey.split(","))));
    return () => window.clearTimeout(timer);
  }, [idsKey]);

  const choose = (id: string, focus = false) => {
    setActive(id);
    const url = new URL(window.location.href);
    if (id === ids[0]) url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState(window.history.state, "", url);
    if (focus) listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const i = ids.indexOf(active);
    const next = event.key === "ArrowRight" ? ids[(i + 1) % ids.length]
      : event.key === "ArrowLeft" ? ids[(i - 1 + ids.length) % ids.length]
      : event.key === "Home" ? ids[0]
      : event.key === "End" ? ids[ids.length - 1]
      : null;
    if (!next) return;
    event.preventDefault();
    choose(next, true);
  };

  return (
    <div className="quest-tabs">
      <div ref={listRef} role="tablist" aria-label="Opportunity details" className="quest-tabs__list print:hidden" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            id={`${baseId}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => choose(t.id)}
          >
            {t.label}
            {t.badge && <span className="quest-tabs__badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${baseId}-panel-${t.id}`}
          aria-labelledby={`${baseId}-tab-${t.id}`}
          tabIndex={0}
          className={active === t.id ? "quest-tabs__panel rpg-stack rpg-stack--loose" : "quest-tabs__panel rpg-stack rpg-stack--loose hidden print:block"}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
