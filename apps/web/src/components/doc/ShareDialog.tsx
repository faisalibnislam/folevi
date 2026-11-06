"use client";

import { DateTimeField, localDateTimeValue } from "@/components/ui/DateField";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { ChevronRight, Copy, Globe, Info, Link2, Lock, Trash2, Users } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button, IconButton } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { PUBLISH_THEMES, publishTheme, type PublishTheme } from "@/lib/publishThemes";
import { copy as e2eeCopy, e2eeErrorMessage } from "@/lib/e2ee/copy";
import { createEncryptedLink, isSealedDocument, publishPlainCopy, revokeEncryptedLink, useE2eeSpaceStatus } from "@/components/e2ee/hooks";
import { useAppState } from "@/lib/app/state";
import { PublishCopyDialog } from "@/components/e2ee/PublishCopyDialog";
import { roleLabel } from "@/lib/app/folderSharing";
import { APP_URL, MARKETING_HOST, publicLinkUrl } from "@/lib/env";

export type ShareData = NonNullable<FunctionReturnType<typeof api.sharing.get>>;
export type ShareFolderAccess = FunctionReturnType<typeof api.folderSharing.forNote>;
type Role = "viewer" | "commenter" | "editor";

/** What the dialog does: Convex in the app (ShareDialog), anything in a preview. */
export interface ShareActions {
  setMode(mode: "workspace" | "restricted"): Promise<unknown>;
  grant(email: string, role: Role): Promise<{ status: string }>;
  revoke(profileId: string): Promise<unknown>;
  revokeInvite(inviteId: string): Promise<unknown>;
  /** Makes a public link; its whole address (shown once). */
  createLink(o: { expiresAt?: number; password?: string; allowIndexing: boolean; theme: PublishTheme }): Promise<{ url: string; linkId?: string }>;
  revokeLink(linkId: string): Promise<unknown>;
  setLinkTheme(linkId: string, theme: PublishTheme): Promise<unknown>;
  setLinkDna(linkId: string, showDna: boolean): Promise<unknown>;
  unpublish(linkId: string): Promise<unknown>;
  updatePlainCopy(linkId: string): Promise<unknown>;
}

/** `personal`: the page is in someone's Personal, which has no members. Only the people added here (and its owner) can open it. */
export function ShareDialog({ open, onClose, documentId, title, personal = false }: { open: boolean; onClose: () => void; documentId: string; title: string; personal?: boolean }) {
  const data = useQuery(api.sharing.get, open ? { documentId } : "skip");
  // People who have it through a folder it's in (docs/SHARING.md), changed in that folder's Share dialog.
  const folderAccess = useQuery(api.folderSharing.forNote, open ? { documentId } : "skip");
  const setMode = useMutation(api.sharing.setAccessMode);
  const grant = useMutation(api.sharing.grant);
  const revoke = useMutation(api.sharing.revoke);
  const revokeInvite = useMutation(api.sharing.revokePageInvite);
  const createLink = useMutation(api.sharing.createPublicLink);
  const revokeLink = useMutation(api.sharing.revokePublicLink);
  const setLinkTheme = useMutation(api.sharing.setPublicLinkTheme);
  const setLinkDna = useMutation(api.sharing.setPublicLinkDna);
  const unpublish = useMutation(api.e2ee.links.unpublish);
  // An end-to-end encrypted note (docs/E2EE_DESIGN.md §9, §10.13): links carry their key after "#", and
  // publishing makes a readable copy on purpose. Always false for Standard notes.
  // (Re-read whenever this device's view of the space changes, e.g. as the note is encrypted.)
  useE2eeSpaceStatus(useAppState().scope);
  const sealed = open && isSealedDocument(documentId);

  const actions: ShareActions = {
    setMode: (mode) => setMode({ documentId, mode }),
    grant: (email, role) => grant({ documentId, email, role }),
    revoke: (profileId) => revoke({ documentId, profileId }),
    revokeInvite: (inviteId) => revokeInvite({ inviteId }),
    createLink: async (o) => {
      if (isSealedDocument(documentId)) {
        // The key goes in the fragment, which never reaches the server (§9.1).
        return (await createEncryptedLink(documentId, { expiresAt: o.expiresAt, password: o.password, theme: o.theme })) as { url: string; linkId?: string };
      }
      const r = await createLink({ documentId, expiresAt: o.expiresAt, password: o.password, allowIndexing: o.allowIndexing, theme: o.theme });
      // The real web address (folevi.com) on every platform, never app://folevi (lib/env.ts SHARE_ORIGIN).
      return { url: publicLinkUrl(r.token), linkId: r.id };
    },
    revokeLink: (linkId) => (isSealedDocument(documentId) ? revokeEncryptedLink(documentId, linkId) : revokeLink({ linkId })),
    setLinkTheme: (linkId, theme) => setLinkTheme({ linkId, theme }),
    setLinkDna: (linkId, showDna) => setLinkDna({ linkId, showDna }),
    unpublish: (linkId) => unpublish({ linkId }),
    updatePlainCopy: (linkId) => publishPlainCopy(documentId, { linkId }),
  };

  return <ShareDialogView open={open} onClose={onClose} documentId={documentId} title={title} personal={personal} data={data ?? null} folderAccess={folderAccess} sealed={sealed} actions={actions} />;
}

