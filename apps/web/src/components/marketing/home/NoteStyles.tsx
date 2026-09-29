import { ArrowRight, Clock } from "lucide-react";
import { COVER_ART } from "@/lib/cover";
import { NoteCard, artById } from "../product/Replica";
import { SectionHeading, container, cx } from "../ui";

const CARDS = [
  { art: "art-03", title: "Seed library", folder: "Projects", lines: ["Swap day is the first Saturday in April.", "Print seed labels by Friday."] },
  { art: "art-30", title: "Trip sketch", folder: "Personal", lines: ["A long weekend on the coast.", "Book the ferry for Friday morning."] },
  { art: "art-01", title: "Reading list", folder: "Reading", lines: ["The Overstory, then Braiding Sweetgrass.", "Return the library copy by the 12th."] },
  { art: "art-39", title: "Studio move", folder: "Studio", lines: ["Boxes for the plan chest and the lamp.", "Keys from Ines on Friday morning."] },
];

const points = [
  { title: "Colours from the image", body: "On Auto, the page and text colours come from the style, and so do highlights, callouts and checkboxes." },
  { title: "Your own image", body: "Upload a picture as a note’s style and Folevi picks its page and text colours from it." },
  { title: "A pair for dark mode", body: "Every style has dark colours too, so a note reads the same way at night." },
];

export function NoteStyles() {
  return (
    <section id="styles" aria-labelledby="styles-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className={container}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <SectionHeading id="styles-title" eyebrow="Note styles" title="The app stays neutral. Your notes bring the colour." />
          <p className="mk-lede max-w-[52ch] lg:pb-1">
            Pick one of {COVER_ART.length} note styles for a page. The style sets the cover, the paper and the text colour, and
            the app around it stays white, or near-black in dark mode.
          </p>
        </div>

        <div className="mk-panel mt-12 p-4 sm:p-8">
          <div aria-hidden="true" className="flex items-center gap-3">
            <span className="mk-tile">
              <Clock size={16} />
            </span>
            <p className="mk-display flex-1 text-[22px] sm:text-[24px]">Recent notes</p>
            <span className="flex items-center gap-1 text-[13px] font-medium text-(--color-heading)">
              See all <ArrowRight size={14} />
            </span>
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Four sample notes, each in a different note style">
            {CARDS.map((card) => {
              const art = artById(card.art);
              return (
                <li key={card.title} aria-label={`${card.title}, in the ${art.name} style`} className="min-h-[216px]">
                  <NoteCard art={art} title={card.title} lines={card.lines} folder={card.folder} />
                </li>
              );
            })}
          </ul>
        </div>

        <ul className={cx("mt-10 grid gap-8 sm:grid-cols-3 sm:gap-10")}>
          {points.map((point) => (
            <li key={point.title}>
              <h3 className="mk-h3 text-[15.5px]">{point.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{point.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
