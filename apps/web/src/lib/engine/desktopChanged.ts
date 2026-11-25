// The Mac app's settings changed (Settings > Desktop app, lib/engine/viewsSettings.ts): DesktopCapabilities' Spotlight
// feed looks again when they do. On its own so the app's first screen can listen without loading the settings views,
// which bring local mode's backend, importing and migration (docs/perf/web-results.md).
import { Emitter } from "./live";

export const desktopChanged = new Emitter();
