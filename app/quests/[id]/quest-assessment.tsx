"use client";
import Link from "next/link";
import { checkEligibility } from "../../../lib/eligibility";
import { analyzeReachability } from "../../../lib/reachability";
import { planRoutes } from "../../../lib/path";
import { analyzeGaps } from "../../../lib/gap";
import { explainMatch, findAlternatives } from "../../../lib/match";
import { GAP_CATEGORIES, type GapCategory, type GapItem, type Opportunity, type ResourceGrant, type StudentProfile } from "../../../lib/types";
import type { QuestContext } from "../use-quest-context";
import { JournalButton } from "./journal-button";
import { MatchExplanationSection } from "./match-and-gaps";
const categoryLabels: Record<GapCategory, string> = { knowledge_or_experience: "Knowledge or experience", materials: "Materials", time_and_cost: "Time and cost", unchangeable_eligibility: "Eligibility limits for this round", unknown_info: "Unknown information" };
const eligibilityLabels = { eligible: "Requirements satisfied", not_eligible: "Hard requirement not met", unknown: "Eligibility unconfirmed" };
const itemLabels = { satisfied: "Satisfied", not_satisfied: "Not satisfied", unknown: "Unknown" };
const tones = { satisfied: "rpg-tag rpg-tag--success", not_satisfied: "rpg-tag rpg-tag--danger", unknown: "rpg-tag rpg-tag--warning" };
const eligibilityTones = { eligible: "rpg-tag rpg-tag--success", not_eligible: "rpg-tag rpg-tag--danger", unknown: "rpg-tag rpg-tag--warning" };
const barrierLabels: Record<string, string> = { time: "Time", cost: "Cost", transport: "Transportation", device: "Equipment" };

/** Grants that apply to this student on one opportunity (same rule as grantsFor in lib/store). */
function grantsForOpportunity(grants: ResourceGrant[], studentId: string, oppId: string) {
    return grants.filter(g => g.student_id === studentId && (g.opportunity_id === null || g.opportunity_id === oppId));
}

/** Practical reachability of an alternative, using only the grants that apply to that candidate. */
function candidateReach(profile: StudentProfile, opp: Opportunity | undefined, studentGrants: ResourceGrant[], today: string) {
    if (!opp) return { tone: "rpg-tag rpg-tag--warning", label: "Reachability: Unknown", reachable: null as boolean | null };
    let reachable: boolean | null = null;
    try { reachable = analyzeReachability(profile, opp, grantsForOpportunity(studentGrants, profile.id, opp.id), { today }).reachable; } catch { reachable = null; }
    if (reachable === true) return { tone: "rpg-tag rpg-tag--success", label: "Practically reachable", reachable };
    if (reachable === false) return { tone: "rpg-tag rpg-tag--danger", label: "Open barriers", reachable };
    return { tone: "rpg-tag rpg-tag--warning", label: "Reachability: Unknown", reachable };
}

/** Estimate and basis notes for one gap item (ported from the main-branch gap section). */
function GapNotes({ item }: { item: GapItem }) {
    const estimates = [typeof item.estimated_hours === "number" ? `${item.estimated_hours} h` : null, typeof item.estimated_cost_usd === "number" ? `$${item.estimated_cost_usd}` : null].filter(Boolean);
    const basis = item.basis;
    return <>
 {basis.kind === "prep_item" && basis.source_text && <details><summary>Preparation basis</summary><p>{basis.source_text}</p></details>}
 {basis.kind === "barrier" && <p className="rpg-muted">Based on the practical reachability check ({barrierLabels[basis.barrier_type] ?? basis.barrier_type}).</p>}
 {estimates.length > 0 && <p className="rpg-muted">Estimated {estimates.join(" and ")}</p>}
 </>;
}

