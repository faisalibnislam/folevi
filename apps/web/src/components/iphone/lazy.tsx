"use client";

// The phone interface's screens (./phone.ts) on demand: they load when a window first shows the phone layout (any
// window under 700 px, lib/iphone.ts), and wider windows never download them. A page that opens narrow starts the
// download at once, alongside the rest of the start; once it's here, every screen renders synchronously (no
// placeholder frame), the way RouteView renders the note page (lib/app/noteView.ts).
import { lazy, Suspense, type ComponentType } from "react";
import { isIphoneApp } from "@/lib/iphone";

type PhoneModule = typeof import("./phone");

let loading: Promise<PhoneModule> | null = null;
let loaded: PhoneModule | null = null;

export function loadPhone(): Promise<PhoneModule> {
  loading ??= import("./phone").then(
    (m) => (loaded = m),
    (e: unknown) => {
      // A failed download (offline, a new deploy) may succeed on the next try.
      loading = null;
      throw e;
    },
  );
  return loading;
}

/** Whether the phone screens' code is here. */
export const phoneLoaded = () => loaded !== null;

if (typeof window !== "undefined" && isIphoneApp()) void loadPhone();

// Each screen keeps its own props (and generics) through the cast in phone().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>;
type Components = { [K in keyof PhoneModule as PhoneModule[K] extends ComponentType<never> ? K : never]: PhoneModule[K] };

/**
 * A phone screen by name, from ./phone.ts. `entry`: where the phone interface starts (its shell, and the sheets the
 * app draws outside it): shows nothing, inside its own boundary, for the moment the code takes to arrive the first
 * time a window turns narrow. Every other screen only renders inside the phone shell, so its code is already here
 * and it renders synchronously, without a boundary of its own (the views' own placeholders stay as they were).
 */
function phone<K extends keyof Components>(name: K, entry = false): Components[K] {
  const Lazy = lazy(() => {
    if (loaded) {
      const ready = { default: loaded[name] as ComponentType<Props> };
      return { then: (resolve: (m: typeof ready) => void) => resolve(ready) } as unknown as Promise<typeof ready>;
    }
    return loadPhone().then((m) => ({ default: m[name] as ComponentType<Props> }));
  });
  // Always the same tree (a boundary, then the lazy screen), so the screen keeps its state when its code arrives.
  function Phone(props: Props) {
    if (!entry) return <Lazy {...props} />;
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  Phone.displayName = `Phone(${String(name)})`;
  return Phone as unknown as Components[K];
}

export const IphoneShell = phone("IphoneShell", true);
export const IphoneScreen = phone("IphoneScreen");
export const IphoneHome = phone("IphoneHome");
export const IphoneNoteList = phone("IphoneNoteList");
export const IphoneTasks = phone("IphoneTasks");
export const IphoneTaskSheet = phone("IphoneTaskSheet");
export const IphoneAgenda = phone("IphoneAgenda");
export const RootAvatar = phone("RootAvatar");
export const RootPill = phone("RootPill");
export const IphoneFolders = phone("IphoneFolders");
export const IphoneTags = phone("IphoneTags");
export const PhoneQuickAdd = phone("PhoneQuickAdd", true);
export const IphoneScopes = phone("IphoneScopes", true);
export const NoteBars = phone("NoteBars");
export const NotePlaceChip = phone("NotePlaceChip");
export const NoteSyncTrailing = phone("NoteSyncTrailing");
export const NoteTrailing = phone("NoteTrailing");
export const ToolSheet = phone("ToolSheet");
