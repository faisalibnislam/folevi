import "fake-indexeddb/auto";

// Components read queries through lib/convex/queries.ts, which is built on convex/react's useQueries. Many tests
// mock convex/react with a plain useQuery (and maybe usePaginatedQuery): in those, the app's hooks hand over to
// the mock's, so the tests keep driving what components see. Where convex/react isn't mocked, the real hooks run.
import { vi } from "vitest";
vi.mock("@/lib/convex/queries", async (importActual) => {
  const real = await importActual<typeof import("@/lib/convex/queries")>();
  const convex = (await import("convex/react")) as Record<string, unknown>;
  const has = (name: string) => {
    try {
      return typeof convex[name] === "function";
    } catch {
      return false;
    }
  };
  if (has("useQueries") || !has("useQuery")) return real;
  type AnyHook = (...args: unknown[]) => unknown;
  const useQuery = convex.useQuery as AnyHook;
  const usePaginated: AnyHook = has("usePaginatedQuery") ? (convex.usePaginatedQuery as AnyHook) : () => ({ results: [], status: "LoadingFirstPage", isLoading: true, loadMore: () => undefined });
  const retry = () => undefined;
  return {
    ...real,
    useQuery,
    useQueryState: (...args: unknown[]) => ({ data: useQuery(...args), failed: false, error: undefined, retry }),
    usePaginatedQuery: (...args: unknown[]) => ({ ...(usePaginated(...args) as object), failed: false, retry }),
  };
});
