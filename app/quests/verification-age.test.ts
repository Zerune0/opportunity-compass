import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verificationAge } from "./verification-age";
import { VerificationAge } from "./verification-age-badge";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("verification age from an injected reference date", () => {
    it.each([
        ["2026-11-19", 0, false, "Verified today"],
        ["2026-11-18", 1, false, "Verified 1 day ago"],
        ["2026-10-20", 30, false, "Verified 30 days ago"],
        ["2026-10-19", 31, true, "Verified 31 days ago"],
    ] as const)("handles %s at the 30-day boundary", (verified, days, stale, label) => {
        expect(verificationAge(verified, "2026-11-19")).toEqual({ days, stale, label });
    });
    it("handles leap years, year boundaries and daylight-saving dates as calendar days", () => {
        expect(verificationAge("2024-02-28", "2024-03-01").days).toBe(2);
        expect(verificationAge("2026-12-31", "2027-01-01").days).toBe(1);
        expect(verificationAge("2026-03-08", "2026-03-09").days).toBe(1);
    });
    it("does not normalize invalid dates into valid verification ages", () => {
        for (const date of ["2026-02-30", "not-a-date", "2026-1-01", ""]) {
            expect(verificationAge(date, "2026-11-19").days).toBeNull();
            expect(verificationAge(date, "2026-11-19").stale).toBe(false);
        }
        expect(verificationAge("2026-11-19", "2026-11-31").days).toBeNull();
    });
    it("does not produce a negative age for a future verification record", () => {
        expect(verificationAge("2026-11-20", "2026-11-19")).toEqual({
            days: null, stale: false, label: "Verification date is in the future. Confirm the record date.",
        });
    });
    it("waits for the reference date instead of reading the system clock", () => {
        expect(verificationAge("2026-11-19", "")).toEqual({ days: null, stale: false, label: null });
    });
});
describe("verification age display", () => {
    const opportunity = { verified_on: "2026-10-19", source_tier: "official" as const, official_url: "https://example.org/sample-official-page" };
    it("links stale information to the recorded official URL", () => {
        const page = renderToStaticMarkup(React.createElement(VerificationAge, { opportunity, today: "2026-11-19" }));
        expect(page).toContain("Verified 31 days ago");
        expect(page).toContain("more than 30 days ago");
        expect(page).toContain('href="https://example.org/sample-official-page"');
        expect(page).toContain("rpg-tag--warning");
        expect(page).toContain("white-space:normal");
    });
    it("shows recent information without an out-of-date warning", () => {
        const page = renderToStaticMarkup(React.createElement(VerificationAge, { opportunity: { ...opportunity, verified_on: "2026-11-18" }, today: "2026-11-19" }));
        expect(page).toContain("Verified 1 day ago");
        expect(page).not.toContain("more than 30 days");
    });
    it("does not label user-posted sample records as officially verified", () => {
        expect(renderToStaticMarkup(React.createElement(VerificationAge, { opportunity: { ...opportunity, source_tier: "user_posted" }, today: "2026-11-19" }))).toBe("");
    });
    it("does not link a stale sample record to an official page", () => {
        const page = renderToStaticMarkup(React.createElement(VerificationAge, { opportunity: { ...opportunity, is_sample: true }, today: "2026-11-19" }));
        expect(page).toContain("more than 30 days ago");
        expect(page).not.toContain("href=");
        expect(page).not.toContain("Confirm current details on the official page");
        expect(page).toContain("This is a sample record with no official page.");
    });
    it("hides while the reference date is loading", () => {
        expect(renderToStaticMarkup(React.createElement(VerificationAge, { opportunity, today: "" }))).toBe("");
    });
});
