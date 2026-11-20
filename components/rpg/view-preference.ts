"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { loadViewPreference, saveViewPreference } from "@/lib/store";
import type { ViewPreference } from "@/lib/types";

const eventName = "compass-view-change";

export function resolveViewPreference(path: string, search: string, stored: ViewPreference): ViewPreference {
  const override = new URLSearchParams(search).get("view");
  return path === "/map" && (override === "classic" || override === "adventure") ? override : stored;
}

/** Pages whose content changes with the Adventure / Classic preference. Matches the path itself and its sub-paths. */
const togglePaths = ["/map", "/journal", "/passport"] as const;

/** True when the view toggle changes something on this page, so the nav shows the toggle only there. */
export function viewToggleApplies(pathname: string): boolean {
  // The Quest Board list changes; a quest's detail page (/quests/[id]) does not.
  if (pathname === "/quests") return true;
  return togglePaths.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

/** What the toggle changes on this page, with an in-page link to that part when it sits further down. */
export function viewToggleHint(pathname: string): { text: string; href?: string; linkLabel?: string } | null {
  if (!viewToggleApplies(pathname)) return null;
  if (pathname === "/quests") return { text: "Changes the opportunity list between cards and a table." };
  if (pathname === "/map" || pathname.startsWith("/map/")) return { text: "Changes how routes and steps are shown below." };
  if (pathname === "/journal" || pathname.startsWith("/journal/"))
    return { text: 'Changes how your quests are shown in "My quests".', href: "#journal-quests", linkLabel: "Go to My quests" };
  return { text: "Changes how your saved evidence is shown.", href: "#saved-evidence", linkLabel: "Go to Saved evidence" };
}

/** The view a page renders: its existing (classic) markup until the stored preference has been read. */
export function renderedView(view: ViewPreference, ready: boolean): ViewPreference {
  return ready ? view : "classic";
}

/**
 * Returns `[view, chooseView, ready]`. `view` starts as "adventure" and the stored preference is read after
 * mount; `ready` turns true once it has been read, so a page can keep its classic markup until then and
 * avoid showing one frame of the other view.
 */
export function useViewPreference() {
  const pathname = usePathname();
  const [view, setView] = useState<ViewPreference>("adventure");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const refresh = () => {
      setView(resolveViewPreference(window.location.pathname, window.location.search, loadViewPreference()));
      setReady(true);
    };
    const timer = window.setTimeout(refresh);
    window.addEventListener(eventName, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("popstate", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(eventName, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [pathname]);
  const chooseView = useCallback((next: ViewPreference) => {
    saveViewPreference(next);
    if (window.location.pathname === "/map") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next);
      window.history.replaceState(null, "", url);
    }
    setView(next);
    setReady(true);
    window.dispatchEvent(new Event(eventName));
  }, []);
  return [view, chooseView, ready] as const;
}
