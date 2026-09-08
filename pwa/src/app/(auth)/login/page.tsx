import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  // Already signed in: no reason to show a login form.
  const session = await auth();
  if (session?.user) redirect("/home");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-8 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          Your private wellness companion
        </h1>
        {/* Spec 4.1: no mention of scores, monitoring or reporting. */}
        <p className="text-muted-foreground text-base leading-relaxed">
          This space is yours. What you write here stays on your phone.
        </p>
      </div>
      <LoginForm />
    </main>
  );
}
