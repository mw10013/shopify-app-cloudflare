/**
 * The admin pages' read-only values: labelled fields in a grid, and instants in the viewer's time.
 *
 * @module
 */

import { useHydrated } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import type { ReactNode } from "react";

/**
 * An instant as a `<time>`, `—` when there is none. The server and the hydrating render show its
 * UTC ISO text, so their markup matches; after hydration it reads in the viewer's zone and locale.
 */
export function Instant({ value }: { readonly value: DateTime.Utc | null }) {
  const hydrated = useHydrated();
  if (value === null) return "—";
  const iso = DateTime.formatIso(value);
  return (
    <time dateTime={iso} title={iso}>
      {hydrated ? DateTime.formatLocal(value, { dateStyle: "medium", timeStyle: "medium" }) : iso}
    </time>
  );
}

/** One labelled value of a {@link Fields} grid. */
export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <s-stack gap="small-300">
      <s-text color="subdued">{label}</s-text>
      {children}
    </s-stack>
  );
}

/** A grid of {@link Field}s that wraps to the page's width. */
export function Fields({ children }: { readonly children: ReactNode }) {
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
      {children}
    </s-grid>
  );
}
