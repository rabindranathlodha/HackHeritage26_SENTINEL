"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Labels = {
  id: string;
  password: string;
  submit: string;
  submitting: string;
  failed: string;
};

// Copy arrives as props from the server component rather than being looked up
// here, so this file holds no user-facing string at all (spec 8).
export function LoginForm({ labels }: { labels: Labels }) {
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
          {labels.id}
        </label>
        <input
          id="loginId"
          name="loginId"
          autoComplete="username"
          required
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          className="border-border bg-card focus-visible:ring-ring/50 h-14 rounded-xl border px-4 text-base outline-none focus-visible:ring-3"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-medium">
          {labels.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border-border bg-card focus-visible:ring-ring/50 h-14 rounded-xl border px-4 text-base outline-none focus-visible:ring-3"
        />
      </div>

      {/* One message for every failure. The server does not distinguish an
          unknown id from a wrong password, and neither does this. */}
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          {labels.failed}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground mt-2 h-14 rounded-xl text-base font-medium disabled:opacity-60"
      >
        {pending ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
