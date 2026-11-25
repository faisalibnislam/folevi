// folevid's answers (docs/self-hosting/CONTRACT.md §5).

export interface ControlStatus {
  version: string;
  uptimeSeconds: number;
  publicUrl: string;
  services: { name: string; state: string; pid?: number | null; rssBytes?: number | null; restarts?: number }[];
  disk: { dataBytes: number; freeBytes: number };
  memory: { totalBytes: number; availableBytes: number };
}

export interface Backup {
  id: string;
  createdAt: number | string;
  sizeBytes: number;
  kind: "nightly" | "manual" | "pre-update";
}

export interface BackupTarget {
  kind: "local" | "folder" | "s3";
  path?: string;
  s3?: { endpoint: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey?: string; region: string };
}

export interface BackupList {
  backups: Backup[];
  schedule: { enabled: boolean; hour: number; keep: number; target: BackupTarget };
}

export interface RemoteState {
  publicUrl: string;
  connect: { state: "off" | "registered" | "linked"; serverId?: string; hostname?: string; lanHostnames?: string[] };
  upnp: { state: string; externalPort?: number };
  reachable?: boolean;
  relay: { enabled: boolean; connected: boolean };
  customDomain?: string;
}

export interface UpdateState {
  current: string;
  latest?: string;
  notesUrl?: string;
  channel: "stable" | "beta";
  managedBy: "store" | "apt" | "folevid";
}

/** A timestamp folevid may send as seconds, milliseconds or ISO text. */
export function toMillis(t: number | string): number {
  if (typeof t === "string") return Date.parse(t);
  return t < 1e12 ? t * 1000 : t;
}
