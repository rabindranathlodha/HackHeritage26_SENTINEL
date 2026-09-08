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
    // An operator CLI: its console output IS the interface, not a stray debug
    // line left in a request path.
    files: ["prisma/issue-credentials.ts"],
    rules: { "no-console": "off" },
  },
);
