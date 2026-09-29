"use client";

import { createContext, useContext } from "react";

/**
 * The name of the record open on the page (a person, a workspace), shown as the open tab in the console's
 * tab strip. Pages set it through DocTitle; AdminShell provides it.
 */
export const AdminTitleContext = createContext<(title: string | null) => void>(() => {});

export function useAdminTitle(): (title: string | null) => void {
  return useContext(AdminTitleContext);
}
