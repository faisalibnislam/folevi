// The admin Overview's warnings, in plain words: what's wrong, why it matters and what to do. Worked out from
// folevid's status, backups, remote access and update answers (docs/self-hosting/CONTRACT.md §5).
import { formatBytes } from "@/lib/format";
import { toMillis, type BackupList, type ControlStatus, type RemoteState, type UpdateState } from "./types";

export interface HealthNote {
  id: string;
  tone: "neutral" | "warning" | "danger";
  title: string;
  body: string;
  /** Where to fix it. */
  href?: string;
  action?: string;
}

const GB = 1024 ** 3;
const HOUR = 3_600_000;
const SERVICE_NAMES: Record<string, string> = { folevid: "the supervisor", backend: "the database", web: "the web app" };

export function healthNotes(input: { status?: ControlStatus; backups?: BackupList; remote?: RemoteState; update?: UpdateState; now?: number }): HealthNote[] {
  const { status, backups, remote, update } = input;
  const now = input.now ?? Date.now();
  const out: HealthNote[] = [];

  if (status) {
    const down = status.services.filter((s) => s.state !== "running" && s.state !== "starting");
    if (down.length) {
      out.push({
        id: "service-down",
        tone: "danger",
        title: `Part of Folevi isn't running: ${down.map((s) => SERVICE_NAMES[s.name] ?? s.name).join(" and ")}`,
        body: "Folevi restarts it by itself. If this message stays for more than a few minutes, look at the logs or restart Folevi from your NAS's app center.",
        href: "/admin/logs",
        action: "Open logs",
      });
    }
    const flapping = status.services.filter((s) => (s.restarts ?? 0) >= 3);
    if (!down.length && flapping.length) {
      out.push({
        id: "restarts",
        tone: "warning",
        title: "Folevi had to restart a few times",
        body: `${flapping.map((s) => SERVICE_NAMES[s.name] ?? s.name).join(" and ")} stopped and was started again ${Math.max(...flapping.map((s) => s.restarts ?? 0))} times. This often means the machine ran out of memory.`,
        href: "/admin/logs",
        action: "Open logs",
      });
    }

    const { totalBytes, availableBytes } = status.memory;
    const lowMemory = status.memory.low === true || (totalBytes > 0 && availableBytes / totalBytes < 0.1);
    if (lowMemory) {
      out.push({
        id: "memory-low",
        tone: "warning",
        title: "This machine is low on memory",
        body: `Only ${formatBytes(availableBytes)} of ${formatBytes(totalBytes)} is free, so Folevi may get slow or restart. Stop NAS apps and containers you don't use, or add memory if your NAS allows it.`,
      });
    } else if (status.memory.profile === "tiny" || (totalBytes > 0 && totalBytes <= 2.5 * GB)) {
      out.push({
        id: "memory-small",
        tone: "neutral",
        title: `Small-memory mode (${formatBytes(totalBytes)} of memory)`,
        body: "Folevi uses less memory on machines like this, which suits a family. Foli AI and big imports are a little slower. Keep other heavy apps on this NAS to a minimum.",
      });
    }

    const free = status.disk.freeBytes;
    const total = free + status.disk.dataBytes;
    if (free < 1 * GB || (total > 0 && free / total < 0.03)) {
      out.push({
        id: "disk-full",
        tone: "danger",
        title: "The disk is almost full",
        body: `${formatBytes(free)} is left. When it runs out, new notes, files and backups fail. Delete files you don't need on the NAS, keep fewer backups, or move backups to another folder.`,
        href: "/admin/backups",
        action: "Backups",
      });
    } else if (free < 5 * GB) {
      out.push({
        id: "disk-low",
        tone: "warning",
        title: "Disk space is getting low",
        body: `${formatBytes(free)} is left on the disk that holds Folevi's data. Free some room soon so backups keep working.`,
        href: "/admin/storage",
        action: "Storage",
      });
    }
  }

  if (backups) {
    const last = backups.backups.reduce<number | null>((m, b) => Math.max(m ?? 0, toMillis(b.createdAt)), null);
    const upFor = status ? status.uptimeSeconds * 1000 : 0;
    if (!backups.schedule.enabled) {
      out.push({ id: "backups-off", tone: "warning", title: "Nightly backups are off", body: "If this machine's disk fails, notes made since the last backup are lost. Turn nightly backups back on.", href: "/admin/backups", action: "Backups" });
    } else if (last === null ? upFor > 30 * HOUR : now - last > 36 * HOUR) {
      out.push({
        id: "backup-missed",
        tone: "warning",
        title: last === null ? "No backup yet" : "Last night's backup didn't happen",
        body: last === null ? "The first nightly backup should have run by now. Back up now, and check the logs if it fails." : "The newest backup is more than a day and a half old. Back up now, and look at the logs if it fails again.",
        href: "/admin/backups",
        action: "Back up now",
      });
    }
  }

  if (remote && remote.reachable === false) {
    out.push({
      id: "not-reachable",
      tone: "warning",
      title: "Not reachable from outside your home",
      body: "The apps work at home, but not on mobile data or other Wi-Fi. Turn on Folevi Relay, or let Folevi open a port on your router.",
      href: "/admin/remote",
      action: "Remote access",
    });
  }

  if (update?.latest && update.latest !== update.current) {
    out.push({
      id: "update",
      tone: "neutral",
      title: `Folevi Server ${update.latest} is available`,
      body: update.managedBy === "store" ? "Update it from your NAS's app center. Folevi backs up first." : update.managedBy === "apt" ? "It arrives with this machine's normal system updates." : "Folevi backs up first, and goes back if anything fails.",
      href: "/admin/updates",
      action: "See what's new",
    });
  }

  const order = { danger: 0, warning: 1, neutral: 2 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
