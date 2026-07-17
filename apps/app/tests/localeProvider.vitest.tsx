import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { useState } from "react";

import { initializeI18n } from "../src/i18n";
import { LocaleProvider, useLocale } from "../src/localization/LocaleProvider";
import { writeLocalePreferences } from "../src/localization/localePreferences";

function UnsavedNoteDraftProbe() {
  const { runtime, updatePreferences } = useLocale();
  const [draft, setDraft] = useState("");

  return (
    <div>
      <textarea
        aria-label="Unsaved note"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <output data-testid="active-locale">{runtime.interfaceLocale}</output>
      <button
        type="button"
        onClick={() => void updatePreferences({ interfaceLanguage: "ru" })}
      >
        Change language
      </button>
    </div>
  );
}

beforeAll(async () => {
  await initializeI18n("en");
});

beforeEach(() => {
  writeLocalePreferences({
    interfaceLanguage: "en",
    formatLocale: "en-US",
    weekStartsOn: "region",
    hourCycle: "region",
    spellcheck: { mode: "system", languages: [] }
  });
});

afterEach(cleanup);

describe("language changes with an unsaved note", () => {
  test("keeps the mounted draft and its text while the locale changes", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <UnsavedNoteDraftProbe />
      </LocaleProvider>
    );
    const editor = screen.getByRole("textbox", { name: "Unsaved note" });
    await user.type(editor, "Незбережений чернетковий текст 日本語");

    await user.click(screen.getByRole("button", { name: "Change language" }));
    await waitFor(() => expect(screen.getByTestId("active-locale").textContent).toBe("ru"));

    expect(screen.getByRole("textbox", { name: "Unsaved note" })).toBe(editor);
    expect((editor as HTMLTextAreaElement).value).toBe("Незбережений чернетковий текст 日本語");
  });
});
