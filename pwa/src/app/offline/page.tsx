// Served by the service worker when a page is requested with no connection.
// Principle 3: no dead ends. This is reassurance, not an error — nothing the
// person has done is lost, and everything queues.

export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-6 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-2xl font-medium tracking-tight text-balance">
          You are offline
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          You can keep using the app. Anything you save will be sent when you
          are back on a network.
        </p>
      </div>
    </main>
  );
}
