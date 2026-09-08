# SENTINEL — Personnel Companion PWA

The mobile-first, installable app that CAPF personnel use on their own phone.
One role: `PERSONNEL`. This is not the welfare officer dashboard.

Built against `PWA_BUILD_SPEC.md`; consumes the API contracts in
`SENTINEL_BUILD_SPEC.md` §5 via the app tier in `../api`.

## What is built

Step 3.1 of 10: scaffold, service worker, manifest, installable. See
`docs/BUILD_LOG.md` in the repository root for the running record.

## Commands

```bash
npm install
npm run dev              # http://localhost:3000, service worker disabled
npm run build            # compiles src/app/sw.ts into public/sw.js
npx next start -p 3100   # production server, service worker active
npm run verify:pwa       # installability + offline acceptance test
npm run lint
npm run typecheck
npm run icons            # regenerate the icon set from one SVG source
```

The service worker is deliberately disabled in `next dev` — it caches stale
bundles and makes every change look like it did not take. Test it against a
production build.

## Deviations from the spec, and why

- **`@serwist/next` instead of `next-pwa`.** next-pwa's last release was 2022
  with peer `next: >=9`; it does not support the App Router. Serwist is the
  maintained Workbox successor, so the spec's intent — a real Workbox service
  worker with a precached shell — is unchanged.
- **`npm run verify:pwa` instead of a Lighthouse PWA audit.** Lighthouse removed
  the PWA category in v12; v13 with `--only-audits=installable-manifest` returns
  a report containing no audits. The script checks the installability criteria
  directly and then verifies the app renders with the network switched off,
  which is what those criteria are a proxy for.
