"use client";

import { useTranslations } from "next-intl";

export function Pagination({
  page,
  limit,
  totalCount,
  hasMore,
  onPageChange,
}: {
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
}) {
  const t = useTranslations("feed");
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  if (totalCount <= limit) return null;

  return (
    <div className="flex items-center justify-between font-stamp text-xs uppercase tracking-wide text-ink-soft">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="rounded-sm border border-rule px-3 py-1.5 hover:bg-teal-soft disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {t("previous")}
      </button>
      <span>{t("pageOf", { page, total: totalPages })}</span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={!hasMore}
        className="rounded-sm border border-rule px-3 py-1.5 hover:bg-teal-soft disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {t("next")}
      </button>
    </div>
  );
}
