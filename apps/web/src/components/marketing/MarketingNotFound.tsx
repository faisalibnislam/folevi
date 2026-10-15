import { HeaderCard, PageFrame } from "./cards";
import { NotFoundHead } from "./NotFoundHead";
import { SIGN_IN_URL } from "./site";
import { ButtonLink, Eyebrow } from "./ui";

/** The marketing site's 404: one header card in the site's frame, with the ways back. */
export function MarketingNotFound() {
  return (
    <PageFrame>
      <NotFoundHead site="marketing" />
      <HeaderCard>
        <Eyebrow>Page not found</Eyebrow>
        <h1 className="mk-display mt-5 max-w-[15ch] text-[44px] leading-[0.98] sm:text-[64px] lg:text-[72px]">This page isn’t here</h1>
        <p className="mk-lede mt-6 max-w-[54ch]">The link may be old, or the address has a typo. One of these should get you where you were going.</p>
        <nav aria-label="Ways back" className="mt-8 flex flex-wrap gap-2.5">
          <ButtonLink href="/">Home</ButtonLink>
          <ButtonLink href="/docs" variant="secondary">
            Docs
          </ButtonLink>
          <ButtonLink href={SIGN_IN_URL} variant="secondary">
            Sign in
          </ButtonLink>
        </nav>
      </HeaderCard>
    </PageFrame>
  );
}
