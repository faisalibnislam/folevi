// Hunspell, the checker LibreOffice, Firefox and Chrome use, run as WebAssembly: the same checker in every
// Folevi app, offline, for every language Folevi has a dictionary for (lib/spelling/languages.ts). Unlike the
// small English-only reader it replaces, Hunspell understands every dictionary's rules (German compounds,
// Arabic's prefixes and suffixes, French elision), and it keeps a dictionary in a few MB.
//
// Kept free of the page so it runs in the spelling worker (spellWorker.ts) and in unit tests: the WebAssembly
// binary is handed in (`wasm`), and so is each dictionary's text.
import createModule from "./vendor/hunspell.mjs";

/** The emscripten module's parts this file uses. */
interface HunspellModule {
  FS: { writeFile(path: string, data: string): void; unlink(path: string): void };
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _Hunspell_create(aff: number, dic: number): number;
  _Hunspell_destroy(handle: number): void;
  _Hunspell_spell(handle: number, word: number): number;
  _Hunspell_suggest(handle: number, list: number, word: number): number;
  _Hunspell_free_list(handle: number, list: number, count: number): void;
  _Hunspell_add(handle: number, word: number): number;
  _Hunspell_remove(handle: number, word: number): number;
}

export interface Hunspell {
  /** Whether `word` is in the dictionary (or a form its rules allow). */
  spell(word: string): boolean;
  /** Hunspell's guesses for `word`, the likeliest first. */
  suggest(word: string): string[];
  /** Accepts `word` from now on (this instance only). */
  add(word: string): void;
  remove(word: string): void;
  dispose(): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let modulePromise: Promise<HunspellModule> | null = null;

/** The WebAssembly module, made once per worker. */
export function loadHunspellModule(wasm: ArrayBuffer | Uint8Array): Promise<HunspellModule> {
  modulePromise ??= (createModule as (arg: object) => Promise<HunspellModule>)({
    wasmBinary: wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm),
    print: () => {},
    printErr: () => {},
  }).catch((e: unknown) => {
    modulePromise = null;
    throw e;
  });
  return modulePromise;
}

let fileNo = 0;

/** A checker for one dictionary: `aff` and `dic` are the two files' text (UTF-8 dictionaries). */
export function createHunspell(m: HunspellModule, aff: string, dic: string): Hunspell {
  const alloc = (s: string): number => {
    const bytes = encoder.encode(s);
    const p = m._malloc(bytes.length + 1);
    m.HEAPU8.set(bytes, p);
    m.HEAPU8[p + bytes.length] = 0;
    return p;
  };
  const read = (p: number): string => {
    let end = p;
    while (m.HEAPU8[end] !== 0) end++;
    return decoder.decode(m.HEAPU8.subarray(p, end));
  };
  const id = `d${++fileNo}`;
  m.FS.writeFile(`${id}.aff`, aff);
  m.FS.writeFile(`${id}.dic`, dic);
  const affP = alloc(`${id}.aff`);
  const dicP = alloc(`${id}.dic`);
  const handle = m._Hunspell_create(affP, dicP);
  m._free(affP);
  m._free(dicP);
  m.FS.unlink(`${id}.aff`);
  m.FS.unlink(`${id}.dic`);
  if (!handle) throw new Error("hunspell: the dictionary didn't load");
  let gone = false;
  const withWord = <T>(word: string, run: (p: number) => T): T => {
    if (gone) throw new Error("hunspell: disposed");
    const p = alloc(word);
    try {
      return run(p);
    } finally {
      m._free(p);
    }
  };
  return {
    spell: (word) => withWord(word, (p) => m._Hunspell_spell(handle, p) !== 0),
    suggest: (word) =>
      withWord(word, (p) => {
        const listP = m._malloc(4);
        try {
          const n = m._Hunspell_suggest(handle, listP, p);
          const list = m.HEAPU32[listP >>> 2]!;
          if (n <= 0 || !list) return [];
          const out: string[] = [];
          for (let i = 0; i < n; i++) out.push(read(m.HEAPU32[(list >>> 2) + i]!));
          m._Hunspell_free_list(handle, listP, n);
          return out;
        } finally {
          m._free(listP);
        }
      }),
    add: (word) => void withWord(word, (p) => m._Hunspell_add(handle, p)),
    remove: (word) => void withWord(word, (p) => m._Hunspell_remove(handle, p)),
    dispose: () => {
      if (gone) return;
      gone = true;
      m._Hunspell_destroy(handle);
    },
  };
}