/** A small (i) whose words show in Folevi's tooltip (its `title`): the longer explanations, kept off the dialog. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span role="img" tabIndex={0} aria-label={text} title={text} className="inline-flex flex-none cursor-help rounded-tiny text-faint transition-colors hover:text-ink focus-visible:text-ink">
      <Info size={13} aria-hidden />
    </span>
  );
}

const roleText = (r: string) => (r === "editor" ? "Can edit" : r === "commenter" ? "Can comment" : "Can view");
const themeName = (t: unknown) => PUBLISH_THEMES.find((x) => x.id === publishTheme(t))!.name;
const PUBLIC_LINK_INFO = "Anyone with the link can read this page (not its comments or nested pages). Search engines skip it unless you let them find it, and you can revoke it instantly.";

type NewLink = { expires: string; password: string; index: boolean; theme: PublishTheme };
const NO_LINK: NewLink = { expires: "", password: "", index: false, theme: "note" };

/**
 * The Share dialog's compact rows (the owner's design A, like Google Docs and Notion): add people, who's added,
 * Access as one dropdown, then the public link as a switch with its address, and its settings folded away.
 */
export function ShareDialogView({
  open,
  onClose,
  documentId,
  title,
  personal,
  data,
  folderAccess,
  sealed,
  actions,
  initialSettingsOpen = false,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  title: string;
  personal: boolean;
  data: ShareData | null;
  folderAccess: ShareFolderAccess | undefined;
  sealed: boolean;
  actions: ShareActions;
  /** (Previews: the link's settings start open.) */
  initialSettingsOpen?: boolean;
}) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [linkForm, setLinkForm] = useState<NewLink>(NO_LINK);
  const [fresh, setFresh] = useState<{ url: string; linkId?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  // Managers: access mode, public links, anyone's grants. Sharers (members who can edit): add people and
  // change what they added. The server checks both again.
  const canManage = data?.canManage === true;
  const canShare = data?.canShare === true;

  const run = async (p: Promise<unknown>, ok?: string) => {
    try {
      await p;
      if (ok) toast.show(ok, { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };
  const copyText = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast.show("Link copied"),
      () => toast.show("Couldn’t copy the link", { tone: "error" }),
    );
  const close = () => {
    setFresh(null);
    setPublished(null);
    setAnother(false);
    onClose();
  };

  const links = (data?.links ?? []).filter((l) => !(l as { plainCopy?: boolean }).plainCopy);
  const linkOn = links.length > 0;
  // The link just made: its whole address is shown (and copyable) this once.
  const newest = links.reduce<(typeof links)[number] | null>((a, l) => (!a || l.createdAt > a.createdAt ? l : a), null);
  const freshFor = (l: (typeof links)[number]) => (fresh && (fresh.linkId ? fresh.linkId === l.id : l === newest) ? fresh.url : null);

  const makeLink = async () => {
    if (busy) return;
    if (linkForm.password && linkForm.password.length < 5) {
      setSettingsOpen(true);
      toast.show("Use a password of at least 5 characters.", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const made = await actions.createLink({
        expiresAt: linkForm.expires ? new Date(linkForm.expires).getTime() : undefined,
        password: linkForm.password || undefined,
        allowIndexing: linkForm.index && !linkForm.password && !sealed,
        theme: linkForm.theme,
      });
      setFresh(made);
      setLinkForm(NO_LINK);
      setAnother(false);
    } catch (err) {
      toast.show(e2eeErrorMessage(err) ?? errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const stopLinks = async () => {
    if (busy) return;
    setBusy(true);
    await run(Promise.all(links.map((l) => actions.revokeLink(l.id))), links.length > 1 ? "Links revoked" : "Link revoked");
    setFresh(null);
    setBusy(false);
  };

  const expiryText = (l: { expired: boolean; expiresAt?: number | null }) => (l.expired ? "Expired" : l.expiresAt ? `Expires ${formatDateTime(l.expiresAt)}` : "No expiry");
  const settingsSummary = linkOn && newest ? `${expiryText(newest)} · ${themeName(newest.theme)} look` : `${linkForm.expires ? `Expires ${formatDateTime(new Date(linkForm.expires).getTime())}` : "No expiry"}${linkForm.password ? " · Password" : ""} · ${themeName(linkForm.theme)} look`;

  const peopleNote = personal ? "Anyone with an email address. People without a Folevi account get an invitation by email." : "People outside the workspace join as guests on this page only and aren’t billed. People without a Folevi account get an invitation by email.";

  const newLinkFields = (
    <>
      <div className="grid items-center gap-x-3 gap-y-2 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
        <span className="font-medium text-ink">Expires</span>
        <DateTimeField value={linkForm.expires ? new Date(linkForm.expires).getTime() : null} onChange={(ts) => setLinkForm({ ...linkForm, expires: ts ? localDateTimeValue(ts) : "" })} aria-label="Expiry" />
        <label htmlFor="share-link-password" className="font-medium text-ink">
          Password
        </label>
        <input id="share-link-password" type="password" autoComplete="new-password" placeholder="None" value={linkForm.password} onChange={(e) => setLinkForm({ ...linkForm, password: e.target.value })} className="block h-9 w-full ui-input rounded-chip px-3 text-callout" />
        <span id="share-link-look" className="font-medium text-ink">
          Look
        </span>
        <LookSelect labelledBy="share-link-look" value={linkForm.theme} onChange={(theme) => setLinkForm({ ...linkForm, theme })} />
        {sealed ? null : (
          <>
            <span className="font-medium text-ink">Search</span>
            <span className="flex items-center gap-2">
              <Switch checked={linkForm.index && !linkForm.password} disabled={Boolean(linkForm.password)} label="Let search engines find it" describedBy="share-link-index-hint" onChange={(on) => setLinkForm({ ...linkForm, index: on })} />
              <span id="share-link-index-hint" className="min-w-0 text-footnote text-muted">
                {linkForm.password ? "Not for a password-protected page." : "Let search engines find it"}
              </span>
            </span>
          </>
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={busy || !data?.publicLinksAvailable} onClick={() => void makeLink()}>
          <Globe size={14} aria-hidden /> Create link
        </Button>
      </div>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Share “${title || "Untitled"}”`}
      size="md"
      footer={
        <>
          <Button variant="quiet" className="mr-auto" onClick={() => copyText(`${APP_URL.replace(/\/$/, "")}/d/${documentId}`)}>
            <Link2 size={14} aria-hidden /> Copy link
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      {!data ? (
        <p className="text-subheadline text-muted">Loading…</p>
      ) : (
        <div className="space-y-4 text-subheadline" data-testid="share-dialog">
          <section aria-label="People" className="space-y-2">
            {data.youAreGuest ? (
              <p className="flex items-center gap-1.5 text-footnote text-muted">
                <span className="min-w-0 truncate">You’re a guest{data.sharedBy ? `, shared by ${data.sharedBy}` : ""}.</span>
                <InfoTip text={`${data.ownerName ? `It belongs to ${data.ownerName}. ` : ""}Only its owner and the workspace’s members can share it.`} />
              </p>
            ) : null}
            {canShare ? (
              <>
                <form
                  className="flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const to = email.trim();
                    if (!to) return;
                    try {
                      const r = await actions.grant(to, role);
                      toast.show(r.status === "invited" ? `Invitation sent to ${to}. They get access once they sign up and accept.` : "Shared", { tone: "success" });
                      setEmail("");
                    } catch (err) {
                      toast.show(errorMessage(err), { tone: "error" });
                    }
                  }}
                >
                  <label className="sr-only" htmlFor="share-email">
                    Email address
                  </label>
                  <input id="share-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="h-9 min-w-0 flex-1 ui-input rounded-chip px-3" />
                  <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-9 flex-none ui-input rounded-chip px-3">
                    <option value="viewer">Can view</option>
                    <option value="commenter">Can comment</option>
                    <option value="editor">Can edit</option>
                  </Select>
                  <Button type="submit" variant="primary">
                    Share
                  </Button>
                </form>
                <p className="flex items-center gap-1.5 text-footnote text-muted">
                  <span className="min-w-0 truncate">{personal ? "Anyone with an email address." : "People outside the workspace join as guests."}</span>
                  <InfoTip text={sealed ? `${peopleNote} ${e2eeCopy.share.invite}` : peopleNote} />
                </p>
              </>
            ) : null}
            {data.people.length === 0 ? (
              <p className="text-muted">{data.youAreGuest ? (folderAccess?.folders.length ? "Shared with you through its folder." : "Shared with you through a page above it.") : "No one added directly."}</p>
            ) : (
              <ul aria-label="People with access" className="-mx-2">
                {data.people.map((p) => (
                  <li key={p.profileId} className="flex items-center gap-3 rounded-chip px-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate font-medium">
                        <span className="truncate">{p.displayName}</span>
                        {p.isYou ? <span className="text-footnote font-normal text-muted">(you)</span> : null}
                        {p.guest ? <span className="flex-none rounded-chip border border-line px-1.5 py-px text-caption-2 font-medium text-muted">Guest</span> : null}
                      </span>
                      {p.email ? <span className="block truncate text-footnote text-muted">{p.email}</span> : null}
                    </span>
                    <span className="text-footnote text-muted">{roleText(p.role)}</span>
                    {p.canChange ? (
                      <IconButton label={`Remove ${p.displayName}`} onClick={() => void run(actions.revoke(p.profileId))} className="hover:text-danger">
                        <Trash2 size={14} aria-hidden />
                      </IconButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {data.pendingInvites.length ? (
              <div>
                <h4 className="flex items-center gap-1.5 text-footnote font-semibold uppercase tracking-[0.06em] text-faint">
                  Invited by email {sealed ? <InfoTip text={e2eeCopy.share.pendingPerson} /> : null}
                </h4>
                <ul className="-mx-2">
                  {data.pendingInvites.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-2 py-1">
                      <span className="min-w-0 flex-1 truncate">{i.email}</span>
                      <span className="text-footnote text-muted">
                        {roleText(i.role)} · {i.expired ? "expired" : "waiting to accept"}
                      </span>
                      <Button size="sm" variant="quiet" onClick={() => void run(actions.revokeInvite(i.id), "Invitation revoked")}>
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {folderAccess?.folders.length ? (
              <div>
                <h4 className="flex items-center gap-1.5 text-footnote font-semibold uppercase tracking-[0.06em] text-faint">
                  From folders <InfoTip text="Change this in the folder’s Share dialog. Moving the note out of the folder ends it." />
                </h4>
                <ul className="-mx-2" aria-label="Access from folders" data-testid="share-from-folders">
                  {folderAccess.folders.flatMap((f) =>
                    f.people.map((p) => (
                      <li key={`${f.id}:${p.profileId}`} className="flex items-center gap-3 px-2 py-1">
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 truncate font-medium">
                            <span className="truncate">{p.displayName}</span>
                            {p.isYou ? <span className="text-footnote font-normal text-muted">(you)</span> : null}
                            {p.guest ? <span className="flex-none rounded-chip border border-line px-1.5 py-px text-caption-2 font-medium text-muted">Guest</span> : null}
                          </span>
                          <span className="block truncate text-footnote text-muted">Through the folder {f.name || "Untitled"}</span>
                        </span>
                        <span className="text-footnote text-muted">{roleLabel(p.role)}</span>
                      </li>
                    )),
                  )}
                </ul>
              </div>
            ) : null}
          </section>

          <div className="flex items-center gap-3">
            <span className="w-14 flex-none font-medium">Access</span>
            {personal ? (
              <span className="flex min-w-0 items-center gap-1.5 text-muted">
                <Lock size={15} aria-hidden className="flex-none" />
                <span className="truncate">Only the owner and people added here</span>
                <InfoTip text="This page is in a Personal space: only its owner and the people added here can open it." />
              </span>
            ) : (
              <Select
                aria-label="Access"
                value={data.accessMode}
                disabled={!canManage}
                onChange={(e) => void run(actions.setMode(e.target.value as "workspace" | "restricted"))}
                leading={data.accessMode === "restricted" ? <Lock size={15} aria-hidden className="flex-none text-muted" /> : <Users size={15} aria-hidden className="flex-none text-muted" />}
                className="h-9 min-w-0 flex-1 ui-input rounded-chip px-3"
              >
                <option value="workspace" data-description="Everyone in this workspace, by their role">
                  Workspace
                </option>
                <option value="restricted" data-description="Owners, admins, the creator and people added here">
                  Only invited people
                </option>
              </Select>
            )}
          </div>
          {folderAccess?.reason === "restricted" ? <p className="-mt-2 pl-[4.25rem] text-footnote text-muted">People its folder is shared with don’t see this page.</p> : null}

          {canManage ? (
            <section aria-label="Public link" className="space-y-2 border-t border-line pt-4">
              <div className="flex items-center gap-2">
                <Globe size={15} aria-hidden className="flex-none" />
                <span className="font-semibold">Public link</span>
                <InfoTip text={sealed ? e2eeCopy.share.encryptedLink : PUBLIC_LINK_INFO} />
                <span className="flex-1" />
                <Switch checked={linkOn} disabled={busy || (!linkOn && !data.publicLinksAvailable)} label="Public link" onChange={(on) => void (on ? makeLink() : stopLinks())} />
              </div>
              {!data.publicLinksAvailable ? <p className="pl-6 text-footnote text-warning">Public links are temporarily turned off for Folevi.</p> : null}
              {!linkOn ? <p className="pl-6 text-footnote text-muted">Off: only the people with access can open it.</p> : null}
              {links.map((l) => {
                const url = freshFor(l);
                return (
                  <div key={l.id} className="pl-6">
                    <div className="flex items-center gap-2">
                      {url ? (
                        <input readOnly value={url} aria-label="Public link address" className="h-8 min-w-0 flex-1 ui-well rounded-chip px-2 font-mono text-footnote" onFocus={(e) => e.target.select()} />
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-mono text-footnote" title="The whole link is shown once, when it’s made.">
                          {MARKETING_HOST}/s/{l.tokenHint}••••••••
                        </span>
                      )}
                      {url ? (
                        <Button size="sm" onClick={() => copyText(url)}>
                          <Copy size={13} aria-hidden /> Copy
                        </Button>
                      ) : null}
                      <Button size="sm" variant="quiet" className="text-danger" onClick={() => void run(actions.revokeLink(l.id), "Link revoked")}>
                        Revoke
                      </Button>
                    </div>
                    <p className="mt-0.5 text-footnote text-muted">
                      {url ? (
                        <span className="font-medium text-success" title={sealed ? e2eeCopy.share.copyWhole : undefined}>
                          {sealed ? "Copy the whole link now: it isn’t shown again. " : "Copy it now: it isn’t shown again. "}
                        </span>
                      ) : null}
                      {expiryText(l)}
                      {l.hasPassword ? " · Password" : ""}
                      {l.allowIndexing ? " · Search engines can find it" : ""} · {l.viewCount} view{l.viewCount === 1 ? "" : "s"}
                    </p>
                  </div>
                );
              })}
              <div className="pl-6">
                <button
                  type="button"
                  aria-expanded={settingsOpen}
                  aria-controls="share-link-settings"
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  className="-ml-1.5 flex max-w-full items-center gap-1 rounded-chip px-1.5 py-1 text-footnote text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-ink"
                >
                  <ChevronRight size={13} aria-hidden className={`flex-none transition-transform duration-150 ${settingsOpen ? "rotate-90" : ""}`} />
                  <span className="font-medium">Link settings</span>
                  <span className="truncate text-faint">({settingsSummary})</span>
                </button>
                {settingsOpen ? (
                  <div id="share-link-settings" className="mt-1.5 space-y-3 rounded-control bg-[color-mix(in_oklab,var(--color-ink)_4%,transparent)] p-3">
                    {linkOn ? (
                      <>
                        {links.map((l) => (
                          <div key={l.id} className="grid items-center gap-x-3 gap-y-2 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
                            {links.length > 1 ? <span className="col-span-full font-mono text-footnote text-muted">…/s/{l.tokenHint}</span> : null}
                            <span className="font-medium text-ink">Look</span>
                            <LookSelect label={`Look of the link …/s/${l.tokenHint}`} value={publishTheme(l.theme)} onChange={(theme) => void run(actions.setLinkTheme(l.id, theme), "Look changed")} />
                            {!sealed ? (
                              <>
                                <span className="font-medium text-ink">Foli DNA</span>
                                <span className="flex items-center gap-2">
                                  <Switch
                                    checked={(l as { showDna?: boolean }).showDna === true}
                                    label="Show the note’s Foli DNA on the page"
                                    onChange={(on) => void run(actions.setLinkDna(l.id, on), on ? "The page shows its Foli DNA" : "Foli DNA hidden on the page")}
                                  />
                                  <span className="text-footnote text-muted">Show it on the page</span>
                                </span>
                              </>
                            ) : null}
                            <span className="font-medium text-ink">Expires</span>
                            <span className="flex items-center gap-1.5 text-muted">
                              {expiryText(l)}
                              {l.hasPassword ? " · Password" : ""}
                              <InfoTip text="Set when the link is made. To change them, revoke it and make a new one." />
                            </span>
                          </div>
                        ))}
                        {another ? (
                          <div className="space-y-3 border-t border-line pt-3">{newLinkFields}</div>
                        ) : (
                          <Button size="sm" variant="quiet" className="-ml-2" disabled={!data.publicLinksAvailable} onClick={() => setAnother(true)}>
                            New link…
                          </Button>
                        )}
                      </>
                    ) : (
                      newLinkFields
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {canManage && sealed ? (
            <section aria-label={e2eeCopy.publish.row} className="space-y-2 border-t border-line pt-4">
              <h3 className="flex items-center gap-2 font-semibold">
                <Globe size={15} aria-hidden /> {e2eeCopy.publish.row}
              </h3>
              {data.links
                .filter((l) => (l as { plainCopy?: boolean }).plainCopy)
                .map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center gap-2 pl-6">
                    <span className="min-w-0 flex-1 text-footnote text-muted">{e2eeCopy.publish.publishedFrom(formatDateTime((l as { publishedAt?: number }).publishedAt ?? l.createdAt))}</span>
                    <Button size="sm" variant="quiet" onClick={() => void run(actions.updatePlainCopy(l.id), e2eeCopy.publish.updated)}>
                      {e2eeCopy.publish.update}
                    </Button>
                    <Button size="sm" variant="quiet" className="text-danger" onClick={() => void run(actions.unpublish(l.id), e2eeCopy.publish.stopped)}>
                      {e2eeCopy.publish.stop}
                    </Button>
                  </div>
                ))}
              {published ? (
                <div className="flex gap-2 pl-6">
                  <input readOnly value={published} aria-label={e2eeCopy.publish.row} className="h-8 min-w-0 flex-1 ui-well rounded-chip px-2 font-mono text-footnote" onFocus={(e) => e.target.select()} />
                  <Button size="sm" onClick={() => copyText(published)}>
                    <Copy size={13} aria-hidden /> Copy
                  </Button>
                </div>
              ) : null}
              <div className="pl-6">
                <Button size="sm" onClick={() => setPublishing(true)}>
                  {e2eeCopy.publish.rowButton}
                </Button>
              </div>
              <PublishCopyDialog open={publishing} onClose={() => setPublishing(false)} documentId={documentId} onPublished={setPublished} />
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

/** The public page's look: Folevi's dropdown, each look with its one-line description. */
function LookSelect({ value, onChange, label, labelledBy }: { value: PublishTheme; onChange: (t: PublishTheme) => void; label?: string; labelledBy?: string }) {
  return (
    <Select aria-label={label} aria-labelledby={labelledBy} value={value} onChange={(e) => onChange(e.target.value as PublishTheme)} className="h-9 w-full ui-input rounded-chip px-3">
      {PUBLISH_THEMES.map((t) => (
        <option key={t.id} value={t.id} data-description={t.hint}>
          {t.name}
        </option>
      ))}
    </Select>
  );
}