export function QuestAssessment({ opportunity, context }: {
    opportunity: Opportunity;
    context: QuestContext;
}) {
    const profile = context.profile;
    const options = { today: context.today };
    // Grants for this student on this opportunity: every engine on this page uses this same list.
    const grants = profile ? grantsForOpportunity(context.grants, profile.id, opportunity.id) : [];
    // Every grant recorded for this student; alternatives use each candidate's own subset.
    const studentGrants = profile ? context.grants.filter(g => g.student_id === profile.id) : [];
    const eligibility = profile ? checkEligibility(profile, opportunity, options) : null;
    const reach = profile ? analyzeReachability(profile, opportunity, grants, options) : null;
    const analysis = profile ? analyzeGaps(profile, opportunity, grants, options) : null;
    const match = profile ? explainMatch(profile, opportunity, { today: context.today, grants }) : null;
    const blocked = eligibility?.overall === "not_eligible" || reach?.reachable === false || !!(context.today && opportunity.deadline && opportunity.deadline < context.today);
    // findAlternatives only applies grants through analyzeReachability, which keeps the ones matching each
    // opportunity, so passing all of the student's grants lets every candidate use its own grants while this
    // opportunity still sees exactly `grants`.
    const alternatives = profile ? findAlternatives(profile, opportunity, context.catalog, { ...options, grants: studentGrants }) : [];
    // When the catalog has no alternative, fall back to the route planner's "next cycle / same field" hints.
    const plan = profile && eligibility?.overall === "not_eligible" && !alternatives.length ? planRoutes(profile, opportunity, options) : null;
    const planHints = plan?.status === "blocked" ? plan.alternatives : [];
    return <>
 {(profile?.is_sample || grants.some(g => g.is_sample)) && <p className="rpg-row">{profile?.is_sample && <span className="rpg-tag rpg-tag--warning">Sample student profile</span>}{grants.some(g => g.is_sample) && <span className="rpg-tag rpg-tag--warning">Simulated support</span>}</p>}
 {context.loaded && !profile && <p><Link href="/passport">Load or create a profile in Skill Passport</Link> to see your eligibility, fit, gaps and support.</p>}
 <div className="rpg-route-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 19rem), 1fr))" }}>
 <section className="rpg-card" style={{ minWidth: 0 }}><h2>Official eligibility</h2><p>{eligibility ? eligibilityLabels[eligibility.overall] : "Eligibility unconfirmed. No student profile is loaded."}</p>
 {!opportunity.requirements.length && <p>No official requirements have been entered. Confirm with the organizer.</p>}
 <ul className="rpg-list">{opportunity.requirements.map(rule => { const item = eligibility?.items.find(i => i.requirement_id === rule.id); return <li key={rule.id}><details><summary><strong>{rule.label}</strong> <span className="rpg-tag">{rule.hard ? "Required" : "Official preference"}</span> <span className={tones[item?.status ?? "unknown"]}>{itemLabels[item?.status ?? "unknown"]}</span></summary><blockquote>{rule.source_text}</blockquote>{item && <p>{item.explanation}</p>}{(!item || item.status === "unknown") && <p>{item?.confirm_with_official ?? "Confirm with the organizer."}</p>}</details></li>; })}</ul></section>
 <section className="rpg-card" style={{ minWidth: 0 }}><h2>Preparation readiness</h2><p>Team suggestions are optional. Estimates cover preparation tasks only, not program fees or participation hours.</p>
 <ul className="rpg-list">{opportunity.preparation.map(item => <li key={item.id}><strong>{item.title}</strong><p>{item.required_for_application ? "Required application material" : "Suggested preparation"}{reach && !reach.readiness_gaps.some(g => g.prep_item_id === item.id) ? " · Covered by recorded evidence" : ""}</p><p>Estimated {item.estimated_hours} h; ${item.estimated_cost_usd}</p>{item.source_text && <details><summary>Preparation basis</summary><p>{item.source_text}</p></details>}</li>)}</ul>{!opportunity.preparation.length && <p>No preparation items recorded.</p>}</section>
 <section className="rpg-card" style={{ minWidth: 0 }}><h2>Practical reachability</h2><p>{reach?.summary ?? "Load a student profile to assess participation constraints."}</p>
 {reach?.barriers.map((barrier, index) => <div key={`${barrier.type}-${index}`}><h3>{barrierLabels[barrier.type]}</h3><p>{barrier.resolved ? "Support applied" : "Open barrier"}</p><p>{barrier.description}</p>{!!barrier.pending_grant_ids?.length && !barrier.resolved && <p>Support is pending approval and has not been applied.</p>}</div>)}
 <p className="rpg-muted">Reachability does not guarantee admission.</p></section></div>
 {match && <MatchExplanationSection match={match} />}
 <section className="rpg-stack"><h2>Your gaps in five categories</h2>{!analysis && <p>Load a profile to identify your gaps. Unknown information will not be treated as satisfied.</p>}{analysis && <p>{analysis.summary}</p>}
 {GAP_CATEGORIES.map(category => <section key={category} className="rpg-card"><h3>{categoryLabels[category]}{analysis && <> <span className="rpg-tag">{analysis.counts[category]} {analysis.counts[category] === 1 ? "item" : "items"}</span></>}</h3>{analysis && !analysis.counts[category] && <p>No recorded gaps in this category.</p>}<ul className="rpg-list">{analysis?.items.filter(item => item.category === category).map(item => <li key={item.id}><strong>{item.title}</strong><p>{item.detail}</p>{item.basis.kind === "missing_field" && <p className="rpg-muted">Missing field: {item.basis.field}</p>}{item.basis.kind === "requirement" && <blockquote>{item.basis.source_text}</blockquote>}<GapNotes item={item} />{category === "unchangeable_eligibility" ? <p>There is no workaround for this round, and none is suggested.</p> : item.improvable && item.action && <p>What you can do: {item.action}</p>}{item.basis.kind === "missing_field" && item.basis.field.startsWith("profile.") && <Link href="/passport">Update this field in Skill Passport</Link>}</li>)}</ul></section>)}</section>
 <section className="rpg-card"><h2>Support received</h2><p>Only approved support can resolve a barrier. Simulated resources are labelled separately.</p>{!grants.some(g => g.status === "approved") && <p>No approved support recorded for this student and opportunity.</p>}
 <ul className="rpg-list">{grants.filter(g => g.status === "approved").map(grant => { const resolved = reach?.barriers.filter(b => b.resolved && b.resolved_by_grant_ids?.includes(grant.id)) ?? []; return <li key={grant.id}><strong>{grant.provider}: {grant.type.replaceAll("_", " ")}</strong>{grant.is_sample && <span className="rpg-tag rpg-tag--warning">Simulated</span>}<p>{resolved.length ? `Resolves: ${resolved.map(b => barrierLabels[b.type]).join(", ")}.` : "Approved resource recorded; no current barrier is confirmed as resolved by this resource."}</p>{grant.note && <p>{grant.note}</p>}</li>; })}</ul></section>
 {(blocked || alternatives.length > 0) && <section className="rpg-card"><h2>Other opportunities and future cycles</h2><p>These suggestions do not bypass the current opportunity requirements. Check each organizer terms.</p>{!alternatives.length && !planHints.length && <p>No suitable alternative was found in the current catalog.</p>}{!alternatives.length && planHints.length > 0 && <ul className="rpg-list">{planHints.map((hint, index) => <li key={index}>{hint.text}</li>)}</ul>}<ul className="rpg-list">{alternatives.map((a, index) => {
     const candidate = context.catalog.find(o => o.id === a.opportunity_id);
     const userPosted = candidate?.source_tier === "user_posted";
     const candidateReachTag = a.kind === "same_field" && profile ? candidateReach(profile, candidate, studentGrants, context.today) : null;
     return <li key={`${a.kind}-${a.opportunity_id}-${index}`}>{a.opportunity_id ? <Link href={`/quests/${encodeURIComponent(a.opportunity_id)}`}>{a.kind === "next_cycle" ? `Future cycle information: ${a.title}` : a.title}</Link> : <strong>{a.title}</strong>}
 {a.kind === "same_field" && <p className="rpg-row"><span className={eligibilityTones[a.eligibility_overall ?? "unknown"]}>{eligibilityLabels[a.eligibility_overall ?? "unknown"]}</span>{candidateReachTag && <span className={candidateReachTag.tone}>{candidateReachTag.label}</span>}{userPosted && <span className="rpg-tag rpg-tag--warning">User-posted · not verified against an official site · Sample</span>}</p>}
 <p>{a.reason}</p>{a.kind === "next_cycle" && <p>The next cycle dates and eligibility are not confirmed.</p>}
 {a.kind === "same_field" && a.eligibility_overall !== "eligible" && <p className="rpg-muted">Some requirements are unconfirmed. Confirm with the organizer.</p>}
 {candidateReachTag?.reachable === true && <p className="rpg-muted">Reachable describes participation constraints only. Admission decisions are made by the organizer.</p>}</li>;
 })}</ul></section>}
 {eligibility?.overall !== "not_eligible" && <Link className="rpg-button rpg-button--secondary" href={`/map?opp=${encodeURIComponent(opportunity.id)}`}>View growth routes</Link>}
 {context.loaded && <JournalButton opportunity={opportunity} profile={profile} today={context.today || null} />}
 </>;
}
