import { useId } from "react";
import { useIphoneLook } from "@/lib/iphone";
import { GROUP_FOOTER, GROUP_HEADER } from "@/components/iphone/SettingsKit";

export function Card({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  // A generated id: titles have spaces, and aria-labelledby reads a space-separated list of ids.
  const id = useId();
  // The iPhone app: an inset grouped section (its name above it, the content on a rounded card).
  const iphone = useIphoneLook();
  // The explanation goes under the group as its footer, as iOS Settings has it, not inside the card.
  if (iphone)
    return (
      <section className="px-4" aria-labelledby={id}>
        <h3 id={id} className={GROUP_HEADER}>
          {title}
        </h3>
        <div className="ui-grouped px-4 py-3.5 text-subheadline">{children}</div>
        {description ? <p className={GROUP_FOOTER}>{description}</p> : null}
      </section>
    );
  return (
    <section className="ui-card rounded-control p-5" aria-labelledby={id}>
      <h3 id={id} className="ui-display text-title-3">
        {title}
      </h3>
      {description ? <p className="mt-1 text-subheadline text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
