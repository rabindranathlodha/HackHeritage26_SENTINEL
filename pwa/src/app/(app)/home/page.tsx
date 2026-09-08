import { auth, signOut } from "@/auth";

export const metadata = { title: "Home" };

// Step 3.1's placeholder, now behind a session. The real home screen is 4.2 and
// every string moves to messages/{en,hi}.json at 3.3.
//
// Spec 4.2: never a score, a band, or a risk number. Supportive status only.
export default async function HomePage() {
  const session = await auth();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-6 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          How are you doing this week?
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Signed in as {session?.user?.id}. Your check-in helps your welfare team
          support you.
        </p>
      </div>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="border-border h-14 w-full rounded-xl border text-base font-medium"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
