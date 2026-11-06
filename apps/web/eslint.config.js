import shared from "../../packages/config/eslint.config.js";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import tooltip from "./eslint-rules/tooltip.js";
import hover from "./eslint-rules/hover.js";

const folevi = { rules: { ...tooltip.rules, ...hover.rules } };

export default [
  ...shared,
  { ignores: [".next/**", ".next-*/**", "next-env.d.ts", "public/sw.js", "playwright-report/**", "test-results/**", "out-shell/**"] },
  {
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin, folevi },
    rules: {
      // Every icon-only control has a tooltip (the owner's rule: Folevi's own, never the browser's).
      // (A warning until the controls it lists today have their tooltips; then an error.)
      "folevi/icon-button-tooltip": "warn",
      // Every button shows a visible hover (the owner's rule, 6 November 2026; eslint-rules/hover.js).
      "folevi/button-hover": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...nextPlugin.configs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // The iPhone app is touched, not pointed at: no hover, so no tooltips and no hover effects.
    files: ["src/components/iphone/**"],
    rules: { "folevi/icon-button-tooltip": "off", "folevi/button-hover": "off" },
  },
  {
    // The iPhone screens' pixel-match samples: a dev page of the phone's own (touched) controls.
    files: ["src/app/dev/match/**"],
    rules: { "folevi/button-hover": "off" },
  },
  {
    // Node scripts; page.evaluate/addInitScript callbacks run in the browser.
    files: ["e2e/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", localStorage: "readonly", fetch: "readonly" } },
  },
];
