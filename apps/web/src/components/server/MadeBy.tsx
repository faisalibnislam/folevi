// Folevi Server's setup and admin pages name the company that makes it (the owner, 2026-11-27), with a link to its
// website. "Made by", not "operated by": the person who runs a server operates it. Name and link only: the postal
// address stays in the legal places (terms, privacy, support, emails, Settings > About).
import { OPERATOR } from "@/components/marketing/site";

export function ServerMadeBy({ className = "" }: { className?: string }) {
  return (
    <p data-testid="server-made-by" className={`text-footnote text-muted ${className}`}>
      Folevi Server is made by{" "}
      <a href={OPERATOR.url} target="_blank" rel="noopener" className="underline decoration-line underline-offset-2 hover:text-heading">
        {OPERATOR.name}
      </a>
      .
    </p>
  );
}
