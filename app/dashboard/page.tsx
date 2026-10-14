import type { Metadata } from "next";
import { HomeDashboard } from "@/components/bmad/home-dashboard";

export const metadata: Metadata = {
  title: "BMAD Studio",
  description:
    "Studio web terpandu untuk membangun software dengan BMAD Method, ditenagai OpenCode lokal.",
};

export default function DashboardPage() {
  return <HomeDashboard />;
}
