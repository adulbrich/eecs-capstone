import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils.ts";

/**
 * The shared vocabulary for the audience-gated panels on the project and
 * inventory detail pages. Before this existed the four panels had four
 * different heading treatments (`island-kicker`, `h2.font-medium.text-sm`,
 * `h3.font-medium.text-sm` and `p.uppercase.text-xs`) and two different ways
 * of separating their sections. Routing every panel through these primitives
 * is what keeps a fifth from appearing.
 *
 * Tone separates two stacked regions rather than naming an audience: a staff
 * viewer renders both on the project page and on the item page, so identical
 * borders would read as one region. `staff` is brand-tinted, `private` is
 * neutral. The audience itself is stated by each panel's own PanelNote, and
 * it differs: a project's private panel is shared with the proposer, while an
 * item has no proposer and its private panel is staff-only.
 */
const TONE_CLASS = {
  private: "border border-border bg-(--surface-sunken)",
  staff: "border-2 border-(--brand-primary-tint) bg-card",
} as const;

export type PanelTone = keyof typeof TONE_CLASS;

export function Panel({
  children,
  tone,
}: {
  children: ReactNode;
  tone: PanelTone;
}) {
  return (
    <div className={cn("mt-8 rounded-lg p-4", TONE_CLASS[tone])}>
      {children}
    </div>
  );
}

/**
 * The panel's own title. An `h2` so the page outline stays navigable and the
 * `h3`s in `PanelSection` have a parent, styled as a kicker so it reads as a
 * label for the region rather than competing with the page's section headings.
 */
export function PanelHeader({
  actions,
  title,
}: {
  actions?: ReactNode;
  title: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="island-kicker">{title}</h2>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** Who can see this panel, stated once at the top rather than per section. */
export function PanelNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-muted-foreground text-xs">
      <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function PanelSection({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title: string;
  tone?: "danger";
}) {
  const danger = tone === "danger";
  return (
    <section
      className={cn(
        "mt-5 border-t pt-4",
        danger ? "border-destructive/30" : "border-border"
      )}
    >
      <h3 className={cn("font-medium text-sm", danger && "text-destructive")}>
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}
