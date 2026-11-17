import { Passport } from "./Passport";

export default async function PassportPage({
  searchParams,
}: {
  searchParams: Promise<{ opp?: string | string[] }>;
}) {
  const { opp } = await searchParams;
  return <Passport opportunityId={typeof opp === "string" ? opp : undefined} />;
}
