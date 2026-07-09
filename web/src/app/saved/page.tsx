"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Pagination } from "@/components/Pagination";
import { PostCard } from "@/components/PostCard";
import { useRemovePost, useSavedList, useToggleSave } from "@/lib/queries";
import { useCurrentUser } from "@/lib/user-context";

export default function SavedPage() {
  const { currentUser } = useCurrentUser();
  const t = useTranslations("savedList");
  const tErrors = useTranslations("errors");
  const [page, setPage] = useState(1);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // No single course is in view here, so pass null: the mutation still
  // optimistically patches every cached feed page that holds this post (see
  // useToggleSave), it just won't force an extra feed refetch on settle.
  const toggleSave = useToggleSave(null);
  const removePost = useRemovePost();
  const savedQuery = useSavedList(page, !!currentUser);

  if (!currentUser) return null;

  const items = savedQuery.data?.items ?? [];

  return (
    <AppShell>
      <div className="space-y-4">
        <h2 className="font-display text-xl text-ink">{t("title")}</h2>

        {mutationError && <ErrorBanner message={mutationError} onDismiss={() => setMutationError(null)} />}

        {savedQuery.isLoading && <p className="text-sm text-ink-soft">{t("loading")}</p>}

        {savedQuery.isError && <ErrorBanner message={tErrors("generic")} />}

        {savedQuery.data && items.length === 0 && (
          <div className="rounded-md border border-dashed border-rule bg-surface/60 p-8 text-center">
            <p className="font-display text-lg text-ink">{t("emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">{t("emptyBody")}</p>
            <Link
              href="/feed"
              className="mt-4 inline-block rounded-sm bg-teal px-4 py-2 font-stamp text-xs uppercase tracking-wide text-white hover:bg-teal-deep"
            >
              {t("goToFeed")}
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {items.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              savedAt={post.savedAt}
              isModerator={currentUser.role === "moderator"}
              onToggleSave={() =>
                toggleSave.mutate(
                  { postId: post.id, nextHasSaved: !post.hasSaved },
                  { onError: () => setMutationError(tErrors("generic")) },
                )
              }
              onRemove={() =>
                removePost.mutate(post.id, { onError: () => setMutationError(tErrors("generic")) })
              }
              saveMutationPending={toggleSave.isPending && toggleSave.variables?.postId === post.id}
              removePending={removePost.isPending && removePost.variables === post.id}
            />
          ))}
        </div>

        {savedQuery.data && (
          <Pagination
            page={savedQuery.data.page}
            limit={savedQuery.data.limit}
            totalCount={savedQuery.data.totalCount}
            hasMore={savedQuery.data.hasMore}
            onPageChange={setPage}
          />
        )}
      </div>
    </AppShell>
  );
}
