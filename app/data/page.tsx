import type { Metadata } from "next";
import { YourData } from "./YourData";

export const metadata: Metadata = {
  title: "Your data · Opportunity Compass",
};

export default function DataPage() {
  return <YourData />;
}
