"use client";

import { useTranslations } from "next-intl";

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const t = useTranslations("errors");

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-brick/40 bg-brick/10 px-4 py-2 text-sm text-brick"
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="font-stamp text-xs uppercase tracking-wide text-brick underline decoration-brick/40 underline-offset-2 hover:decoration-brick"
        >
          {t("dismiss")}
        </button>
      )}
    </div>
  );
}
