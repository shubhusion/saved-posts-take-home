"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

const LOCALES = ["en", "hi"] as const;

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("app");

  function setLocale(code: string) {
    document.cookie = `locale=${code}; path=/; max-age=31536000`;
    router.refresh(); // re-runs server components, which pick the new cookie up
  }

  return (
    <div className="flex items-center gap-2 font-stamp text-xs uppercase tracking-wide">
      <span className="text-ink-faint" aria-hidden>
        {t("language")}
      </span>
      <div className="flex overflow-hidden rounded-sm border border-rule">
        {LOCALES.map((code) => (
          <button
            key={code}
            onClick={() => setLocale(code)}
            aria-pressed={locale === code}
            className={cn(
              "px-2 py-1 transition-colors",
              locale === code ? "bg-teal text-white" : "bg-surface text-ink-soft hover:bg-teal-soft",
            )}
          >
            {t(`locales.${code}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
