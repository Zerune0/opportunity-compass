"use client";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { readBoardQuery, writeBoardQuery } from "./board-discovery";
import { saveSavedOpportunityIds } from "../../lib/store";
import { normalizeTag } from "../../lib/tags";
import { VerificationAge } from "./verification-age-badge";
import type { Opportunity } from "../../lib/types";
import { emptyFilters, filterCatalog, explainCatalog, orderPreparedCatalog, type BoardFilters } from "./board-model";
import { localRecordTag, sourceLabelFor } from "../../lib/sample-origin";
import { sourceLabels, useQuestContext } from "./use-quest-context";
import { SavedComparison } from "./saved-comparison";
import { QuestTable } from "./QuestTable";
import { categories, deadlineText, durationText, feeText, formats, hoursText, locationText, showsOfficialLink, verifiedLabel } from "./quest-labels";
import { useViewPreference } from "@/components/rpg/view-preference";

function subscribeBoardQuery(onChange: () => void) {
    window.addEventListener("popstate", onChange);
    window.addEventListener("quest-board-query", onChange);
    return () => {
        window.removeEventListener("popstate", onChange);
        window.removeEventListener("quest-board-query", onChange);
    };
}
function currentBoardQuery() { return window.location.search; }
function serverBoardQuery() { return ""; }
function saveBoardQuery(filters: BoardFilters, sort: string) {
    const query = writeBoardQuery(window.location.search, filters, sort);
    window.history.replaceState(window.history.state, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
    window.dispatchEvent(new Event("quest-board-query"));
}

export default function QuestBoard() {
    const context = useQuestContext();
    const [view, , viewReady] = useViewPreference();
    // The board's existing look is the card list (what Adventure View shows). Until the stored preference has
    // been read, keep the cards and switch to the table only once Classic is known. This is the reverse of
    // renderedView(), whose "existing markup" fallback is "classic" because those pages started out classic.
    const showTable = viewReady && view === "classic";
    const query = useSyncExternalStore(subscribeBoardQuery, currentBoardQuery, serverBoardQuery);
    const { filters, sort } = readBoardQuery(query, emptyFilters);
    function setFilters(next: BoardFilters | ((old: BoardFilters) => BoardFilters)) { saveBoardQuery(typeof next === "function" ? next(filters) : next, sort); }
    function setSort(next: string) { saveBoardQuery(filters, next); }
    const [filtersExpanded, setFiltersExpanded] = useState(false);
    const activeLabels = [
        filters.q.trim() && `Search: ${filters.q.trim()}`,
        filters.category && `Type: ${Object.hasOwn(categories, filters.category) ? categories[filters.category as Opportunity["category"]] : filters.category}`,
        filters.field && `Field: ${filters.field.replaceAll("_", " ")}`,
        filters.country && `Country: ${filters.country}`,
        filters.state && `State or region: ${filters.state}`,
        filters.hours && `Weekly hours ≤ ${filters.hours}`,
        filters.grade && `Grade or year: ${filters.grade}`,
        filters.maxFee && `Fee ≤ $${filters.maxFee}`,
        filters.closingSoon && "Closing in the next 30 days",
        filters.remote && "Online or hybrid",
        filters.free && "No program or travel fee",
        filters.savedOnly && "Saved only",
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const activeFilterCount = activeLabels.length;
    const [notice, setNotice] = useState("");
    const saved = context.saved;
    function update<K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) { setFilters(old => ({ ...old, [key]: value })); }
    const fields = [...new Set(context.catalog.flatMap(o => o.fields.map(normalizeTag)))].sort();
    const countries = [...new Set(context.catalog.map(o => o.location.country).filter((v): v is string => !!v))].sort();
    const states = [...new Set(context.catalog.filter(o => !filters.country || o.location.country === filters.country).map(o => o.location.state).filter((v): v is string => !!v))].sort();
    const explanations = useMemo(() => explainCatalog(context.catalog, context.profile, context.grants, context.today), [context.catalog, context.profile, context.grants, context.today]);
    const items = orderPreparedCatalog(filterCatalog(context.catalog, filters, saved, context.today), sort, !!context.profile, explanations);
    const hiddenUnknownFees = filters.maxFee ? filterCatalog(context.catalog, { ...filters, maxFee: "" }, saved, context.today).filter(o => o.cost.fee_usd == null).length : 0;
    function toggle(id: string) { const next = saved.includes(id) ? saved.filter(v => v !== id) : [...saved, id]; if (saveSavedOpportunityIds(next)) {
        context.setSaved(next);
        setNotice("Saved opportunities updated.");
    }
    else
        setNotice("Your browser could not save this change. Check storage settings and try again."); }
    return <div className="rpg-stack rpg-stack--loose" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
 <h1>Quest Board</h1><p>Explore official opportunities. Unknown details need confirmation with the organizer. Reachability does not guarantee admission.</p>
 <button type="button" className="rpg-button rpg-button--secondary quest-filter-toggle" aria-expanded={filtersExpanded} aria-controls="quest-filters" onClick={() => setFiltersExpanded(expanded => !expanded)}>{filtersExpanded ? "Hide filters" : "Show filters"}{activeFilterCount > 0 && ` (${activeFilterCount} active)`}</button>
 <fieldset id="quest-filters" data-expanded={filtersExpanded} className="rpg-toolbar quest-filters" style={{ minWidth: 0, flexWrap: "wrap" }}><legend>Filter opportunities</legend>
 <label className="rpg-field">Search opportunities<input type="search" value={filters.q} onChange={e => update("q", e.target.value)} placeholder="Title, organizer, field or summary" /></label>
 <label className="rpg-field">Type<select value={filters.category} onChange={e => update("category", e.target.value)}><option value="">All types</option>{Object.entries(categories).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
 <label className="rpg-field">Field or interest<select value={filters.field} onChange={e => update("field", e.target.value)}><option value="">All fields</option>{fields.map(f => <option key={f} value={f}>{f.replaceAll("_", " ")}</option>)}</select></label>
 <label className="rpg-field">Country<select value={filters.country} onChange={e => setFilters(old => ({ ...old, country: e.target.value, state: "" }))}><option value="">All countries</option>{countries.map(c => <option key={c}>{c}</option>)}</select></label>
 <label className="rpg-field">State or region<select value={filters.state} onChange={e => update("state", e.target.value)}><option value="">All states</option>{states.map(s => <option key={s}>{s}</option>)}</select></label>
 <label className="rpg-field">Maximum weekly hours<input type="number" min="0" step="0.5" value={filters.hours} onChange={e => update("hours", e.target.value)} placeholder="No limit"/></label>
 <label className="rpg-field">Maximum program or application fee (USD)<input type="number" min="0" step="0.01" value={filters.maxFee} onChange={e => update("maxFee", e.target.value)} placeholder="No limit" /></label>
 <label className="rpg-check"><input type="checkbox" checked={filters.closingSoon} onChange={e => update("closingSoon", e.target.checked)} />Closing in the next 30 days</label>
 <label className="rpg-field">Grade or year<select value={filters.grade} onChange={e => update("grade", e.target.value)}><option value="">All grades</option>{[9, 10, 11, 12, 13, 14, 15, 16, 17].map(g => <option key={g} value={g}>{g <= 12 ? `Grade ${g}` : g === 17 ? "Graduate or above" : `College year ${g - 12}`}</option>)}</select></label>
 <label className="rpg-check"><input type="checkbox" checked={filters.remote} onChange={e => update("remote", e.target.checked)}/>Online or hybrid</label>
 <label className="rpg-check"><input type="checkbox" checked={filters.free} onChange={e => update("free", e.target.checked)}/>No program or travel fee</label>
 <label className="rpg-check"><input type="checkbox" checked={filters.savedOnly} onChange={e => update("savedOnly", e.target.checked)}/>Saved only</label>
 <label className="rpg-field">Sort<select value={sort} onChange={e => setSort(e.target.value)}><option value="deadline">Deadline (earliest first)</option><option value="match">Matching interests, then deadline</option></select></label>
 <button type="button" className="rpg-button rpg-button--secondary" onClick={() => saveBoardQuery(emptyFilters, "deadline")}>Reset filters</button></fieldset>
 {activeLabels.length > 0 && <p className="rpg-muted">Active filters: {activeLabels.join(" · ")}</p>}
 {filters.maxFee && <p className="rpg-muted">{hiddenUnknownFees} {hiddenUnknownFees === 1 ? "opportunity with an unknown fee is" : "opportunities with unknown fees are"} hidden by the fee limit. The limit covers recorded program or application fees only; travel and accommodation are separate.</p>}
 {filters.closingSoon && <p className="rpg-muted">Includes deadlines from today through 30 days from today. Unknown deadlines are excluded.</p>}
 {filters.hours && <p className="rpg-muted">Opportunities with unknown weekly hours are excluded by the hours filter.</p>}
 {sort === "match" && <p>Interest matches appear first within each source group. No student scores or rankings are used.{!context.profile && <> <Link href="/passport">Load or create a profile</Link> to see matching reasons.</>}</p>}
 <p role="status">{items.length} {items.length === 1 ? "opportunity" : "opportunities"}. {notice}</p>
 {!items.length && <p>No opportunities match these filters. Try resetting them.</p>}
 <SavedComparison context={context} enabled={filters.savedOnly} />
 {showTable ? <QuestTable items={items} explanations={explanations} hasProfile={!!context.profile} showReasons={sort === "match"} saved={saved} loaded={context.loaded} today={context.today} onToggleSaved={toggle} /> :
 <ul className="rpg-route-grid" style={{ padding: 0, listStyle: "none", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 19rem), 1fr))" }}>
 {items.map(o => <li key={o.id} className="rpg-card rpg-stack" style={{ minWidth: 0 }}>
 <p className="rpg-row"><span className="rpg-tag">{categories[o.category]}</span><span className="rpg-tag">{formats[o.location.format]}</span></p>
 {o.source_tier === "user_posted" ? <p className="rpg-tag rpg-tag--warning">{localRecordTag(o)}</p> : o.is_sample && <p className="rpg-tag rpg-tag--warning">Sample opportunity</p>}
 <h2><Link href={`/quests/${encodeURIComponent(o.id)}`}>{o.title}</Link></h2><p>{o.organizer}</p><p>{o.summary}</p>
 <dl><dt>Deadline</dt><dd>{deadlineText(o)}</dd><dt>Location</dt><dd>{locationText(o)}</dd>
 <dt>Time</dt><dd>{hoursText(o)}; {durationText(o)}</dd>
 <dt>Program fee</dt><dd>{feeText(o)}</dd><dt>Source</dt><dd>{sourceLabelFor(o, sourceLabels[o.source_tier ?? "official"])}</dd><dt>{verifiedLabel(o)}</dt><dd>{o.verified_on}<VerificationAge opportunity={o} today={context.today} /></dd></dl>
 {sort === "match" && explanations.get(o.id)?.reasons.map(r => <p key={r.kind}>{r.text}</p>)}
 <button type="button" className="rpg-button rpg-button--secondary" disabled={!context.loaded} aria-pressed={saved.includes(o.id)} aria-label={`${saved.includes(o.id) ? "Unsave" : "Save"} ${o.title}`} onClick={() => toggle(o.id)}>{saved.includes(o.id) ? "Saved" : "Save opportunity"}</button>
 {showsOfficialLink(o) && <a href={o.official_url}>Official application</a>}
 </li>)}</ul>}</div>;
}
