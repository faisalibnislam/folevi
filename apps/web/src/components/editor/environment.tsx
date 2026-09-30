"use client";

import { createContext, useContext } from "react";

/**
 * Where the editor runs. In the app it has an account behind it (the default). The site's editable demo
 * note has none: nothing is saved, and the parts that need an account (sub-pages, links to other pages,
 * uploads, collections, comments, AI) ask the visitor to sign up instead of reaching the server.
 */
export type EditorEnvironment = {
  demo: boolean;
  /** Called instead of a feature that needs an account, with a short name for it ("Sub-pages"). */
  unavailable: (feature: string) => void;
};

const EditorEnvironmentContext = createContext<EditorEnvironment>({ demo: false, unavailable: () => undefined });

export const EditorEnvironmentProvider = EditorEnvironmentContext.Provider;
export const useEditorEnvironment = () => useContext(EditorEnvironmentContext);
