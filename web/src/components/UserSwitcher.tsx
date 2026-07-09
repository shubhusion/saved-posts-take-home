"use client";

import { useTranslations } from "next-intl";
import { useDevUsers } from "@/lib/queries";
import { useCurrentUser } from "@/lib/user-context";

/**
 * Stands in for the login screen the spec explicitly says not to build.
 * Picking a user here sets `x-user-id` on every subsequent API call; the
 * SERVER re-derives role from the database rather than trusting anything
 * from this switcher, so this component carries no security weight — it's
 * purely a demo convenience for the reviewer.
 */
export function UserSwitcher() {
  const t = useTranslations("app");
  const { data: users } = useDevUsers();
  const { currentUser, setUser } = useCurrentUser();

  return (
    <label className="flex items-center gap-2 font-stamp text-xs uppercase tracking-wide text-ink-soft">
      <span aria-hidden>{t("viewingAs")}</span>
      <select
        className="rounded-sm border border-rule bg-surface px-2 py-1 text-ink"
        value={currentUser?.id ?? ""}
        onChange={(e) => {
          const user = users?.find((u) => u.id === e.target.value);
          setUser(user ? { id: user.id, name: user.name, role: user.role } : null);
        }}
      >
        <option value="" disabled>
          {t("selectUser")}
        </option>
        {users?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {u.role}
          </option>
        ))}
      </select>
    </label>
  );
}
