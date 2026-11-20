import { describe, expect, it } from "vitest";
import { checkEligibility } from "../../lib/eligibility";
import { analyzeReachability } from "../../lib/reachability";
import type { EligibilityItem, Opportunity, StudentProfile } from "../../lib/types";
import { buildOrganizerQuestions } from "./organizer-questions";

const opportunity = { title: "Test research program" };
const item: EligibilityItem = {
    requirement_id: "email", requirement_type: "manual", label: "Academic email",
    hard: true, status: "unknown", source_text: "Use an academic email.",
    explanation: "Needs confirmation.", used_profile_fields: [],
    confirm_with_official: "Could you confirm which academic email addresses are accepted?",
};
/** Fictional student with every field the engines read filled in. */
const fullProfile: StudentProfile = {
    id: "fixture-student", is_sample: true, display_name: "Fixture student",
    grade: 11, age: 16, region: { country: "US", state: "NJ", city: "Fixture City" },
    citizenships: ["US"], statuses: ["high_school_student"], school_name: "Fixture School",
    hours_per_week_available: 9, budget_usd: 40, transport: { level: "reliable" },
    devices: ["laptop"], skills: [{ name: "python", level: "beginner" }], evidence: [],
};

describe("organizer question drafts", () => {
    it("keeps unknown official questions and deduplicates repeated engine outputs", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [item, item] }, [
            "opportunity.cost.fee_usd", "opportunity.cost.fee_usd",
        ], fullProfile);
        expect(draft.questions).toHaveLength(2);
        expect(draft.message).toContain("Subject: Questions about Test research program");
        expect(draft.message).toContain(item.source_text);
        expect(draft.message).not.toContain(item.confirm_with_official);
        expect(draft.message).toContain("1. Regarding Academic email:");
        expect(draft.message).toContain("2. Could you please confirm the participation or application fee");
    });
    it("does not ask about satisfied or rejected requirements", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [
            { ...item, status: "satisfied" }, { ...item, status: "not_satisfied" },
            { ...item, confirm_with_official: null }, { ...item, confirm_with_official: "  " },
        ] }, [], fullProfile);
        expect(draft.questions).toEqual([]);
        expect(draft.message).toBe("");
    });
    // Replaces the earlier case that paired used_profile_fields ["devices"] with missing_info ["profile.age"]:
    // the eligibility engine never uses "devices" and reachability never reports "profile.age".
    it("routes unknowns caused by empty profile fields to Passport rather than the organizer", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [
            { ...item, requirement_type: "citizenship", label: "Citizenship", used_profile_fields: ["citizenships"] },
            { ...item, requirement_type: "region", label: "State", used_profile_fields: ["region", "region.state"] },
        ] }, ["profile.devices", "profile.devices"], {
            ...fullProfile, citizenships: null, region: { country: "US", state: " " }, devices: null,
        });
        expect(draft.profileUpdates).toEqual(["Citizenship or legal residency", "State or province", "Devices"]);
        expect(draft.questions).toEqual([]);
        expect(draft.message).toBe("");
    });
    it("asks the organizer when every profile field the requirement uses is filled in", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [
            { ...item, label: "Citizenship", used_profile_fields: ["citizenships"] },
        ] }, [], fullProfile);
        expect(draft.profileUpdates).toEqual([]);
        expect(draft.questions).toHaveLength(1);
    });
    it("treats requirements that use profile fields as profile gaps when no profile is given", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [
            { ...item, label: "Grade", used_profile_fields: ["grade"] }, item,
        ] }, [], null);
        expect(draft.profileUpdates).toEqual(["Grade"]);
        expect(draft.questions).toEqual([expect.stringContaining("Academic email")]);
    });
    it("keeps official unknowns separate from profile updates", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [item] }, [
            "profile.budget_usd", "opportunity.time_commitment.hours_per_week",
            "opportunity.location.format", "opportunity.team_requirement.required",
        ], fullProfile);
        expect(draft.profileUpdates).toEqual(["Budget"]);
        expect(draft.questions).toHaveLength(4);
        expect(draft.message).toContain("hours per week");
        expect(draft.message).toContain("online, in person, or hybrid");
        expect(draft.message).not.toMatch(/profile\.|opportunity\./);
        expect(draft.message).not.toContain("Budget");
    });
    it("uses readable fallback text for new fields and internal paths in prompts", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [{
            ...item, label: "opportunity.new_requirement",
            confirm_with_official: "Confirm opportunity.new_requirement",
        }] }, ["opportunity.new_field", "profile.new_field", "opportunity.toString", "profile.toString"], fullProfile);
        expect(draft.profileUpdates).toEqual(["Other missing profile information"]);
        expect(draft.questions).toHaveLength(2);
        expect(draft.message).not.toMatch(/profile\.|opportunity\.|native code/);
    });
    it("returns an empty draft when no information is missing", () => {
        expect(buildOrganizerQuestions(opportunity, null, [], null)).toEqual({
            questions: [], profileUpdates: [], message: "",
        });
    });
    it("does not mutate engine results or invent an organizer email", () => {
        const missing = Object.freeze(["opportunity.cost.fee_usd"]);
        const eligibility = { items: [Object.freeze({ ...item })] };
        const before = JSON.stringify(eligibility);
        const draft = buildOrganizerQuestions(opportunity, eligibility, missing, fullProfile);
        expect(JSON.stringify(eligibility)).toBe(before);
        expect(draft.message).not.toContain("mailto:");
        expect(draft.message).not.toContain("@");
    });
});

