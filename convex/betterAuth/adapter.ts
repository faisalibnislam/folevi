import { createApi } from "@convex-dev/better-auth";
import schema from "./schema";
import { createAuthOptions } from "../auth";

// The adapter Better Auth uses to read and write the tables in ./schema.ts. Component functions are
// never exposed to the internet, even when "public".
export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } = createApi(schema, createAuthOptions);
