import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const SUPPORTED_LOCALES = ["en", "hi"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Locale is a cookie, not a URL segment: the app is a single tool, not a
 * public site, so locale routing would add ceremony without SEO benefit.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get("locale")?.value;
  const locale: Locale = raw === "hi" ? "hi" : "en";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
