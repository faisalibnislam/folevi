// Devices on the fake providers: each gets its own fetch (and faults), tokens, device copy and LocalFs, wired
// exactly as the hosts wire the real ones (connection.ts), minus the browser sign-in.
import { DropboxFs, type DropboxFsOptions } from "../src/dropbox";
import { DriveFs, driveClassifier, type DriveFsOptions } from "../src/drive";
import { RetryingHttp } from "../src/http";
import { MemoryMirror } from "../src/mirror";
import { AuthedHttp, DropboxOAuth, GoogleOAuth, MemoryTokenStore, TokenManager, type TokenSet } from "../src/oauth";
import type { LocalFs } from "../src/types";
import { FaultInjector, seeded } from "./fakeCommon";
import { apiFaults, FakeDropbox, type ProviderSimCloud } from "./fakeDropbox";
import { FakeDrive } from "./fakeDrive";

export const noSleep = async () => undefined;

export interface Device<F> {
  fs: F;
  tokens: TokenManager;
  store: MemoryTokenStore;
  mirror: MemoryMirror;
  injector: FaultInjector;
  http: RetryingHttp;
}

function tokensFrom(issued: { access_token: string; refresh_token: string; expires_in: number }, now: number): TokenSet {
  return { accessToken: issued.access_token, refreshToken: issued.refresh_token, expiresAt: now + issued.expires_in * 1000 };
}

export function dropboxDevice(fake: FakeDropbox, options: DropboxFsOptions & { seed?: number; mirror?: MemoryMirror; now?: () => number } = {}): Device<DropboxFs> {
  const now = options.now ?? Date.now;
  const injector = new FaultInjector(seeded(options.seed ?? Math.floor(fake.random() * 2 ** 31)));
  const http = new RetryingHttp(fake.fetchFor(injector), { sleep: noSleep, random: fake.random });
  const store = new MemoryTokenStore();
  const tokens = new TokenManager(new DropboxOAuth(fake.oauth.clientId, http, now), store, now);
  void tokens.set(tokensFrom(fake.oauth.issue(), now()));
  const mirror = options.mirror ?? new MemoryMirror();
  const fs = new DropboxFs(new AuthedHttp(http, tokens), http, mirror, { sleep: noSleep, now, ...options });
  return { fs, tokens, store, mirror, injector, http };
}

export function driveDevice(fake: FakeDrive, options: DriveFsOptions & { seed?: number; mirror?: MemoryMirror; now?: () => number } = {}): Device<DriveFs> {
  const now = options.now ?? Date.now;
  const injector = new FaultInjector(seeded(options.seed ?? Math.floor(fake.random() * 2 ** 31)));
  const http = new RetryingHttp(fake.fetchFor(injector), { sleep: noSleep, random: fake.random }, driveClassifier);
  const store = new MemoryTokenStore();
  const tokens = new TokenManager(new GoogleOAuth(fake.oauth.clientId, http, now), store, now);
  void tokens.set(tokensFrom(fake.oauth.issue(), now()));
  const mirror = options.mirror ?? new MemoryMirror();
  const fs = new DriveFs(new AuthedHttp(http, tokens), mirror, { sleep: noSleep, now, ...options });
  return { fs, tokens, store, mirror, injector, http };
}

/** Small thresholds, so notes go through upload sessions and resumable uploads in property runs. */
export const SMALL_UPLOADS = { dropbox: { singleUploadMax: 1500, chunkSize: 700 }, drive: { simpleUploadMax: 1500, chunkSize: 1024 } };

/** packages/local-store/test/sim.ts's SimCloud over a fake provider. */
export class FakeProviderCloud implements ProviderSimCloud {
  private faultRates = { delay: 0, duplicate: 0, stale: 0, truncate: 0, loseUpdate: 0 };
  readonly devices: Device<LocalFs>[] = [];
  /** What the devices' LocalFs logged (Drive's lost-revision notices, cursor resets). */
  readonly messages: string[] = [];
  constructor(
    readonly fake: FakeDropbox | FakeDrive,
    private readonly makeDevice: (name: string, log: (m: string) => void) => Device<LocalFs>,
  ) {}
  static dropbox(seed: number, accessTtlMs = 70_000, clock = { now: 0 }): FakeProviderCloud {
    const now = () => (clock.now += 50);
    const fake = new FakeDropbox({ seed, accessTtlMs, now, pageSize: 7 });
    return new FakeProviderCloud(fake, (_name, log) => dropboxDevice(fake, { ...SMALL_UPLOADS.dropbox, now, log }) as Device<LocalFs>);
  }
  static drive(seed: number, accessTtlMs = 70_000, clock = { now: 0 }, yields = 0): FakeProviderCloud {
    const now = () => (clock.now += 50);
    const fake = new FakeDrive({ seed, accessTtlMs, now, pageSize: 7, chunkMultiple: 1024, yields });
    return new FakeProviderCloud(fake, (_name, log) => driveDevice(fake, { ...SMALL_UPLOADS.drive, now, log }) as Device<LocalFs>);
  }
  mount(name: string): LocalFs {
    const d = this.makeDevice(name, (m) => this.messages.push(`${name}: ${m}`));
    this.devices.push(d);
    return d.fs;
  }
  /**
   * Faults were on during this round: a device may have hit a cut-off download or a lagging listing that
   * only its next sync retries (Library health shows it meanwhile). FaultyCloud queues those as pending
   * deliveries; here they count as one pending event, so the simulation syncs once more without faults.
   */
  private faultyRound = false;
  settle(): void {
    this.faultyRound = false;
    this.fake.settle();
  }
  step(): boolean {
    return this.fake.step();
  }
  get pending(): number {
    return this.fake.pending + (this.faultyRound ? 1 : 0);
  }
  get faults() {
    return this.faultRates;
  }
  set faults(f) {
    this.faultRates = f;
    this.faultyRound = Object.values(f).some((v) => v > 0);
    this.fake.faults = apiFaults(f);
  }
  cloudFile(path: string): Uint8Array | undefined {
    return this.fake.file(path);
  }
  cloudPaths(): string[] {
    return this.fake.paths();
  }
  get log(): string[] {
    return this.fake.log;
  }
}
