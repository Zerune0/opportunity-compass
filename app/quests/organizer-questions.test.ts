import { describe, expect, it } from "vitest";
import type { EligibilityItem } from "../../lib/types";
import { buildOrganizerQuestions } from "./organizer-questions";

const opportunity = { title: "Test research program" };
const item: EligibilityItem = {
    requirement_id: "email", requirement_type: "manual", label: "Academic email",
    hard: true, status: "unknown", source_text: "Use an academic email.",
    explanation: "Needs confirmation.", used_profile_fields: [],
    confirm_with_official: "Could you confirm which academic email addresses are accepted?",
};

describe("organizer question drafts", () => {
    it("keeps unknown official questions and deduplicates repeated engine outputs", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [item, item] }, [
            "opportunity.cost.fee_usd", "opportunity.cost.fee_usd",
        ]);
        expect(draft.questions).toHaveLength(2);
        expect(draft.message).toContain("Subject: Questions about Test research program");
        expect(draft.message).toContain(item.confirm_with_official);
        expect(draft.message).toContain("1. Regarding Academic email:");
        expect(draft.message).toContain("2. Could you please confirm the participation or application fee");
    });
    it("does not ask about satisfied or rejected requirements", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [
            { ...item, status: "satisfied" }, { ...item, status: "not_satisfied" },
            { ...item, confirm_with_official: null }, { ...item, confirm_with_official: "  " },
        ] }, []);
        expect(draft.questions).toEqual([]);
        expect(draft.message).toBe("");
    });
    it("routes missing profile details to Passport rather than the organizer", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [
            { ...item, used_profile_fields: ["devices"] },
            { ...item, used_profile_fields: ["profile.age"] },
        ] }, ["profile.devices", "profile.age", "profile.devices"]);
        expect(draft.profileUpdates).toEqual(["Available equipment", "Age"]);
        expect(draft.questions).toEqual([]);
        expect(draft.message).toBe("");
    });
    it("keeps official unknowns separate from profile updates", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [item] }, [
            "profile.budget_usd", "opportunity.time_commitment.hours_per_week",
            "opportunity.location.format", "opportunity.team_requirement.required",
        ]);
        expect(draft.profileUpdates).toEqual(["Available budget"]);
        expect(draft.questions).toHaveLength(4);
        expect(draft.message).toContain("hours per week");
        expect(draft.message).toContain("online, in person, or hybrid");
        expect(draft.message).not.toMatch(/profile\.|opportunity\./);
        expect(draft.message).not.toContain("Available budget");
    });
    it("uses readable fallback text for new fields and internal paths in prompts", () => {
        const draft = buildOrganizerQuestions(opportunity, { items: [{
            ...item, label: "opportunity.new_requirement",
            confirm_with_official: "Confirm opportunity.new_requirement",
        }] }, ["opportunity.new_field", "profile.new_field"]);
        expect(draft.profileUpdates).toEqual(["Other missing profile information"]);
        expect(draft.questions).toHaveLength(2);
        expect(draft.message).not.toMatch(/profile\.|opportunity\./);
    });
    it("returns an empty draft when no information is missing", () => {
        expect(buildOrganizerQuestions(opportunity, null, [])).toEqual({
            questions: [], profileUpdates: [], message: "",
        });
    });
    it("does not mutate engine results or invent an organizer email", () => {
        const missing = Object.freeze(["opportunity.cost.fee_usd"]);
        const eligibility = { items: [Object.freeze({ ...item })] };
        const before = JSON.stringify(eligibility);
        const draft = buildOrganizerQuestions(opportunity, eligibility, missing);
        expect(JSON.stringify(eligibility)).toBe(before);
        expect(draft.message).not.toContain("mailto:");
        expect(draft.message).not.toContain("@");
    });
});
