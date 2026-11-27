import { Check, Globe, QrCode, Server, Wifi } from "lucide-react";
import { Kbd } from "../ui";

/*
 * Pictures for the newer feature pages, drawn like the others in MorePictures.tsx: replicas of the app's own
 * screens with its labels. Each is one image for assistive tech, with the details in its label.
 */

/** Spell check and prediction: a misspelled word with its suggestions, and a predicted word waiting for Tab. */
export function SpellingPicture() {
  return (
    <div
      role="img"
      aria-label="A note called Trip to Lisbon. The misspelled word recieve has a red wavy underline, and the menu under it suggests receive, relieve and reprieve, then Add to dictionary and Ignore. On the next line, after the caret, the predicted word Friday waits in gray with a Tab key beside it."
      className="mx-auto max-w-[560px] text-[14px]"
    >
      <div aria-hidden="true" className="mk-app-pop relative rounded-panel px-6 pb-6 pt-5">
        <p className="mk-display text-[21px] text-(--color-heading)">Trip to Lisbon</p>
        <p className="mt-2 leading-relaxed text-ink">
          The hotel says we’ll{" "}
          <span className="underline decoration-[#e5484d] decoration-wavy decoration-[1.5px] underline-offset-[3px]">recieve</span> the keys at the front desk.
        </p>
        <div className="mt-1 w-[200px] translate-x-24 overflow-hidden rounded-panel bg-(--color-surface-raised) py-1.5 text-[13px] shadow-[0_12px_32px_-12px_rgb(20_20_40/0.35),0_0_0_1px_var(--color-line)] sm:translate-x-32">
          {["receive", "relieve", "reprieve"].map((word, i) => (
            <p key={word} className={i === 0 ? "mx-1.5 rounded-chip bg-(--color-accent-soft) px-2.5 py-1.5 font-semibold text-(--color-heading)" : "px-4 py-1.5 font-semibold text-(--color-heading)"}>
              {word}
            </p>
          ))}
          <div className="my-1.5 border-t border-(--color-line)" />
          <p className="px-4 py-1.5 text-ink">Add to dictionary</p>
          <p className="px-4 py-1.5 text-ink">Ignore</p>
        </div>
        <p className="mt-4 leading-relaxed text-ink">
          The tram to Belém runs every ten minutes until
          <span className="ml-px inline-block h-[1.05em] w-px translate-y-[0.15em] bg-(--color-heading)" />
          <span className="text-muted opacity-70"> Friday</span>
          <span className="ml-2 inline-flex translate-y-[-1px] align-middle">
            <Kbd>Tab</Kbd>
          </span>
        </p>
      </div>
    </div>
  );
}

/** Your own server: the sign-in sheet with its three ways to reach a server. */
export function OwnServerPicture() {
  const ways = [
    { icon: Globe, title: "Enter an address", detail: "notes.example.com" },
    { icon: QrCode, title: "Scan a QR code", detail: "From the server’s admin page" },
    { icon: Wifi, title: "On this network", detail: "Folevi on Home NAS", found: true },
  ];
  return (
    <div
      role="img"
      aria-label="The Your own server sign-in. Three ways to reach a server: Enter an address, Scan a QR code from the server's admin page, and On this network, which has found Folevi on Home NAS. A Continue button sits at the bottom."
      className="mx-auto max-w-[440px] text-[14px]"
    >
      <div aria-hidden="true" className="mk-app-pop rounded-panel px-5 pb-5 pt-5">
        <span className="mk-tile">
          <Server size={17} />
        </span>
        <p className="mt-3 text-[18px] font-semibold text-(--color-heading)">Sign in to your own server</p>
        <p className="mt-1 text-[13px] text-muted">Your notes stay on a server you run.</p>
        <ul className="mt-4 space-y-2">
          {ways.map(({ icon: WayIcon, title, detail, found }) => (
            <li key={title} className={found ? "flex items-center gap-3 rounded-chip bg-(--color-accent-soft) px-3 py-2.5" : "flex items-center gap-3 rounded-chip border border-(--color-line) px-3 py-2.5"}>
              <WayIcon size={16} className="text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-(--color-heading)">{title}</span>
                <span className="block truncate text-[12px] text-muted">{detail}</span>
              </span>
              {found ? <Check size={16} className="text-(--color-heading)" /> : null}
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-chip bg-(--color-heading) py-2.5 text-center text-[14px] font-medium text-(--color-surface)">Continue</p>
      </div>
    </div>
  );
}
