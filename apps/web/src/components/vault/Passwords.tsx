"use client";
// Passwords & Credentials (docs/VAULT_PLAN.md §4): the list (summaries, opened on this device), adding and editing an
// item (each kind's fields, a generator, strength), and an item (its secrets fetched by vaultItems.open, which logs it;
// hidden fields shown only on reveal; copying logged and the clipboard cleared after 30 seconds; live 2FA codes).
import { useAction, useMutation } from "convex/react";
import { useQuery } from "@/lib/convex/queries";
import { useEffect, useId, useMemo, useState } from "react";
import { BadgeCheck, CodeXml, Copy, CopyPlus, CreditCard, Eye, EyeOff, History, IdCard, KeyRound, Landmark, Plus, RefreshCw, Search, Share2, SquareTerminal, StickyNote, Trash2, WandSparkles, Wifi, type LucideIcon } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { ContextMenu } from "@/components/ui/Menu";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { vaultSessions } from "@/lib/vault/keys";
import { changedFields, ITEM_KINDS, newItemId, openSecrets, openSummary, sealItem, splitItem, type ItemContent, type ItemKind, type ItemSecrets, type ItemSummary } from "@/lib/vault/items";
import { passphrase, passwordStrength, randomPassword } from "@/lib/vault/generator";
import { breachStatus } from "@/lib/vault/breach";
import { parseTotp, totpCode } from "@/lib/vault/totp";
import { copySecret, useRecordEvent } from "./useVault";
import { ShareDialog } from "./ShareDialog";
import { HistoryDialog } from "./HistoryDialog";

type Row = NonNullable<ReturnType<typeof useRowsQuery>>["items"][number];
type Opened = { row: Row; summary: ItemSummary & { kind: ItemKind } };

function useRowsQuery(vaultId: string) {
  return useQuery(api.vaultItems.list, { vaultId, section: "passwords" });
}

const keysOf = (vaultId: string) => (version: number) => vaultSessions().keys(vaultId, version);

/** The list's rows opened on this device. */
function useOpenedRows(vaultId: string, rows: Row[] | undefined): Opened[] | undefined {
  const [opened, setOpened] = useState<Opened[] | undefined>(undefined);
  useEffect(() => {
    if (!rows) return;
    let gone = false;
    void Promise.all(rows.map(async (row) => ({ row, summary: await openSummary(vaultId, row, keysOf(vaultId)).catch(() => ({ kind: row.kind as ItemKind, title: "Can't open this item", fields: {}, tags: [] })) }))).then((r) => {
      if (!gone) setOpened(r);
    });
    return () => {
      gone = true;
    };
  }, [vaultId, rows]);
  return opened;
}

