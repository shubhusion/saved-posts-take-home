"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

/**
 * Signature element: a ribbon tab folded like a catalog-card bookmark,
 * rendered with a single clip-path shape. `bg-current` picks up whatever
 * text color is active, so the fill and the color state share one class
 * list instead of two. Saving plays a small stamp-in animation — like
 * pressing a due-date stamp — respecting prefers-reduced-motion globally.
 */
export function BookmarkToggle({
  hasSaved,
  onToggle,
  pending,
}: {
  hasSaved: boolean;
  onToggle: () => void;
  pending: boolean;
}) {
  const t = useTranslations("post");

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-pressed={hasSaved}
      aria-label={hasSaved ? t("saved") : t("save")}
      title={hasSaved ? t("saved") : t("save")}
      className={cn(
        "relative h-10 w-8 shrink-0 transition-colors disabled:opacity-50",
        hasSaved ? "text-brass animate-stamp-in" : "text-ink-faint hover:text-brass-deep",
      )}
      style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 76%, 0 100%)" }}
    >
      <span className={cn("absolute inset-0", hasSaved ? "bg-current" : "bg-current opacity-25")} />
      <span
        className={cn(
          "absolute inset-0 border-l-2 border-r-2 border-t-2",
          hasSaved ? "border-brass-deep" : "border-ink-faint",
        )}
        style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 76%, 0 100%)" }}
      />
    </button>
  );
}
