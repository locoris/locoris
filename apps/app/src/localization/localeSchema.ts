import en from "../locales/en";

type LocaleShape<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? T
    : T extends Record<string, unknown>
      ? { [Key in keyof T]: LocaleShape<T[Key]> } & Partial<
          Record<`${string}_${"zero" | "one" | "two" | "few" | "many" | "other"}`, string>
        >
      : T;

/** Every locale pack must expose the same message tree as the English source catalog. */
export type AppLocaleMessages = LocaleShape<typeof en.messages>;
