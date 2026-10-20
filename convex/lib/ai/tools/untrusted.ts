// Text from notes, files and the web is data, never instructions (docs/AI_ASSISTANT.md, "Tools and the
// agent"). The wrapper and the rule are shared with the local backend: packages/ai-prompts untrusted.ts.
export { untrusted, UNTRUSTED_RULE, type UntrustedSource } from "@folevi/ai-prompts/untrusted";
