"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CourseTabs } from "@/components/CourseTabs";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Pagination } from "@/components/Pagination";
import { PostCard } from "@/components/PostCard";
import { useCourseFeed, useMe, useRemovePost, useToggleSave } from "@/lib/queries";
import { useCurrentUser } from "@/lib/user-context";

/** Elysia/Eden errors carry an HTTP `status`; narrow without trusting the type. */
function isForbiddenError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: unknown }).status === 403;
}

export default function FeedPage() {
  const { currentUser } = useCurrentUser();
  const t = useTranslations("feed");
  const tErrors = useTranslations("errors");
  const [mutationError, setMutationError] = useState<string | null>(null);

  const meQuery = useMe(currentUser?.id ?? null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Default to the viewer's first accessible course once /me resolves; reset
  // to page 1 whenever the selected course changes.
  useEffect(() => {
    const first = meQuery.data?.courses[0]?.id ?? null;
    setCourseId((prev) => prev ?? first);
  }, [meQuery.data]);

  const feedQuery = useCourseFeed(courseId, page, !!currentUser && !!courseId);
  const toggleSave = useToggleSave(courseId);
  const removePost = useRemovePost();

  if (!currentUser) {
    return (
      <AppShell>
        <p className="rounded-md border border-dashed border-rule bg-surface/60 p-6 text-center text-sm text-ink-soft">
          {t("empty")}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        {meQuery.data && meQuery.data.courses.length > 0 && (
          <CourseTabs
            courses={meQuery.data.courses}
            activeCourseId={courseId}
            onSelect={(id) => {
              setCourseId(id);
              setPage(1);
            }}
          />
        )}

        {mutationError && <ErrorBanner message={mutationError} onDismiss={() => setMutationError(null)} />}

        {feedQuery.isLoading && <p className="text-sm text-ink-soft">{t("loading")}</p>}

        {feedQuery.isError && (
          <ErrorBanner message={isForbiddenError(feedQuery.error) ? t("forbidden") : tErrors("generic")} />
        )}

        {feedQuery.data && feedQuery.data.items.length === 0 && (
          <p className="rounded-md border border-dashed border-rule bg-surface/60 p-6 text-center text-sm text-ink-soft">
            {t("empty")}
          </p>
        )}

        <div className="space-y-3">
          {feedQuery.data?.items.map((post) => (
            <PostCard
              key={post.id}
              post={post}
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

        {feedQuery.data && (
          <Pagination
            page={feedQuery.data.page}
            limit={feedQuery.data.limit}
            totalCount={feedQuery.data.totalCount}
            hasMore={feedQuery.data.hasMore}
            onPageChange={setPage}
          />
        )}
      </div>
    </AppShell>
  );
}
