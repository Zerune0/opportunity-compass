import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Opportunity } from "@/lib/types";
import { AdventureMap } from "./AdventureMap";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ opp?: string | string[] }>;
}) {
  const { opp } = await searchParams;
  let opportunities: Opportunity[] = [];
  try {
    const file = await readFile(join(process.cwd(), "data", "opportunities.json"), "utf8");
    opportunities = JSON.parse(file) as Opportunity[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return <AdventureMap opportunity={opportunities.find((item) => item.id === opp)} />;
}