export function Passwords({ vaultId, initialSelected = null }: { vaultId: string; initialSelected?: string | null }) {
  const data = useRowsQuery(vaultId);
  const opened = useOpenedRows(vaultId, data?.items);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ItemKind | "all">("all");
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; item: Opened; host?: HTMLElement } | null>(null);
  // A copy opens straight in Edit, to rename it or change what differs.
  const [editNew, setEditNew] = useState<string | null>(null);
  const duplicate = useDuplicate(vaultId, (id) => (setEditNew(id), setSelected(id)));
  const [adding, setAdding] = useState(false);
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    return (opened ?? []).filter((o) => (kind === "all" || o.summary.kind === kind) && (!needle || [o.summary.title, ...Object.values(o.summary.fields)].some((v) => v.toLocaleLowerCase().includes(needle))));
  }, [opened, q, kind]);
  const current = opened?.find((o) => o.row.id === selected) ?? null;

  return (
    <div>
      {/* Search, kind and Add span the page; the list takes it all until an item is open beside it. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search the Vault</span>
          <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-control w-full ui-input pl-9 pr-3 text-callout" />
        </label>
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as ItemKind | "all")} className="h-control ui-input px-3 text-callout">
          <option value="all">All kinds</option>
          {Object.entries(ITEM_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden /> Add
        </Button>
      </div>
      <div className={current ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" : undefined}>
        <section aria-label="Passwords and credentials">
          {opened === undefined ? (
            <div className="h-24 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />
          ) : !shown.length ? (
            <EmptyState icon={Search} title={opened.length ? "Nothing matches" : "No passwords yet"} body={opened.length ? undefined : "Add logins, API keys, cards and other credentials. Only people in the Vault can open them."} />
          ) : (
            <ul className="divide-y divide-transparent overflow-hidden ui-card rounded-control">
              {shown.map((o) => (
                <li key={o.row.id}>
                  <button
                      type="button"
                      onClick={() => setSelected(o.row.id)}
                      onContextMenu={(ev) => {
                        ev.preventDefault();
                        setMenu({ at: { x: ev.clientX, y: ev.clientY }, item: o, host: ev.currentTarget.closest<HTMLElement>(".ui-invert") ?? undefined });
                      }}
                      aria-current={selected === o.row.id || undefined} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface ${selected === o.row.id ? "bg-[var(--glass-active)]" : ""}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-subheadline font-medium text-ink">{o.summary.title}</span>
                      <span className="block truncate text-footnote text-muted">{[ITEM_KINDS[o.summary.kind]?.label, o.summary.fields.username || o.summary.fields.service || o.summary.fields.website].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="text-footnote text-faint">{formatRelative(o.row.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {current ? <ItemPanel key={current.row.id} vaultId={vaultId} opened={current} editOnOpen={editNew === current.row.id} onClosed={() => setSelected(null)} /> : null}
      </div>
      {adding ? <ItemDialog vaultId={vaultId} onClose={() => setAdding(false)} onSaved={(id) => (setAdding(false), setSelected(id))} /> : null}
      {menu ? (
        <ContextMenu
          at={menu.at}
          host={menu.host}
          label={menu.item.summary.title}
          onClose={() => setMenu(null)}
          items={[
            { label: "Open", icon: <KeyRound size={15} aria-hidden />, onSelect: () => setSelected(menu.item.row.id) },
            { label: "Duplicate", icon: <CopyPlus size={15} aria-hidden />, onSelect: () => void duplicate(menu.item) },
          ]}
        />
      ) : null}
    </div>
  );
}

function TotpCode({ secret, onCopy, onShow }: { secret: string; onCopy: (code: string) => void; onShow: () => void }) {
  const params = useMemo(() => parseTotp(secret), [secret]);
  const [code, setCode] = useState<{ code: string; secondsLeft: number } | null>(null);
  useEffect(() => {
    if (!params) return;
    onShow();
    let alive = true;
    const tick = () => void totpCode(params).then((c) => alive && setCode(c));
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  if (!params) return <span className="text-footnote text-warning">Not a 2FA secret Folevi can read.</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-title-3 tracking-[0.12em] text-heading">{code ? `${code.code.slice(0, 3)} ${code.code.slice(3)}` : "··· ···"}</span>
      <span className="text-footnote text-muted">{code ? `${code.secondsLeft}s` : ""}</span>
      <IconButton label="Copy the code" onClick={() => code && onCopy(code.code)}>
        <Copy size={14} aria-hidden />
      </IconButton>
    </span>
  );
}

/**
 * Duplicating an item: its secrets are opened (logged, as any open is), then sealed again as a new item with its own
 * key, every field kept and "(copy)" on the title; the log records which item it came from. Shares and history stay
 * with the original.
 */
function useDuplicate(vaultId: string, onMade: (id: string) => void) {
  const open = useMutation(api.vaultItems.open);
  const create = useMutation(api.vaultItems.create);
  const toast = useToast();
  return async (o: Opened) => {
    try {
      const s = vaultSessions();
      const r = await open({ vaultId, itemId: o.row.id, client: s.info(vaultId) });
      const secrets = await openSecrets(vaultId, { id: r.id, keyVersion: r.keyVersion, wrappedKey: r.wrappedKey, sealed: r.sealed }, keysOf(vaultId));
      const id = newItemId();
      const content: ItemContent = { kind: o.summary.kind, summary: { ...o.summary, title: `${o.summary.title} (copy)` }, secrets };
      await create({ vaultId, itemId: id, kind: o.summary.kind, item: await sealItem(vaultId, id, s.currentVersion(vaultId)!, s.keys(vaultId), content), duplicateOf: o.row.id, client: s.info(vaultId) });
      toast.show("Duplicated", { tone: "success" });
      onMade(id);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };
}

function ItemPanel({ vaultId, opened, editOnOpen = false, onClosed }: { vaultId: string; opened: Opened; editOnOpen?: boolean; onClosed: () => void }) {
  const open = useMutation(api.vaultItems.open);
  const remove = useMutation(api.vaultItems.remove);
  const record = useRecordEvent(vaultId);
  const toast = useToast();
  const [secrets, setSecrets] = useState<ItemSecrets | null>(null);
  const [full, setFull] = useState<{ canChange: boolean; revision: number; createdBy: string; updatedBy: string } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(editOnOpen);
  const [sharing, setSharing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const rekeyItem = useMutation(api.vaultItems.update);
  const item = { id: opened.row.id, kind: opened.row.kind };

  useEffect(() => {
    let gone = false;
    void open({ vaultId, itemId: opened.row.id, client: vaultSessions().info(vaultId) })
      .then(async (r) => {
        const s = await openSecrets(vaultId, { id: r.id, keyVersion: r.keyVersion, wrappedKey: r.wrappedKey, sealed: r.sealed }, keysOf(vaultId));
        if (!gone) {
          setSecrets(s);
          setFull({ canChange: r.canChange, revision: r.revision, createdBy: r.createdBy.name, updatedBy: r.updatedBy.name });
        }
      })
      .catch((e) => toast.show(errorMessage(e), { tone: "error" }));
    return () => {
      gone = true;
    };
  }, [open, vaultId, opened.row.id, opened.row.revision, toast]);

  const copy = async (field: string, value: string) => {
    await copySecret(value);
    record(field === "2FA code" ? "totp.copy" : "item.copy", item, { field });
    toast.show(`${field} copied. The clipboard clears in 30 seconds.`);
  };
  const def = ITEM_KINDS[opened.summary.kind];
  const value = (key: string) => opened.summary.fields[key] ?? secrets?.fields[key] ?? "";

  return (
    <section aria-label={opened.summary.title} className="self-start rounded-panel ui-card px-5 py-4">
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title-3 font-semibold text-heading">{opened.summary.title}</h3>
          <p className="text-footnote text-muted">{def?.label}{full ? ` · added by ${full.createdBy}, changed by ${full.updatedBy}` : ""}</p>
        </div>
        <IconButton label="Earlier versions" onClick={() => setHistoryOpen(true)} disabled={!full}>
          <History size={14} aria-hidden />
        </IconButton>
        {full?.canChange ? (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={!secrets}>
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setSharing(true)} disabled={!secrets}>
              <Share2 size={13} aria-hidden /> Share
            </Button>
            <IconButton
              label="Move to the Vault's Trash"
              className="hover:text-danger"
              onClick={() => void remove({ vaultId, itemId: opened.row.id, client: vaultSessions().info(vaultId) }).then(() => (toast.show("Moved to the Vault's Trash"), onClosed()), (e) => toast.show(errorMessage(e), { tone: "error" }))}
            >
              <Trash2 size={14} aria-hidden />
            </IconButton>
          </>
        ) : null}
      </div>
      {!secrets ? (
        <div className="h-20 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />
      ) : (
        <dl className="divide-y divide-line">
          {def?.fields.map((f) => {
            const v = value(f.key);
            if (!v) return null;
            const hidden = f.type === "secret" && !revealed.has(f.key);
            return (
              <div key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <dt className="w-32 flex-none text-footnote text-muted">{f.label}</dt>
                <dd className="flex min-w-0 flex-1 items-center gap-1.5">
                  {f.type === "totp" ? (
                    <TotpCode secret={v} onCopy={(code) => void copy("2FA code", code)} onShow={() => record("totp.show", item)} />
                  ) : (
                    <>
                      <span className={`min-w-0 flex-1 break-all text-subheadline text-ink ${f.type === "secret" || f.type === "multiline" ? "font-mono" : ""} ${f.type === "multiline" ? "whitespace-pre-wrap" : ""}`}>{hidden ? "••••••••••••" : v}</span>
                      {f.type === "secret" ? (
                        <IconButton
                          label={hidden ? `Show ${f.label}` : `Hide ${f.label}`}
                          onClick={() => {
                            const next = new Set(revealed);
                            if (hidden) {
                              next.add(f.key);
                              record("item.reveal", item, { field: f.key });
                            } else next.delete(f.key);
                            setRevealed(next);
                          }}
                        >
                          {hidden ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
                        </IconButton>
                      ) : null}
                      <IconButton label={`Copy ${f.label}`} onClick={() => void copy(f.label, v)}>
                        <Copy size={14} aria-hidden />
                      </IconButton>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
          {secrets.notes ? (
            <div className="py-2.5">
              <dt className="text-footnote text-muted">Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap text-subheadline text-ink">{secrets.notes}</dd>
            </div>
          ) : null}
        </dl>
      )}
      {editing && secrets && full ? <ItemDialog vaultId={vaultId} existing={{ row: opened.row, revision: full.revision, content: { kind: opened.summary.kind, summary: opened.summary, secrets } }} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}
      {historyOpen && full ? <HistoryDialog vaultId={vaultId} itemId={opened.row.id} canChange={full.canChange} onClose={() => setHistoryOpen(false)} /> : null}
      {sharing && secrets && full ? (
        <ShareDialog
          vaultId={vaultId}
          row={opened.row}
          title={opened.summary.title}
          rekey={async () => {
            const s = vaultSessions();
            const content = { kind: opened.summary.kind, summary: opened.summary, secrets };
            await rekeyItem({ vaultId, itemId: opened.row.id, baseRevision: full.revision, item: await sealItem(vaultId, opened.row.id, s.currentVersion(vaultId)!, s.keys(vaultId), content), changed: [], client: s.info(vaultId) });
          }}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </section>
  );
}

// The item dialog's fields (the Mac's Add to the Vault, 2026-11-19): 34px tall with 12px before the words, a 12px
// label 6px above each one, 16px between them. Touch gets the 44px it needs.
const FIELD_LABEL = "mb-1.5 block text-caption-1 font-medium text-ink";
const FIELD = "h-control ui-input px-3";
const AREA = "ui-grow block w-full ui-input px-3 py-2";
// The password's tools: small 24px pills (36px to a finger).
const PILL = "ui-btn ui-btn-secondary h-control-sm gap-1 rounded-container px-2.5 text-caption-1 font-medium pointer-coarse:h-control";

const KIND_ICONS: Record<ItemKind, LucideIcon> = {
  login: KeyRound,
  apiKey: CodeXml,
  card: CreditCard,
  bankAccount: Landmark,
  secureNote: StickyNote,
  sshKey: SquareTerminal,
  wifi: Wifi,
  licence: BadgeCheck,
  identity: IdCard,
};

function KindIcon({ kind }: { kind: ItemKind }) {
  const Icon = KIND_ICONS[kind];
  return <Icon size={14} aria-hidden className="flex-none text-muted" />;
}

/** Four short bars filled to the score (red, amber, green), then the word. */
function StrengthMeter({ id, score, label }: { id: string; score: number; label: string }) {
  const filled = Math.max(score, 1);
  const tone = score >= 3 ? "bg-success" : score === 2 ? "bg-warning" : "bg-danger";
  return (
    <span id={id} className="flex items-center gap-2 text-footnote text-muted">
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1 w-5 rounded-tiny ${i < filled ? tone : "bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]"}`} />
        ))}
      </span>
      <span>
        <span className="sr-only">Strength: </span>
        {label}
      </span>
    </span>
  );
}

function ItemDialog({ vaultId, existing, onClose, onSaved }: { vaultId: string; existing?: { row: Row; revision: number; content: ItemContent }; onClose: () => void; onSaved: (id: string) => void }) {
  const create = useMutation(api.vaultItems.create);
  const update = useMutation(api.vaultItems.update);
  const breachRange = useAction(api.vaultItems.breachRange);
  const toast = useToast();
  const uid = useId();
  const [kind, setKind] = useState<ItemKind>(existing?.content.kind ?? "login");
  const [title, setTitle] = useState(existing?.content.summary.title ?? "");
  const [values, setValues] = useState<Record<string, string>>({ ...(existing?.content.summary.fields ?? {}), ...(existing?.content.secrets.fields ?? {}) });
  const [notes, setNotes] = useState(existing?.content.secrets.notes ?? "");
  const [busy, setBusy] = useState(false);
  const password = values.password ?? "";
  const strength = password ? passwordStrength(password) : null;

  const save = async () => {
    setBusy(true);
    try {
      const s = vaultSessions();
      const version = s.currentVersion(vaultId)!;
      const content = splitItem(kind, title, values, notes, existing?.content.secrets.custom ?? [], existing?.content.summary.tags ?? []);
      // Health, worked out here and sealed with the summary: only 5 characters of the password's SHA-1 leave.
      const pw = content.secrets.fields.password;
      if (pw) content.summary.health = { strength: passwordStrength(pw).score, breached: await breachStatus(pw, (prefix) => breachRange({ prefix })), checkedAt: Date.now() };
      if (existing) {
        // The same item key, so whoever it's shared with still opens it.
        const itemSealed = await sealItem(vaultId, existing.row.id, version, s.keys(vaultId), content, { keyVersion: existing.row.keyVersion, wrappedKey: existing.row.wrappedKey, keys: s.keys(vaultId, existing.row.keyVersion) });
        await update({ vaultId, itemId: existing.row.id, baseRevision: existing.revision, item: itemSealed, changed: changedFields(existing.content, content), client: s.info(vaultId) });
        toast.show("Saved");
        onSaved(existing.row.id);
      } else {
        const id = newItemId();
        await create({ vaultId, itemId: id, kind, item: await sealItem(vaultId, id, version, s.keys(vaultId), content), client: s.info(vaultId) });
        toast.show("Added to the Vault", { tone: "success" });
        onSaved(id);
      }
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? `Edit ${existing.content.summary.title}` : "Add to the Vault"}
      description="Encrypted on this device before it is saved."
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !title.trim()} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-1 text-subheadline">
        {!existing ? (
          <div>
            <span id={`${uid}-kind`} className={FIELD_LABEL}>
              Kind
            </span>
            <Select aria-labelledby={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value as ItemKind)} leading={<KindIcon kind={kind} />} className={`${FIELD} w-full`}>
              {Object.entries(ITEM_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div>
          <label htmlFor={`${uid}-title`} className={FIELD_LABEL}>
            Title
          </label>
          <input id={`${uid}-title`} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A name to find it by" className={`${FIELD} w-full`} />
        </div>
        {ITEM_KINDS[kind].fields.map((f) => (
          <div key={f.key}>
            <label htmlFor={`${uid}-${f.key}`} className={FIELD_LABEL}>
              {f.label}
            </label>
            {f.type === "multiline" ? (
              <textarea id={`${uid}-${f.key}`} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} rows={4} className={`${AREA} font-mono`} />
            ) : (
              <input
                id={`${uid}-${f.key}`}
                type={f.type === "date" ? "date" : "text"}
                autoComplete="off"
                spellCheck={false}
                placeholder={f.type === "url" ? "example.com" : undefined}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                aria-describedby={f.key === "password" && strength ? `${uid}-strength` : undefined}
                className={`${FIELD} w-full ${f.type === "secret" || f.type === "totp" ? "font-mono" : ""}`}
              />
            )}
            {/* The password's strength on the left and its tools on the right, on one line under the field. */}
            {f.key === "password" ? (
              <div className="mt-2 flex min-h-6 items-center gap-2">
                {strength ? <StrengthMeter id={`${uid}-strength`} score={strength.score} label={strength.label} /> : null}
                <span className="ml-auto flex gap-1.5">
                  <button type="button" className={PILL} onClick={() => setValues({ ...values, password: randomPassword() })}>
                    <RefreshCw size={12} aria-hidden /> Generate
                  </button>
                  <button type="button" className={PILL} onClick={() => setValues({ ...values, password: passphrase() })}>
                    <WandSparkles size={12} aria-hidden /> Memorable
                  </button>
                </span>
              </div>
            ) : null}
          </div>
        ))}
        <div>
          <label htmlFor={`${uid}-notes`} className={FIELD_LABEL}>
            Notes
          </label>
          <textarea id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={AREA} />
        </div>
      </div>
    </Dialog>
  );
}
