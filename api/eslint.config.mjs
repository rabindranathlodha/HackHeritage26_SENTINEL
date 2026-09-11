import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Narrow on purpose: this tier is route handlers and database helpers, not a
// component tree.
export default tseslint.config(
  { ignores: ["node_modules/**", ".next/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly", fetch: "readonly",
                 crypto: "readonly", Request: "readonly", Response: "readonly",
                 Buffer: "readonly", AbortSignal: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    // Operator CLIs: their console output IS the interface, not a stray debug
    // line left in a request path.
    files: ["prisma/issue-credentials.ts", "prisma/seed-console.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Acceptance scripts. They run under plain Node rather than Next's runtime,
    // so they get the timer and URL globals the request path has no business
    // using, and they report their results by printing them.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },
);
