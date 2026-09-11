import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { ConsentDialog } from "@/components/privacy/ConsentDialog";

export const Route = createFileRoute("/consent")({
  head: () => ({ meta: [
    { title: "Before you check in — SENTINEL" },
    { name: "description", content: "Understand your choices before starting a voluntary SENTINEL wellbeing check-in." },
    { property: "og:title", content: "Before you check in — SENTINEL" },
    { property: "og:description", content: "Understand your choices before starting a voluntary SENTINEL wellbeing check-in." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: ConsentRoute,
});

function ConsentRoute() {
  return <AppShell><div className="mx-auto max-w-2xl"><ConsentDialog /></div></AppShell>;
}