"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Copy here is placeholder and moves to messages/{en,hi}.json at step 3.3.
export function LoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);

    const result = await signIn("credentials", {
      loginId,
      password,
      redirect: false,
    });

    setPending(false);
    if (result?.error) {
      setFailed(true);
      return;
    }
    router.replace("/home");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="loginId" className="text-sm font-medium">
          Your ID
        </label>
        <input
          id="loginId"
          name="loginId"
          autoComplete="username"
          required
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          className="border-border bg-card h-14 rounded-xl border px-4 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border-border bg-card h-14 rounded-xl border px-4 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {/* One message for every failure. The server does not distinguish an
          unknown id from a wrong password, and neither does this. */}
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          That ID and password did not match. Please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground mt-2 h-14 rounded-xl text-base font-medium disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
