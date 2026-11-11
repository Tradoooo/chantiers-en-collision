import type { Locale, MessageDict, MsgId } from "../core/types";
import { EN } from "./en";
import { FR } from "./fr";

/** Replace {param} placeholders. Unknown placeholders are left as-is. */
export function format(
  dict: MessageDict,
  id: MsgId,
  params: Record<string, string | number> = {},
): string {
  const tpl = dict[id];
  return tpl.replace(/\{(\w+)\}/g, (_m, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

export function dictFor(locale: Locale): MessageDict {
  return locale === "fr" ? FR : EN;
}

/** Convenience: format with the locale's dictionary. */
export function t(
  locale: Locale,
  id: MsgId,
  params: Record<string, string | number> = {},
): string {
  return format(dictFor(locale), id, params);
}
