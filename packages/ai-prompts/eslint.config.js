// ESLint 10 resolves config from the linted file's directory; re-export the shared config
// (the root eslint.config.js ignores packages/**).
export { default } from "../config/eslint.config.js";
