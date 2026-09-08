import en from "../../../messages/en.json";
import hi from "../../../messages/hi.json";

import { OfflineNotice } from "@/components/OfflineNotice";

// Served by the service worker when a document request cannot be fulfilled.
// Principle 3: no dead ends. This is reassurance, not an error.
//
// force-static is load-bearing, not a hint. A dynamic route is absent from the
// precache manifest, and an offline fallback that has to be fetched is not a
// fallback. Keep this page free of cookies(), headers() and auth().
export const dynamic = "force-static";

export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-6 px-6 pb-16 pt-24">
      <OfflineNotice
        copy={{
          en: { title: en.offline.title, body: en.offline.body },
          hi: { title: hi.offline.title, body: hi.offline.body },
        }}
      />
    </main>
  );
}
