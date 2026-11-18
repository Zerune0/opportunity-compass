import { Journal } from "./Journal";

export default async function JournalPage({ searchParams }: {
  searchParams: Promise<{ opp?: string | string[] }>;
}) {
  const { opp } = await searchParams;
  return <Journal opportunityId={typeof opp === "string" ? opp : undefined} />;
}
