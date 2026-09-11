import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { Onboarding } from "@/components/Onboarding";

export async function generateMetadata() {
  const t = await getTranslations("onboarding");
  return { title: t("step1Title") };
}

// The four promises, before sign-in.
//
// Public by design: a person deciding whether to trust this at all should be
// able to read what it does without first handing over credentials to it.
export default async function WelcomePage() {
  // Already signed in: these are promises about a decision they have made.
  const session = await auth();
  if (session?.user) redirect("/home");

  return <Onboarding />;
}
