import SiteImage from "../../opengraph-image";
import { loadCard, loadCardThemes } from "./card";
import { renderShareCard } from "./cardImage";

/*
 * A shared link's preview in messages and on social sites: the note's own card (cardImage.tsx), only for a link
 * anyone can open as it is (convex/sharing.ts publicLinkCard). Any other link shows the site's own image, so
 * nothing of the note shows before its password.
 */

export const alt = "A note shared from Folevi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await loadCard(token);
  if (!card) return SiteImage();
  await loadCardThemes();
  return renderShareCard(card);
}
