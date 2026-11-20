import { hasOfficialPage, type OfficialLinkSource } from "../../lib/official-link";
import type { EligibilityResult, Opportunity, StudentProfile } from "../../lib/types";

const participationQuestions: Record<string, string> = {
    "opportunity.cost.fee_usd": "Could you please confirm the participation or application fee in USD, including whether there is no fee?",
    "opportunity.cost.requires_travel_expense": "Are participants responsible for travel or accommodation expenses?",
    "opportunity.time_commitment.hours_per_week": "Approximately how many hours per week are participants expected to commit?",
    "opportunity.time_commitment.total_weeks": "How many weeks does participation last?",
    "opportunity.location": "In which city and state does the in-person part take place?",
    "opportunity.location.format": "Is participation online, in person, or hybrid? Which activities require attendance?",
    "opportunity.location.country": "In which country does participation take place?",
    "opportunity.location.state": "In which state or region does participation take place?",
    "opportunity.location.city": "In which city does participation take place?",
    "opportunity.required_devices": "What equipment or devices must participants provide?",
    "opportunity.team_requirement": "Is a team required, and what are the minimum and maximum team sizes?",
    "opportunity.team_requirement.required": "Is a team required, or may an applicant participate individually?",
    "opportunity.team_requirement.min_size": "What is the minimum team size?",
    "opportunity.team_requirement.max_size": "What is the maximum team size?",
    "opportunity.deadline": "What is the current application deadline, including the time zone?",
};
/**
 * Profile field names exactly as the engines emit them: `used_profile_fields` in
 * lib/eligibility/index.ts (no prefix) and `profile.*` entries of `missing_info` in lib/reachability.
 */
const profileLabels: Record<string, string> = {
    grade: "Grade", age: "Age or date of birth", birth_date: "Age or date of birth",
    region: "Country or region", "region.state": "State or province",
    citizenships: "Citizenship or legal residency", statuses: "Student status",
    skills: "Skills", evidence: "Evidence",
    devices: "Devices", budget_usd: "Budget", transport: "Transportation",
    hours_per_week_available: "Available hours per week",
};
const profileLabel = (field: string) => Object.hasOwn(profileLabels, field) ? profileLabels[field] : "Other missing profile information";
const stripProfilePrefix = (field: string) => field.trim().replace(/^profile\./, "");
/** null / undefined / blank string / empty array count as missing. Dotted paths are read level by level. */
function isProfileFieldMissing(profile: StudentProfile | null, field: string): boolean {
    if (!profile) return true;
    let value: unknown = profile;
    for (const key of field.split(".")) {
        if (value == null || typeof value !== "object" || !Object.hasOwn(value, key)) return true;
        value = (value as Record<string, unknown>)[key];
    }
    if (value == null) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    return false;
}
const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
const hasFieldPath = (value: string) => /\b(?:opportunity|profile)\.[a-z_]/i.test(value);

/**
 * Uses existing engine outputs only; no eligibility or reachability decisions.
 * An unknown requirement that uses any profile field the student has not filled in goes to the
 * Skill Passport list, not to the organizer message (the engine's hint for it is written to the student).
 * Without a profile, every requirement that uses a profile field is treated as a profile gap.
 * Quoted requirement text is introduced as "Your official page states" only when `hasOfficialPage`
 * is true; user-posted / sample listings (or callers that pass no link fields) get "The listing states".
 */
export function buildOrganizerQuestions(
    opportunity: Pick<Opportunity, "title"> & Partial<OfficialLinkSource>,
    eligibility: Pick<EligibilityResult, "items"> | null,
    missingInfo: readonly string[],
    profile: StudentProfile | null,
) {
    const unknownItems = (eligibility?.items ?? []).filter(item => item.status === "unknown" && item.confirm_with_official?.trim());
    const missingProfileFields: string[] = [];
    const organizerItems = unknownItems.filter(item => {
        const missing = item.used_profile_fields.map(stripProfilePrefix).filter(field => isProfileFieldMissing(profile, field));
        missingProfileFields.push(...missing);
        return missing.length === 0;
    });
    missingProfileFields.push(...missingInfo.filter(field => field.trim().startsWith("profile.")).map(stripProfilePrefix));
    const profileUpdates = unique(unique(missingProfileFields).map(profileLabel));
    const officialPage = hasOfficialPage(opportunity as OfficialLinkSource);
    const quoteLead = officialPage ? "Your official page states" : "The listing states";
    const questions = unique([
        ...organizerItems.map(item => {
            const label = hasFieldPath(item.label) ? "this eligibility requirement" : item.label;
            const priority = item.hard ? "Required eligibility" : "Official preference — not a hard eligibility requirement";
            const question = item.hard
                ? "Could you please clarify this requirement and what evidence applicants should provide?"
                : "Could you please clarify how this preference is considered in selection?";
            // Damaged records may lack source_text: never throw on a non-string.
            const source = typeof item.source_text === "string" ? item.source_text.trim() : "";
            const wording = source && !hasFieldPath(source) ? ` ${quoteLead}: “${source}”` : "";
            return `Regarding ${label}: ${priority}. ${question}${wording}`;
        }),
        ...missingInfo.filter(field => field.startsWith("opportunity.")).map(field =>
            (Object.hasOwn(participationQuestions, field) ? participationQuestions[field] : undefined) ?? `Could you please clarify the remaining participation details that are not specified on the ${officialPage ? "official page" : "listing"}?`,
        ),
    ]);
    const message = questions.length ? [
        `Subject: Questions about ${opportunity.title}`, "",
        "Hello,", "", `I am interested in ${opportunity.title}. Could you please help me confirm the following details?`, "",
        ...questions.map((question, index) => `${index + 1}. ${question}`),
        "", "Thank you for your help.",
    ].join("\n") : "";
    return { questions, profileUpdates, message };
}
