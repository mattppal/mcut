"use client";

import * as React from "react";
import { spinners } from "unicode-animations";
import { cn } from "@/lib/utils";

/**
 * Foundation primitives shared across the editor panels. Small, composable
 * pieces only — anything with behavior or a single call site stays local to
 * its panel.
 */

export type SpinnerAnimation = keyof typeof spinners;

/**
 * The editor's signature loader: a unicode glyph animation instead of a
 * spinning icon. Inherits color and size from the surrounding text, so it
 * drops in anywhere an icon-sized loader would go. Honors
 * `prefers-reduced-motion` by holding the first frame.
 */
export function Spinner({
  animation = "braille",
  label = "Loading",
  className,
}: {
  animation?: SpinnerAnimation;
  label?: string;
  className?: string;
}) {
  const { frames, interval } = spinners[animation];
  const [frame, setFrame] = React.useState(0);

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, interval);
    return () => window.clearInterval(timer);
  }, [animation, frames.length, interval]);

  return (
    <span
      role="status"
      aria-label={label}
      data-slot="spinner"
      className={cn("inline-block font-mono leading-none select-none", className)}
    >
      {frames[frame % frames.length]}
    </span>
  );
}

/**
 * Centered placeholder for panels with nothing to show. `bordered` adds the
 * dashed outline used when the empty area is also a call to action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  bordered = false,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title?: React.ReactNode;
  description?: React.ReactNode;
  bordered?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 p-6 text-center",
        bordered && "rounded-lg border border-dashed",
        className,
      )}
    >
      {Icon ? <Icon className="size-5 text-muted-foreground" /> : null}
      {title ? <p className="text-xs font-medium">{title}</p> : null}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  );
}

/** A floating editor window on the chrome backdrop. */
export function PanelCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("h-full min-h-0 overflow-hidden rounded-xl bg-card shadow-xs", className)}>
      {children}
    </div>
  );
}

/** The compact action row pinned to the top of a panel. */
export function PanelHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-slot="panel-header" className={cn("flex h-8 shrink-0 items-center gap-1 px-2", className)}>
      {children}
    </div>
  );
}

/**
 * Class string for uppercase section labels inside panels. Exported separately
 * so interactive labels (e.g. collapsible triggers) can compose it onto a
 * button.
 */
export const panelSectionLabelClass =
  "text-2xs font-semibold tracking-wide text-muted-foreground uppercase";

/** Uppercase label for a section of panel content. */
export function PanelSectionLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h4 data-slot="panel-section-label" className={cn(panelSectionLabelClass, className)}>
      {children}
    </h4>
  );
}
