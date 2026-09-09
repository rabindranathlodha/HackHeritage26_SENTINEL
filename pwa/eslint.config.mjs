import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Build output, not source: Serwist compiles src/app/sw.ts into this
      // minified bundle at build time. Linting it reports on Workbox's code.
      "public/sw.js",
      "public/sw*.js",
      "public/swe-worker*.js",
      // onnxruntime-web's own distribution, copied in by `npm run ort:assets`.
      // Not source: linting it reports on Microsoft's minified bundles.
      "public/ort/**",
      // The design document this UI was built from, plus the Claude Design
      // canvas runtime it needs to render. Kept in the repo as the reference
      // the screens are checked against, the way a spec is — but it is a
      // generated artefact, not source, and linting it reports on someone
      // else's bundler output.
      "design-import/**",
    ],
  },
];

export default eslintConfig;
