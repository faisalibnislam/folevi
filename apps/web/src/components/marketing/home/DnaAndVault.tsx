import Link from "next/link";
import { ArrowRight, Check, Clock, FileKey, KeyRound, LockKeyhole, ShieldCheck, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { DnaDemo } from "../demos/DnaDemo";
import { SectionHeading, box, container, cx } from "../ui";
import { Hand, Mark, Sticker } from "../fun";

/*
 * Two of Folevi's own things, shown big on the home page (owner, 2026-11-06): Foli DNA, the map of how notes
 * connect (features.tsx "foli-dna"), and the Vault with the rest of Folevi's security (docs/VAULT_PLAN.md:
 * always end-to-end encrypted, each person's own passcode, a log nobody can edit; end-to-end encryption for
 * notes in Settings → Privacy on every plan).
 */

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-7 grid gap-2.5">
      {items.map((p) => (
        <li key={p} className="flex gap-2.5 text-[15px] leading-snug">
          <Check size={16} aria-hidden="true" className="mt-0.5 flex-none text-(--mk-violet-ink)" />
          {p}
        </li>
      ))}
    </ul>
  );
}

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="mt-7 text-[15px]">
      <Link href={href} className="mk-link group inline-flex min-h-11 items-center gap-1.5">
        {children} <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
      </Link>
    </p>
  );
}

export function FoliDna() {
  return (
    <section id="foli-dna" aria-labelledby="dna-title" className={cx(container, "scroll-mt-20")}>
      <div className={box}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
          <div>
            <SectionHeading
              id="dna-title"
              eyebrow="Foli DNA"
              title={
                <>
                  See how your ideas <Mark kind="squiggle">connect</Mark>.
                </>
              }
              lede="Foli DNA draws your notes and the links between them as a living map, so the patterns in your thinking show up on their own."
            />
            <Points
              items={[
                "Clusters shade the groups your notes fall into",
                "Suggested links between notes that mention the same thing",
                "A view around any note, one to three steps out",
                "A time-lapse of how your map grew, week by week",
              ]}
            />
            <More href="/features/foli-dna">More about Foli DNA</More>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute -top-5 right-4 z-10 max-sm:hidden">
              <Hand rotate={4} arrow="down-left">
                your notes, as a map
              </Hand>
            </div>
            <DnaDemo />
          </div>
        </div>
      </div>
    </section>
  );
}

/** A locked Vault, drawn from the app's pieces: a few items with hidden fields and a 2FA code. */
function VaultPicture() {
  const items: Array<{ icon: ReactNode; name: string; kind: string }> = [
    { icon: <KeyRound size={15} />, name: "Bank login", kind: "Login" },
    { icon: <FileKey size={15} />, name: "Stripe API key", kind: "API key" },
    { icon: <Wifi size={15} />, name: "Studio Wi-Fi", kind: "Wi-Fi" },
  ];
  return (
    <div role="img" aria-label="The Vault, unlocked with a passcode: a bank login, an API key and the studio Wi-Fi, each with its secret hidden, and a two-factor code counting down." className="mk-card overflow-hidden">
      <div aria-hidden="true">
        <div className="flex h-11 items-center gap-2 border-b mk-hair px-4">
          <LockKeyhole size={15} className="text-(--mk-violet-ink)" />
          <span className="text-[14px] font-semibold text-(--color-heading)">Vault</span>
          <span className="ml-auto flex items-center gap-1 rounded-chip bg-(--mk-violet-soft) px-2 py-0.5 text-[11px] font-semibold text-(--mk-violet-ink)">
            <ShieldCheck size={12} /> End-to-end encrypted
          </span>
        </div>
        <ul className="px-2 py-2">
          {items.map((it, i) => (
            <li key={it.name} className={cx("flex items-center gap-3 rounded-control px-2 py-2", i === 0 && "bg-(--color-surface-sunken)")}>
              <span className="mk-tile flex-none">{it.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-(--color-heading)">{it.name}</span>
                <span className="block text-[12px] text-muted">{it.kind}</span>
              </span>
              <span className="font-mono text-[13px] tracking-[0.2em] text-muted">••••••••</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 border-t mk-hair px-4 py-3">
          <span className="text-[12px] text-muted">2FA code</span>
          <span className="font-mono text-[18px] font-semibold tracking-[0.15em] text-(--color-heading)">482 913</span>
          <span className="ml-auto flex items-center gap-1 text-[12px] text-muted">
            <Clock size={12} /> 18s
          </span>
        </div>
      </div>
    </div>
  );
}

const SECURITY: Array<{ title: string; body: string }> = [
  { title: "End-to-end encryption", body: "Turn it on in Settings → Privacy, on every plan. Your notes are encrypted on your devices before they’re sent." },
  { title: "Passkeys and two-step sign-in", body: "Sign in with a passkey, and add an authenticator app as a second step." },
  { title: "No trackers", body: "Folevi loads no ads and no third-party trackers." },
  { title: "Your notes off our servers", body: "In the Mac, iPhone and iPad apps with no account, our servers never see your notes." },
];

export function VaultSecurity() {
  return (
    <section id="vault" aria-labelledby="vault-title" className={cx(container, "scroll-mt-20")}>
      <div className={cx(box, "mk-tint relative overflow-hidden")}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
          <div>
            <SectionHeading
              id="vault-title"
              eyebrow="Vault and security"
              title={
                <>
                  Your secrets, locked <Mark kind="circle">tight</Mark>.
                </>
              }
              lede="The Vault keeps passwords, 2FA codes, API keys and private files next to your work, and only you can open it. Even Folevi can’t."
            />
            <Points
              items={[
                "Always end-to-end encrypted, opened with your own passcode",
                "Passwords with a generator, strength checks and 2FA codes",
                "A team Vault that only the people you add can open",
                "A log of everything done in it that nobody can edit",
              ]}
            />
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute -top-4 right-4 z-10">
              <Sticker tone="violet" rotate={-6} className="text-[14px]">
                On every plan
              </Sticker>
            </div>
            <VaultPicture />
          </div>
        </div>
        <ul className="mt-12 grid gap-6 border-t mk-hair pt-8 sm:grid-cols-2 xl:grid-cols-4">
          {SECURITY.map((s) => (
            <li key={s.title}>
              <span className="flex items-center gap-2 text-[16px] font-semibold text-(--color-heading)">
                <ShieldCheck size={17} aria-hidden="true" className="text-(--mk-violet-ink)" />
                {s.title}
              </span>
              <span className="mt-1.5 block text-[15px] leading-relaxed text-muted">{s.body}</span>
            </li>
          ))}
        </ul>
        <More href="/security">How Folevi keeps your work safe</More>
      </div>
    </section>
  );
}
