export type BlockNoteDictionary = typeof import("@blocknote/core/locales")["en"];

export type LocaleDirection = "ltr" | "rtl";

export type LocalePackMeta = {
  code: string;
  nativeName: string;
  direction: LocaleDirection;
};

export type LocalePack<TMessages> = {
  meta: LocalePackMeta;
  messages: TMessages;
  blockNoteDictionary: () => Promise<BlockNoteDictionary>;
};

export function defineLocalePack<const TMessages>(pack: LocalePack<TMessages>) {
  return pack;
}
