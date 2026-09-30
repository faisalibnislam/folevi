import { RELEASES } from "@/components/marketing/content/changelog";
import { JsonLd, articleLd, pageMetadata } from "@/components/marketing/seo";
import { PageFrame } from "@/components/marketing/cards";
import { PageHeader, container, cx } from "@/components/marketing/ui";

export const metadata = pageMetadata({
  title: "Changelog",
  description: "What’s new in Folevi. Version 0.3 brings four plans (Free, Core, Pro and Pro AI) for you or your team, and AI credits with credit packs.",
  path: "/changelog",
});

export default function ChangelogPage() {
  return (
    <PageFrame>
      <JsonLd
        data={RELEASES.map((release) =>
          articleLd({
            type: "Article",
            headline: `Folevi ${release.version}: ${release.name}`,
            description: release.intro,
            path: `/changelog#v${release.version}`,
            published: release.date,
          }),
        )}
      />
      <PageHeader eyebrow="Changelog" title="What’s new in Folevi." lede="A running record of every release, newest first." />
      {RELEASES.map((release) => (
        <article key={release.version} aria-labelledby={`v${release.version}`} className={cx(container, "grid gap-(--mk-stack-gap) lg:grid-cols-[220px_minmax(0,1fr)]")}>
          <div className="mk-box flex flex-wrap items-center gap-3 self-start px-5 py-4 lg:sticky lg:top-8 lg:block lg:p-5">
            <p className="mk-chip">
              Version {release.version}
            </p>
            <p className="text-[14px] text-muted lg:mt-3 lg:pl-1">
              <time dateTime={release.date}>{release.label}</time>
            </p>
          </div>
          <div className="mk-box min-w-0 px-5 py-8 sm:p-10 lg:px-14 [&>*]:max-w-[760px]">
            <h2 id={`v${release.version}`} className="mk-h2 text-[32px] sm:text-[40px]">
              {release.version} · {release.name}
            </h2>
            <p className="mk-lede mt-4">{release.intro}</p>
            <div className="mk-prose mt-8">
              {release.groups.map((group) => (
                <section key={group.title} aria-label={group.title}>
                  <h3>{group.title}</h3>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </article>
      ))}
    </PageFrame>
  );
}
