import { findCatalogOpportunity } from "@/lib/data";
import { AdventureMap } from "./AdventureMap";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ opp?: string | string[] }>;
}) {
  const { opp } = await searchParams;
  return <AdventureMap opportunity={findCatalogOpportunity(typeof opp === "string" ? opp : null) ?? undefined} />;
}
