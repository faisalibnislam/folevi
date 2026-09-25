export function Card({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="ui-card rounded-[18px] p-5" aria-labelledby={`s-${title}`}>
      <h3 id={`s-${title}`} className="font-semibold">
        {title}
      </h3>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
