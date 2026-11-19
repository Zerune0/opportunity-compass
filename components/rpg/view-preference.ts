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

export function useViewPreference() {
  const pathname = usePathname();
  const [view, setView] = useState<ViewPreference>("adventure");
  useEffect(() => {
    const refresh = () => setView(resolveViewPreference(window.location.pathname, window.location.search, loadViewPreference()));
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
    window.dispatchEvent(new Event(eventName));
  }, []);
  return [view, chooseView] as const;
}
