import { useEffect, type Dispatch, type SetStateAction } from "react";

type DismissibleNotice = {
  tone: "success" | "error" | "info";
  text: string;
};

export default function useAutoDismissNotice<T extends DismissibleNotice>(
  notice: T | null,
  setNotice: Dispatch<SetStateAction<T | null>>,
  options: {
    successMs?: number;
    infoMs?: number;
    enabled?: boolean;
  } = {}
) {
  const {
    successMs = 4800,
    infoMs = 6400,
    enabled = true
  } = options;

  useEffect(() => {
    if (!enabled || !notice || notice.tone === "error") {
      return;
    }

    const timeout = window.setTimeout(
      () => setNotice((current) => (current === notice ? null : current)),
      notice.tone === "info" ? infoMs : successMs
    );

    return () => window.clearTimeout(timeout);
  }, [enabled, infoMs, notice, setNotice, successMs]);
}
