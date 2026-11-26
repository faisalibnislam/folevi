// Redirects between Folevi's own hosts (src/proxy.ts).

/**
 * The same path and query on another of Folevi's hosts. The path is set on the address, never read as one: as
 * the second argument of `new URL`, a path beginning "//example.com" would name another site.
 */
export function onHost(base: string, pathname: string, search: string): URL {
  const target = new URL(base);
  // (A path can't begin with two slashes once it is set this way: the host stays the one given.)
  target.pathname = `/${pathname.replace(/^[/\\]+/, "")}`;
  target.search = search;
  return target;
}
