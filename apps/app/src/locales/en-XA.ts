import en from "./en";
import type { AppLocaleMessages } from "../localization/localeSchema";
import { defineLocalePack } from "../localization/localePack";

const LETTERS: Record<string, string> = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú",
  A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú"
};

function pseudoText(value: string) {
  const protectedParts: string[] = [];
  const protectedValue = value.replace(/\{\{[^}]+\}\}|<[^>]+>|https?:\/\/\S+/g, (match) => {
    protectedParts.push(match);
    return `\u0000${protectedParts.length - 1}\u0000`;
  });
  const expanded = protectedValue.replace(/[AEIOUaeiou]/g, (letter) => LETTERS[letter] ?? letter);
  return `[¡ ${expanded} ${expanded.length > 18 ? "~~~" : "~"} !]`.replace(
    /\u0000(\d+)\u0000/g,
    (_, index: string) => protectedParts[Number(index)] ?? ""
  );
}

function pseudoLocalize<T>(value: T): T {
  if (typeof value === "string") {
    return pseudoText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(pseudoLocalize) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, pseudoLocalize(entry)])
    ) as T;
  }

  return value;
}

const pseudo = pseudoLocalize(en.messages) satisfies AppLocaleMessages;

export default defineLocalePack({
  meta: {
    code: "en-XA",
    nativeName: "Pseudo English",
    direction: "ltr"
  },
  messages: pseudo,
  blockNoteDictionary: en.blockNoteDictionary
});
