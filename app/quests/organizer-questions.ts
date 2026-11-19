import type { EligibilityResult, Opportunity } from "../../lib/types";

const participationQuestions: Record<string, string> = {
    "opportunity.cost.fee_usd": "Could you please confirm the participation or application fee in USD, including whether there is no fee?",
    "opportunity.cost.requires_travel_expense": "Are participants responsible for travel or accommodation expenses?",
    "opportunity.time_commitment.hours_per_week": "Approximately how many hours per week are participants expected to commit?",
    "opportunity.time_commitment.total_weeks": "How many weeks does participation last?",
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
const profileLabels: Record<string, string> = {
    age: "Age", grade: "Grade", status: "Student status", citizenship: "Citizenship",
    country: "Country", state: "State or region", city: "City",
    available_hours_per_week: "Available hours per week", budget_usd: "Available budget",
    transport: "Transportation", has_reliable_transport: "Transportation",
    devices: "Available equipment", skills: "Skills", evidence: "Experience and evidence",
};
const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
const hasFieldPath = (value: string) => /\b(?:opportunity|profile)\.[a-z_]/i.test(value);

/** Uses existing engine outputs only; no eligibility or reachability decisions. */
export function buildOrganizerQuestions(
    opportunity: Pick<Opportunity, "title">,
    eligibility: Pick<EligibilityResult, "items"> | null,
    missingInfo: readonly string[],
) {
    const profileFields = unique(missingInfo.filter(field => field.startsWith("profile.")));
    const profileUpdates = unique(profileFields.map(field => profileLabels[field.slice(8)] ?? "Other missing profile information"));
    const questions = unique([
        ...(eligibility?.items ?? []).filter(item =>
            item.status === "unknown" && item.confirm_with_official?.trim() &&
            !item.used_profile_fields.some(field => profileFields.includes(field.startsWith("profile.") ? field : `profile.${field}`)),
        ).map(item => {
            const label = hasFieldPath(item.label) ? "this eligibility requirement" : item.label;
            const prompt = item.confirm_with_official!.trim();
            return hasFieldPath(prompt)
                ? `Could you please clarify ${label} and how an applicant can verify this requirement?`
                : `Regarding ${label}: ${prompt}`;
        }),
        ...missingInfo.filter(field => field.startsWith("opportunity.")).map(field =>
            participationQuestions[field] ?? "Could you please clarify the remaining participation details that are not specified on the official page?",
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
