import { LinkCard } from "../parts";
import { SectionHeading, box, container, cx } from "../ui";
import { Mark } from "../fun";

/*
 * Coming from another notes app: one card per app people most often leave for Folevi, each linking to its
 * compare page, where every fact about the other app is sourced. The cards make no claims about the other apps.
 */

const FROM: Array<{ slug: string; name: string; body: string }> = [
  { slug: "evernote", name: "Coming from Evernote?", body: "No note limit and no one-device rule. Bring your notebooks over and keep them free." },
  { slug: "notion", name: "Coming from Notion?", body: "A calm notes app for one person, native on your Apple devices, that works fully offline." },
  { slug: "craft", name: "Coming from Craft?", body: "The same care for how notes look, with no block limit, and your notes stay your files." },
  { slug: "obsidian", name: "Coming from Obsidian?", body: "Linked notes kept as files you own, in a native app that is ready the moment you open it." },
];

export function Switch() {
  return (
    <section id="switch" aria-labelledby="switch-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <SectionHeading
          id="switch-title"
          eyebrow="Switching"
          title={
            <>
              Bring your notes. <Mark kind="squiggle">Keep</Mark> them free.
            </>
          }
          lede="Folevi imports from Notion, Evernote, Word, HTML, CSV, Markdown and text. Here is how it compares, with every fact sourced."
        />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {FROM.map((f) => (
            <li key={f.slug}>
              <LinkCard href={`/compare/${f.slug}`} title={f.name} body={f.body} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