/** Fictional fixtures only; real catalog records are deliberately not used here. */
const baseOpportunity: Opportunity = {
    id: "fixture-research", title: "Fixture research program", organizer: "Fixture organizer",
    category: "research", fields: ["biology"], summary: "Fictional fixture.",
    official_url: "https://example.org/fixture", verified_on: "2026-11-01", verified_by: "Fixture verifier",
    deadline: null, location: { format: "online", country: null, state: null, city: null },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 5, total_weeks: 8 }, required_devices: [],
    requirements: [], preparation: [],
};
const citizenshipRule = {
    id: "req-citizen", type: "citizenship" as const, countries: ["US"], hard: true,
    label: "U.S. citizen or permanent resident", source_text: "Applicants must be U.S. citizens or permanent residents.",
};
const manualRule = {
    id: "req-manual", type: "manual" as const, hard: true,
    label: "Faculty nomination", source_text: "Applicants must be nominated by a faculty member.",
};
const today = "2026-11-19";
function draftFor(profile: StudentProfile, opp: Opportunity) {
    const eligibility = checkEligibility(profile, opp, { today });
    const reach = analyzeReachability(profile, opp, [], { today });
    return buildOrganizerQuestions(opp, eligibility, reach.missing_info, profile);
}
const studentWording = ["to your profile", "Skill Passport", "profile first", "Passport"];
function expectNoStudentText(message: string, profile: StudentProfile) {
    for (const phrase of studentWording) expect(message).not.toContain(phrase);
    const values = [profile.display_name, profile.school_name, profile.region?.city, profile.region?.state,
        ...(profile.citizenships ?? []), ...(profile.skills ?? []).map(skill => skill.name)];
    for (const value of values) if (value) expect(message).not.toContain(value);
    expect(message).not.toMatch(/profile\.|opportunity\./);
}

describe("organizer question drafts from real engine output", () => {
    it("keeps a missing citizenship out of the organizer message and lists it for Passport", () => {
        const profile = { ...fullProfile, citizenships: null };
        const opp = { ...baseOpportunity, requirements: [citizenshipRule] };
        const draft = draftFor(profile, opp);
        expect(checkEligibility(profile, opp, { today }).items[0].status).toBe("unknown");
        expect(draft.profileUpdates).toEqual(["Citizenship or legal residency"]);
        expect(draft.questions).toEqual([]);
        expect(draft.message).toBe("");
    });
    it("asks the organizer about a manual requirement when citizenship is filled in", () => {
        const opp = { ...baseOpportunity, requirements: [citizenshipRule, manualRule] };
        const draft = draftFor(fullProfile, opp);
        expect(draft.profileUpdates).toEqual([]);
        expect(draft.questions).toEqual([expect.stringContaining("Regarding Faculty nomination:")]);
        expect(draft.message).not.toContain("U.S. citizen");
        expectNoStudentText(draft.message, fullProfile);
    });
    it("splits a mixed result: citizenship to Passport, manual rule to the organizer", () => {
        const profile = { ...fullProfile, citizenships: null };
        const draft = draftFor(profile, { ...baseOpportunity, requirements: [citizenshipRule, manualRule] });
        expect(draft.profileUpdates).toEqual(["Citizenship or legal residency"]);
        expect(draft.questions).toHaveLength(1);
        expect(draft.message).toContain("Faculty nomination");
        expectNoStudentText(draft.message, profile);
    });
    it("shows missing weekly hours as a readable Passport label", () => {
        const profile = { ...fullProfile, hours_per_week_available: null };
        const draft = draftFor(profile, baseOpportunity);
        expect(draft.profileUpdates).toEqual(["Available hours per week"]);
        expect(draft.message).toBe("");
    });
    it("asks where an in-person program takes place when no state or city is recorded", () => {
        const opp: Opportunity = { ...baseOpportunity, location: { format: "in_person", country: "US", state: null, city: null } };
        const draft = draftFor(fullProfile, opp);
        expect(analyzeReachability(fullProfile, opp, [], { today }).missing_info).toContain("opportunity.location");
        expect(draft.questions).toContain("In which city and state does the in-person part take place?");
        expectNoStudentText(draft.message, fullProfile);
    });
    it("lists each empty profile field once, in a stable order, across eligibility and reachability", () => {
        const profile: StudentProfile = { ...fullProfile, grade: null, citizenships: null, statuses: null, region: { country: "US", state: null },
            skills: null, devices: null, budget_usd: null, transport: null, hours_per_week_available: null };
        const opp: Opportunity = {
            ...baseOpportunity, required_devices: ["laptop"], cost: { fee_usd: 0, requires_travel_expense: false },
            location: { format: "in_person", country: "US", state: "NJ", city: "Fixture City" },
            requirements: [
                { id: "g", type: "grade", min: 9, max: 12, hard: true, label: "Grades 9-12", source_text: "Grades 9-12." },
                citizenshipRule,
                { id: "s", type: "status", any_of: ["high_school_student"], hard: true, label: "High school", source_text: "High school students." },
                { id: "r", type: "region", countries: ["US"], states: ["NJ"], hard: true, label: "New Jersey", source_text: "NJ residents." },
                { id: "k", type: "prerequisite_skill", skill: "python", hard: false, label: "Python", source_text: "Python helps." },
                manualRule,
            ],
            preparation: [{ id: "p", title: "Prep", estimated_hours: 2, estimated_cost_usd: 5, depends_on: [], required_for_application: true }],
        };
        const first = draftFor(profile, opp);
        expect(first.profileUpdates).toEqual([
            "Grade", "Citizenship or legal residency", "Student status", "State or province", "Skills", "Evidence",
            "Devices", "Budget", "Transportation", "Available hours per week",
        ]);
        expect(first.profileUpdates).not.toContain("Other missing profile information");
        expect(draftFor(profile, opp)).toEqual(first);
        expect(first.questions).toEqual([expect.stringContaining("Faculty nomination")]);
        expectNoStudentText(first.message, profile);
    });
});

