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
    ],
  },
];

export default eslintConfig;
