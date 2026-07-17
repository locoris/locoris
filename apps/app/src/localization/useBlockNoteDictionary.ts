import { en } from "@blocknote/core/locales";
import { useEffect, useState } from "react";

import { loadBlockNoteDictionary } from "./localePacks";

export function useBlockNoteDictionary(locale: string) {
  const [dictionary, setDictionary] = useState(en);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    setLoadError(null);
    void loadBlockNoteDictionary(locale)
      .then((nextDictionary) => {
        if (active) {
          setDictionary(nextDictionary);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error
              : new Error(`Failed to load the BlockNote dictionary for ${locale}`),
          );
        }
      });

    return () => {
      active = false;
    };
  }, [locale]);

  if (loadError) {
    throw loadError;
  }

  return dictionary;
}
