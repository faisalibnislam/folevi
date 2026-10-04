import shared from "../../packages/config/eslint.config.js";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  ...shared,
  { ignores: [".next/**", ".next-*/**", "next-env.d.ts", "public/sw.js", "playwright-report/**", "test-results/**"] },
  {
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...nextPlugin.configs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // Node scripts; page.evaluate/addInitScript callbacks run in the browser.
    files: ["e2e/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", localStorage: "readonly" } },
  },
];
