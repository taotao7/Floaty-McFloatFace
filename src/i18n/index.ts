import { createContext, useContext } from "react";
import { zhCN } from "./locales/zh-CN";
import { en } from "./locales/en";

export type Locale = "zh-CN" | "en";
type Messages = typeof zhCN;

const locales: Record<Locale, Messages> = { "zh-CN": zhCN, en };

export function detectLocale(): Locale {
  const lang = navigator.language;
  if (lang.startsWith("zh")) return "zh-CN";
  return "en";
}

export function getMessages(locale: Locale): Messages {
  return locales[locale] ?? locales.en;
}

const I18nContext = createContext<Messages>(zhCN);

export const I18nProvider = I18nContext.Provider;

export function useI18n() {
  return useContext(I18nContext);
}
