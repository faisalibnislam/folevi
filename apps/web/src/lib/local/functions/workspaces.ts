// workspaces.mine in local mode: a library is Personal only, so there are no team workspaces. The rest of
// workspaces.* is hidden (registry.ts LOCAL_HIDDEN, capability "workspaces").
import { api } from "@/lib/convex/api";
import { defineLocal } from "../registry";

defineLocal(api.workspaces.mine, "query", async () => []);