describe("organizer-facing wording after review", () => {
    it("uses the official manual rule instead of copying instructions addressed to the student", () => {
        const opp = { ...baseOpportunity, requirements: [manualRule] };
        const eligibility = checkEligibility(fullProfile, opp, { today });
        const hint = eligibility.items[0].confirm_with_official;
        const draft = draftFor(fullProfile, opp);
        expect(draft.message).toContain(manualRule.source_text);
        expect(draft.message).toContain("Required eligibility");
        expect(draft.message).toContain("Could you please clarify this requirement");
        if (hint) expect(draft.message).not.toContain(hint);
        expect(draft.message).not.toContain("check it yourself");
        expectNoStudentText(draft.message, fullProfile);
    });
    it("distinguishes an optional official preference from a hard requirement", () => {
        const preference = { ...manualRule, id: "preference", hard: false, label: "Research experience", source_text: "Prior research experience is preferred." };
        const draft = draftFor(fullProfile, { ...baseOpportunity, requirements: [manualRule, preference] });
        expect(draft.questions).toHaveLength(2);
        expect(draft.questions[0]).toContain("Required eligibility");
        expect(draft.questions[1]).toContain("Official preference — not a hard eligibility requirement");
        expect(draft.questions[1]).toContain("how this preference is considered in selection");
        expect(draft.questions[1]).toContain(preference.source_text);
        expect(draft.questions[1]).not.toContain("what evidence applicants should provide");
    });
});

describe("organizer question wording for listings without an official page", () => {
    const verified: Opportunity = { ...baseOpportunity, official_url: "https://research.fixture-university.edu/program" };
    it("a verified opportunity with a real link quotes 'Your official page states'", () => {
        const draft = buildOrganizerQuestions(verified, { items: [item] }, [], fullProfile);
        expect(draft.message).toContain(`Your official page states: “${item.source_text}”`);
    });
    it("a user-posted opportunity never says 'official page' and quotes 'The listing states'", () => {
        const posted: Opportunity = { ...verified, source_tier: "user_posted" };
        const draft = buildOrganizerQuestions(posted, { items: [item] }, ["opportunity.unlisted_field"], fullProfile);
        expect(draft.message).toContain(`The listing states: “${item.source_text}”`);
        expect(draft.message).toContain("not specified on the listing?");
        expect(draft.message.toLowerCase()).not.toContain("official page");
    });
    it("a sample opportunity also quotes 'The listing states'", () => {
        const draft = buildOrganizerQuestions({ ...verified, is_sample: true }, { items: [item] }, [], fullProfile);
        expect(draft.message).toContain("The listing states:");
        expect(draft.message).not.toContain("Your official page states");
    });
    it("a damaged item without source_text does not throw and adds no quote", () => {
        const damaged = { ...item, source_text: undefined } as unknown as EligibilityItem;
        const numeric = { ...item, requirement_id: "n", label: "Other rule", source_text: 42 } as unknown as EligibilityItem;
        const draft = buildOrganizerQuestions(verified, { items: [damaged, numeric] }, [], fullProfile);
        expect(draft.questions).toHaveLength(2);
        expect(draft.message).not.toContain("states:");
    });
});
