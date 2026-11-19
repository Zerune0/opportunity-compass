export function verificationAge(verifiedOn: string, today: string) {
    const unknown = { days: null, stale: false, label: null } as { days: number | null; stale: boolean; label: string | null };
    if (!today) return unknown;
    function dateValue(value: string) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
        const time = Date.parse(value + "T00:00:00Z");
        return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
    }
    const verified = dateValue(verifiedOn);
    const reference = dateValue(today);
    if (!Number.isFinite(verified) || !Number.isFinite(reference)) return { ...unknown, label: "Verification age unknown. Confirm the record date." };
    const days = (reference - verified) / 86400000;
    if (days < 0) return { ...unknown, label: "Verification date is in the future. Confirm the record date." };
    return { days, stale: days > 30, label: days === 0 ? "Verified today" : `Verified ${days} ${days === 1 ? "day" : "days"} ago` };
}
