import type { Opportunity } from "../../lib/types";
import { verificationAge } from "./verification-age";

export function VerificationAge({ opportunity, today }: {
    opportunity: Pick<Opportunity, "verified_on" | "source_tier" | "official_url" | "is_sample">;
    today: string;
}) {
    if (opportunity.source_tier === "user_posted") return null;
    const age = verificationAge(opportunity.verified_on, today);
    if (!age.label) return null;
    return <span className={age.stale ? "rpg-tag rpg-tag--warning" : "rpg-muted"} style={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>
        {age.label}
        {age.stale && <>. Information was verified more than 30 days ago. {opportunity.is_sample ? "This is a sample record with no official page." : <a href={opportunity.official_url}>Confirm current details on the official page.</a>}</>}
    </span>;
}
