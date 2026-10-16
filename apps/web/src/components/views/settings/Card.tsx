import { useId } from "react";
import { useIphoneApp } from "@/lib/iphone";

export function Card({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  // A generated id: titles have spaces, and aria-labelledby reads a space-separated list of ids.
  const id = useId();
  // The iPhone app: an inset grouped section (its name above it, the content on a rounded card).
  const iphone = useIphoneApp();
  if (iphone)
    return (
      <section className="px-4" aria-labelledby={id}>
        <h3 id={id} className="px-4 pb-1.5 text-[13px] font-medium uppercase tracking-[0.02em] text-muted">
          {title}
        </h3>
        <div className="ui-grouped px-4 py-3.5 text-[15px]">
          {description ? <p className="mb-3 text-[14px] leading-snug text-muted">{description}</p> : null}
          {children}
        </div>
      </section>
    );
  return (
    <section className="ui-card rounded-control p-5" aria-labelledby={id}>
      <h3 id={id} className="ui-display text-[17px]">
        {title}
      </h3>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
