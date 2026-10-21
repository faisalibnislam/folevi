// Signed statements, FST1 (docs/E2EE_DESIGN.md §4.4):
//
//   signature = Ed25519(sk, utf8("folevi/e2ee/v1/statement\n" ‖ kind ‖ "\n") ‖ utf8(canonicalJson(body)))
//
// Stored as { kind, body, sig }: `body` is the canonical JSON string that was signed, `sig` is base64url.
import { canonicalJson } from "@folevi/editor-schema";
import { concatBytes, utf8 } from "../../bytes";
import { E2eeError, ed25519Sign, ed25519Verify, fromBase64Url, toBase64Url, type Ed25519KeyPair } from "./primitives";
import type { SignedStatement, StatementBodies, StatementKind } from "./wire";

export const STATEMENT_KINDS: readonly StatementKind[] = ["device", "space-grant", "note-grant", "account-key"];

function message(kind: StatementKind, body: string): Uint8Array {
  return concatBytes(utf8(`folevi/e2ee/v1/statement\n${kind}\n`), utf8(body));
}

export async function signStatement<K extends StatementKind>(
  key: Ed25519KeyPair["privateKey"],
  kind: K,
  body: StatementBodies[K] | object,
): Promise<SignedStatement<K>> {
  if (!STATEMENT_KINDS.includes(kind)) throw new E2eeError("Unknown statement kind.");
  const json = canonicalJson(body);
  return { kind, body: json, sig: toBase64Url(await ed25519Sign(key, message(kind, json))) };
}

/** True when `s.sig` is a valid signature by `pub` over `s.kind` and `s.body` exactly as stored. */
export async function verifyStatement(pub: Uint8Array, s: SignedStatement): Promise<boolean> {
  if (!s || typeof s.body !== "string" || typeof s.sig !== "string" || !STATEMENT_KINDS.includes(s.kind)) return false;
  let sig: Uint8Array;
  try {
    sig = fromBase64Url(s.sig);
  } catch {
    return false;
  }
  return ed25519Verify(pub, message(s.kind, s.body), sig);
}

/**
 * The body of a statement, after checking its signature and that the body is canonical JSON (so two
 * spellings of one body can't both verify). Null when anything is off.
 */
export async function openStatement<K extends StatementKind>(
  pub: Uint8Array,
  s: SignedStatement<K>,
): Promise<StatementBodies[K] | null> {
  if (!(await verifyStatement(pub, s))) return null;
  try {
    const body: unknown = JSON.parse(s.body);
    if (!body || typeof body !== "object" || Array.isArray(body) || canonicalJson(body) !== s.body) return null;
    return body as StatementBodies[K];
  } catch {
    return null;
  }
}
