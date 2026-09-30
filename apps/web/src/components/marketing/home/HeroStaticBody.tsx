import type { ReactNode } from "react";
import { HERO_SEED, seedDueLabel, type SeedInline } from "./heroNoteSeed";

/*
 * The home page note's body before the editor loads (and without JavaScript): the seed blocks drawn with the
 * editor's own classes and structure (editor.css), so swapping in the live editor changes nothing on screen.
 */

function Inline({ parts }: { parts: SeedInline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.code ? (
          <code key={i} className="fb-inline-code">
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function HeroStaticBody() {
  const blocks: ReactNode[] = HERO_SEED.map((b) => {
    const common = { "data-block-id": b.id, "data-depth": 0, style: { "--depth": 0 } as React.CSSProperties };
    switch (b.type) {
      case "paragraph":
        return (
          <p key={b.id} {...common} data-block="paragraph" className="fb fb-paragraph">
            <Inline parts={b.text} />
          </p>
        );
      case "heading": {
        const Tag = (["h2", "h3", "h4"] as const)[b.level - 1]!;
        return (
          <Tag key={b.id} {...common} data-block="heading" className={`fb fb-heading fb-h${b.level}`}>
            <Inline parts={b.text} />
          </Tag>
        );
      }
      case "todo":
        return (
          <div key={b.id} {...common} data-block="todo" data-checked={b.checked ? "true" : "false"} className="fb fb-todo">
            <span className="fb-check" role="img" aria-label={b.checked ? "Done" : "Not done"} />
            <div className="fb-content">
              <Inline parts={b.text} />
            </div>
            <span className="fb-task-meta" data-has-due={b.dueDate ? "true" : "false"}>
              {b.dueDate ? (
                <span className="fb-due-chip inline-block">
                  <span className="sr-only">Due </span>
                  {seedDueLabel(b.dueDate)}
                </span>
              ) : null}
            </span>
          </div>
        );
      case "callout":
        return (
          <div key={b.id} {...common} data-block="callout" role="note" className="fb fb-callout fb-tone-note">
            <span className="fb-callout-icon" aria-hidden="true">
              ✳︎
            </span>
            <div className="fb-content">
              <Inline parts={b.text} />
            </div>
          </div>
        );
    }
  });
  return <div className="fb-editor mk-hero-editor">{blocks}</div>;
}
