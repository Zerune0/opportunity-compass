import opportunities from "@/data/opportunities.json";
import type { Opportunity } from "@/lib/types";
import { AdventureMap } from "./AdventureMap";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ opp?: string | string[] }>;
}) {
  const { opp } = await searchParams;
  const catalog = opportunities as Opportunity[];
  return <AdventureMap opportunity={catalog.find((item) => item.id === opp)} />;
}
