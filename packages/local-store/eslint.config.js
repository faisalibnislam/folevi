// ESLint 10 resolves config from the linted file's directory; re-export the shared config
// (the root eslint.config.js ignores packages/**), plus a guard that src stays free of Node-only APIs
// so the package runs in the app's web view.
import shared from "../config/eslint.config.js";

export default [
  ...shared,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["fs", "path", "crypto", "zlib", "os", "buffer", "stream", "util"].map((name) => ({
            name,
            message: "src must run in browsers: no Node-only modules.",
          })),
          patterns: [
            { group: ["node:*"], message: "src must run in browsers: no Node-only modules." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Buffer", message: "Use Uint8Array." },
        { name: "process", message: "src must run in browsers." },
        { name: "require", message: "ES modules only." },
      ],
    },
  },
];
