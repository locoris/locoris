import { describe, expect, it } from "vitest";

import { resolveMobileSelectionToolbarTop } from "../src/components/useMobileEditorExperience";

describe("mobile editor selection toolbar placement", () => {
  it("places the toolbar above the selection when there is room", () => {
    expect(
      resolveMobileSelectionToolbarTop({
        selectionTop: 280,
        selectionBottom: 320,
        toolbarHeight: 56,
        safeTop: 80,
        safeBottom: 620
      })
    ).toBe(214);
  });

  it("places the toolbar below a selection near the top edge", () => {
    expect(
      resolveMobileSelectionToolbarTop({
        selectionTop: 92,
        selectionBottom: 126,
        toolbarHeight: 56,
        safeTop: 80,
        safeBottom: 620
      })
    ).toBe(136);
  });

  it("keeps the toolbar inside the visible editor when neither side fully fits", () => {
    expect(
      resolveMobileSelectionToolbarTop({
        selectionTop: 105,
        selectionBottom: 205,
        toolbarHeight: 72,
        safeTop: 80,
        safeBottom: 240
      })
    ).toBe(168);
  });
});
