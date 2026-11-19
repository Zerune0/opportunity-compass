"use client";
import { useEffect, useState } from "react";
import { catalogOpportunities } from "../../lib/data";
import { loadGrants, loadProfile, loadSavedOpportunityIds, loadUserPostedOpportunities } from "../../lib/store";
import type { Opportunity, ResourceGrant, StudentProfile } from "../../lib/types";
export const officialCatalog = catalogOpportunities();
export const sourceLabels = { official: "Official organizer", trusted_aggregator: "Trusted aggregator", user_posted: "User posted" };
export type QuestContext = {
    catalog: Opportunity[];
    profile: StudentProfile | null;
    grants: ResourceGrant[];
    saved: string[];
    today: string;
    loaded: boolean;
};
export function useQuestContext() {
    const [context, setContext] = useState<QuestContext>({ catalog: officialCatalog, profile: null, grants: [], saved: [], today: "", loaded: false });
    useEffect(() => {
        function refresh() {
            const d = new Date();
            const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
            const ids = new Set(officialCatalog.map(o => o.id));
            setContext({ catalog: [...officialCatalog, ...loadUserPostedOpportunities().filter(o => !ids.has(o.id))], profile: loadProfile(), grants: loadGrants(), saved: loadSavedOpportunityIds(), today, loaded: true });
        }
        // Storage and the local date must only be read after mount.
        refresh();
        window.addEventListener("focus", refresh);
        window.addEventListener("storage", refresh);
        return () => { window.removeEventListener("focus", refresh); window.removeEventListener("storage", refresh); };
    }, []);
    return { ...context, setSaved: (saved: string[]) => setContext(old => ({ ...old, saved })) };
}
