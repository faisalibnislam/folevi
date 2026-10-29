// Whether the e2e suite's stand-ins (window.__foleviTest…) may answer: in development, and in the production
// build CI's end-to-end job makes with NEXT_PUBLIC_FOLEVI_TEST_HOOKS=1. The builds people get never set it, so
// there the check is false at build time and the stand-ins are never read.
export const TEST_HOOKS = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_FOLEVI_TEST_HOOKS === "1";
