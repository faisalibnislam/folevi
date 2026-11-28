import type { ReactNode } from "react";
import { ComingSoonBadge } from "./Beta";
import { Card, HeaderCard, PageFrame } from "./cards";
import { COMING_SOON_NOTE, SIGN_UP_URL, WEB_APP_URL } from "./site";
import { ButtonLink, Eyebrow } from "./ui";
import { Mark } from "./fun";

/**
 * The page of a paused app (Folevi for Windows and Folevi for Linux, owner 2026-11-28): the route stays, with a
 * "Coming soon" chip, no download and the apps you can use today. The app code and its release scripts stay in
 * apps/desktop for when it comes back.
 */
export function ComingSoonPlatform({ name, device, extra }: { name: string; device: string; extra?: ReactNode }) {
  return (
    <PageFrame>
      <HeaderCard>
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow>Folevi for {name}</Eyebrow>
          <ComingSoonBadge />
        </div>
        <h1 className="mk-display mt-5 max-w-[16ch] text-[44px] leading-[0.98] sm:text-[64px]">
          Folevi for {name} is <Mark>coming soon</Mark>.
        </h1>
        <p className="mk-lede mt-6 max-w-[54ch]">
          There’s no {name} download right now. Until there is, the web app runs in any browser on your {device}, with a
          free Folevi account. The Mac, iPhone and iPad apps are free with every feature and need no account.
        </p>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <ButtonLink href={WEB_APP_URL} size="lg">
            Open the web app
          </ButtonLink>
          <ButtonLink href={SIGN_UP_URL} variant="secondary" size="lg">
            Create a free account
          </ButtonLink>
          <ButtonLink href="/apps" variant="secondary" size="lg">
            All the apps
          </ButtonLink>
        </div>
        <p className="mt-5 text-[13px] text-muted">{COMING_SOON_NOTE}</p>
      </HeaderCard>
      {extra ? <Card as="div">{extra}</Card> : null}
    </PageFrame>
  );
}
