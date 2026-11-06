import type { Metadata } from "next";
import { ShowcaseAppLoader } from "@/components/marketing/showcase/ShowcaseAppLoader";

// The real Folevi app on a demo library kept in memory, framed by the home page's showcase
// (components/marketing/home/DeviceShowcase.tsx). Nothing here reaches an account or this browser's notes.
export const metadata: Metadata = { title: { absolute: "Folevi" }, robots: { index: false, follow: false } };

export default function ShowcaseAppPage() {
  return <ShowcaseAppLoader />;
}
