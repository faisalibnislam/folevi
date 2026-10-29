// Folevi's one version (version.json at the repo root, written only by `node scripts/version.mjs release`, with
// CHANGELOG.json): MAJOR.UPDATE.PATCH as #.#.##, "1.0.00" on the website and in every app, shown as
// "Folevi 1.0.00", never with a build number.
import info from "../../../../version.json";

export const FOLEVI_VERSION: string = info.version;

/** What a version looks like wherever it's shown. */
export const versionLabel = (version: string = FOLEVI_VERSION) => `Folevi ${version}`;
