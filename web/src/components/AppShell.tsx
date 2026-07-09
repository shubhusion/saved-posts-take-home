"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { UserSwitcher } from "./UserSwitcher";
import { cn } from "@/lib/cn";
import { useCurrentUser } from "@/lib/user-context";

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  const pathname = usePathname();
  const { currentUser } = useCurrentUser();

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-16 pt-8">
      <header className="mb-6 border-b-2 border-brass pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h1 className="font-display text-2xl text-ink">{t("title")}</h1>
            <p className="font-stamp text-xs uppercase tracking-wide text-ink-faint">{t("tagline")}</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <UserSwitcher />
            <LanguageSwitcher />
          </div>
        </div>

        {currentUser && (
          <nav className="mt-5 flex gap-1">
            {[
              { href: "/feed", label: t("feedTab") },
              { href: "/saved", label: t("savedTab") },
            ].map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "rounded-t-md px-4 py-2 font-stamp text-xs uppercase tracking-wide transition-colors",
                  pathname === tab.href
                    ? "bg-teal text-white"
                    : "bg-transparent text-ink-soft hover:bg-teal-soft",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
