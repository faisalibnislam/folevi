import shared from "./packages/config/eslint.config.js";

export default [
  ...shared,
  { ignores: ["apps/**", "packages/**", "scripts/**", "infra/**"] },
];
