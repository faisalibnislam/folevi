import shared from "../../packages/config/eslint.config.js";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import folevi from "./eslint-rules/tooltip.js";

export default [
  ...shared,
  { ignores: [".next/**", ".next-*/**", "next-env.d.ts", "public/sw.js", "playwright-report/**", "test-results/**", "out-shell/**"] },
  {
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin, folevi },
    rules: {
      // Every icon-only control has a tooltip (the owner's rule: Folevi's own, never the browser's).
      // (A warning until the controls it lists today have their tooltips; then an error.)
      "folevi/icon-button-tooltip": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...nextPlugin.configs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // The iPhone app is touched, not pointed at: no hover, so no tooltips.
    files: ["src/components/iphone/**"],
    rules: { "folevi/icon-button-tooltip": "off" },
  },
  {
    // Node scripts; page.evaluate/addInitScript callbacks run in the browser.
    files: ["e2e/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", localStorage: "readonly", fetch: "readonly" } },
  },
];
