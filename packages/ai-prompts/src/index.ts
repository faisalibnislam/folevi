// Foli AI's prompts and reply checks, shared by the server (convex/lib) and the local backend: what each
// task asks of the model, how its request is put together, and how the reply is read and checked before
// anyone sees it. Pure: no network, no storage, no clock unless a caller leaves the date out. Depends only
// on @folevi/editor-schema.
//
// Each module keeps its own names (several read a reply's JSON with their own `jsonObject`), so they're
// exported as namespaces here, and one by one at "@folevi/ai-prompts/<module>".
export type { PromptRequest } from "./request";
export { PromptError, type PromptErrorCode } from "./errors";
export * as writing from "./writing";
export * as studyTools from "./studyTools";
export * as actionItems from "./actionItems";
export * as translate from "./translate";
export * as memory from "./memory";
export * as chat from "./chat";
export * as mindmapAi from "./mindmap";
export * as stickiesAi from "./stickies";
export * as tableAi from "./table";
export * as chartAi from "./chart";
export * as wireframeAi from "./wireframe";
export * as flowchartAi from "./flowchart";
export * as untrustedText from "./untrusted";
export * as aiActions from "./actions";
export * as ask from "./ask";
export * as safety from "./safety";
