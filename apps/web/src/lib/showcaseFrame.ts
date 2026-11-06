// Whether this page is one of the home page's showcase frames (components/marketing/showcase): the app on a demo
// library inside folevi.com's own page. Such a page leaves the site alone: no service worker, nothing kept.
let showcase = false;

export function markShowcaseFrame(): void {
  showcase = true;
}

export function inShowcaseFrame(): boolean {
  return showcase;
}
