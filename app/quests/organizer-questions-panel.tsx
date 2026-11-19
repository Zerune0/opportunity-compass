"use client";
import { useState } from "react";
import Link from "next/link";
import { hasOfficialPage } from "../../lib/official-link";
import type { Opportunity } from "../../lib/types";
import type { buildOrganizerQuestions } from "./organizer-questions";

export function OrganizerQuestions({ opportunity, draft }: {
    opportunity: Pick<Opportunity, "official_url" | "is_sample" | "source_tier">;
    draft: ReturnType<typeof buildOrganizerQuestions>;
}) {
    const [copyStatus, setCopyStatus] = useState("");
    if (!draft.questions.length && !draft.profileUpdates.length) return null;
    // Sample / user-posted records have no real organizer and no official page (their URL is an example.com placeholder).
    const official = hasOfficialPage(opportunity);
    async function copyQuestions() {
        try {
            await navigator.clipboard.writeText(draft.message);
            setCopyStatus("Copied. Paste the questions into your own email.");
        } catch {
            setCopyStatus("Copy was unavailable. Select and copy the text below.");
        }
    }
    return <section className="rpg-card" style={{ minWidth: 0 }}>
        <h2>Questions and missing information</h2>
        {draft.profileUpdates.length > 0 && <div>
            <h3>Update your Skill Passport</h3>
            <p>These details belong in your profile before checking your match again.</p>
            <ul>{draft.profileUpdates.map(label => <li key={label}>{label}</li>)}</ul>
            <Link href="/passport">Update Skill Passport</Link>
        </div>}
        {draft.questions.length > 0 && <div>
            <h3>Questions to ask the organizer</h3>
            {official ? <>
                <p>These questions cover information that is still unconfirmed. Asking does not change your eligibility.</p>
                <p>Nothing is sent. Paste it into your own email.</p>
                <p><a href={opportunity.official_url} target="_blank" rel="noreferrer">Open the official program page</a> to find the organizer&apos;s contact details.</p>
            </> : <>
                <p>These questions cover information that is still unconfirmed. Asking does not change your eligibility.</p>
                <p>This is a sample record, so there is no real organizer to contact. You can still copy the questions to see what you would ask. Nothing is sent.</p>
            </>}
            <label>Draft questions
                <textarea readOnly value={draft.message} rows={12} style={{ width: "100%", boxSizing: "border-box", maxWidth: "100%" }} />
            </label>
            <button type="button" className="rpg-button rpg-button--secondary" onClick={copyQuestions}>Copy questions</button>
            <p role="status" aria-live="polite">{copyStatus}</p>
        </div>}
    </section>;
}
