import { useId } from "react";

export function Card({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  // A generated id: titles have spaces, and aria-labelledby reads a space-separated list of ids.
  const id = useId();
  return (
    <section className="ui-card rounded-[8px] p-5" aria-labelledby={id}>
      <h3 id={id} className="ui-display text-[17px]">
        {title}
      </h3>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
