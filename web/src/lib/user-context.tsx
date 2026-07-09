"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setCurrentUserId } from "./api";

/**
 * The assignment stubs authentication; this is that stub's client half.
 * There is no login screen — a dev-only user switcher (see UserSwitcher)
 * picks one of the seeded users, and every subsequent API call carries
 * their id as `x-user-id`. The SERVER never trusts a role from here: it
 * looks the role up from the database on every request (see app.ts resolve).
 */

export interface CurrentUser {
  id: string;
  name: string;
  role: "student" | "moderator";
}

interface UserContextValue {
  currentUser: CurrentUser | null;
  setUser: (user: CurrentUser | null) => void;
}

const UserContext = createContext<UserContextValue | null>(null);

const STORAGE_KEY = "saved-posts:current-user";

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<CurrentUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CurrentUser;
      setCurrentUserState(parsed);
      setCurrentUserId(parsed.id);
    }
    setHydrated(true);
  }, []);

  const setUser = (user: CurrentUser | null) => {
    setCurrentUserState(user);
    setCurrentUserId(user?.id ?? null);
    if (user) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(STORAGE_KEY);
  };

  // Avoid a flash of "no user" before localStorage is read.
  if (!hydrated) return null;

  return <UserContext.Provider value={{ currentUser, setUser }}>{children}</UserContext.Provider>;
}

export function useCurrentUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useCurrentUser must be used within UserProvider");
  return ctx;
}
