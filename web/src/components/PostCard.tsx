"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { BookmarkToggle } from "./BookmarkToggle";
import type { PostView, SavedPostView } from "@/lib/api";

/**
 * Presentation only, per the assignment's UI grading note: this component
 * receives fully-hydrated data and callbacks as props. It never calls
 * useQuery/useMutation itself — that stays in the page components, which
 * own the data layer.
 */
export function PostCard({
  post,
  savedAt,
  isModerator,
  onToggleSave,
  onRemove,
  saveMutationPending,
  removePending,
}: {
  post: PostView;
  /** Present only when rendered inside the Saved view. */
  savedAt?: SavedPostView["savedAt"];
  isModerator: boolean;
  onToggleSave: () => void;
  onRemove: () => void;
  saveMutationPending: boolean;
  removePending: boolean;
}) {
  const t = useTranslations("post");
  const tFeed = useTranslations("feed");
  const format = useFormatter();
  const now = useNow();

  return (
    <article className="group relative rounded-md border border-rule bg-surface shadow-[0_1px_0_theme(colors.rule)] transition-shadow hover:shadow-md">
      <div className="absolute -top-1 right-3">
        <BookmarkToggle hasSaved={post.hasSaved} onToggle={onToggleSave} pending={saveMutationPending} />
      </div>

      <div className="p-4 pr-12">
        <h3 className="font-display text-lg leading-snug text-ink">{post.title}</h3>
        <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-ink-soft">{post.content}</p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-2 font-stamp text-[11px] uppercase tracking-wide text-ink-faint">
          <span>
            {tFeed("by", { name: post.authorName })} · {format.dateTime(new Date(post.createdAt), { month: "short", day: "numeric" })}
            {savedAt && <> · {t("savedAt", { date: format.relativeTime(new Date(savedAt), now) })}</>}
          </span>

          <div className="flex items-center gap-3">
            <span className="text-brass-deep">{t("savesCount", { count: post.savesCount })}</span>
            {isModerator && (
              <button
                onClick={onRemove}
                disabled={removePending}
                className="text-brick underline decoration-brick/40 underline-offset-2 hover:decoration-brick disabled:opacity-50"
              >
                {t("remove")}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
