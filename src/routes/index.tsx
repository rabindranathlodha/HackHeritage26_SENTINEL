import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navigation/Navbar";
import { Footer } from "@/components/layout/Footer";
import { HeroSection, FeatureBento, HowItWorks, PrivacySection, DashboardPreview, FinalCta } from "@/components/wellness/WellnessSections";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "SENTINEL — A clearer picture of how you’re doing" },
    { name: "description", content: "A private wellbeing companion for checking in, noticing patterns, and choosing support." },
    { property: "og:title", content: "SENTINEL — A clearer picture of how you’re doing" },
    { property: "og:description", content: "A private wellbeing companion for checking in, noticing patterns, and choosing support." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-dvh bg-background">
      <Navbar variant="marketing" />
      <main><HeroSection /><FeatureBento /><HowItWorks /><PrivacySection /><DashboardPreview /><FinalCta /></main>
      <Footer />
    </div>
  );
}
