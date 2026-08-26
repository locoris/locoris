import { describe, expect, it } from "vitest";

import {
  resolveMobilePopoverPosition,
  resolveMobileSelectionToolbarTop
} from "../src/components/useMobileEditorExperience";

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

describe("mobile editor submenu placement", () => {
  it("opens a submenu below its trigger when the visible viewport has room", () => {
    expect(
      resolveMobilePopoverPosition({
        anchorTop: 120,
        anchorRight: 180,
        anchorBottom: 162,
        anchorLeft: 90,
        popoverWidth: 220,
        popoverHeight: 180,
        viewportTop: 20,
        viewportRight: 390,
        viewportBottom: 700,
        viewportLeft: 0
      })
    ).toEqual({
      top: 170,
      left: 90,
      maxHeight: 522,
      placement: "below"
    });
  });

  it("opens above the trigger when the keyboard leaves more room there", () => {
    expect(
      resolveMobilePopoverPosition({
        anchorTop: 310,
        anchorRight: 330,
        anchorBottom: 352,
        anchorLeft: 250,
        popoverWidth: 220,
        popoverHeight: 190,
        viewportTop: 40,
        viewportRight: 390,
        viewportBottom: 430,
        viewportLeft: 0
      })
    ).toEqual({
      top: 112,
      left: 110,
      maxHeight: 254,
      placement: "above"
    });
  });

  it("limits a submenu to the remaining visible height", () => {
    expect(
      resolveMobilePopoverPosition({
        anchorTop: 150,
        anchorRight: 220,
        anchorBottom: 192,
        anchorLeft: 120,
        popoverWidth: 320,
        popoverHeight: 420,
        viewportTop: 90,
        viewportRight: 360,
        viewportBottom: 330,
        viewportLeft: 0
      })
    ).toEqual({
      top: 200,
      left: 8,
      maxHeight: 122,
      placement: "below"
    });
  });
});
