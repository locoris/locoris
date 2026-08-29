import { describe, expect, it } from "vitest";

import {
  isRepeatedMobileEditorTap,
  placeMobileCaretFromPoint,
  resolveMobilePopoverPosition,
  resolveMobileSelectionToolbarTop
} from "../src/components/useMobileEditorExperience";

describe("mobile editor tap intent", () => {
  it("keeps nearby rapid taps available for native word selection", () => {
    expect(
      isRepeatedMobileEditorTap(
        { time: 100, x: 120, y: 240 },
        { time: 360, x: 127, y: 245 }
      )
    ).toBe(true);
  });

  it("treats a later or distant tap as a new caret placement", () => {
    expect(
      isRepeatedMobileEditorTap(
        { time: 100, x: 120, y: 240 },
        { time: 700, x: 120, y: 240 }
      )
    ).toBe(false);
    expect(
      isRepeatedMobileEditorTap(
        { time: 100, x: 120, y: 240 },
        { time: 220, x: 170, y: 240 }
      )
    ).toBe(false);
  });
});

describe("mobile editor first-tap caret", () => {
  it("places a collapsed caret at the point returned by the browser", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    const text = document.createTextNode("Locoris note");
    editable.append(text);
    document.body.append(editable);
    const range = document.createRange();
    range.setStart(text, 7);
    range.collapse(true);
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => range
    });

    expect(placeMobileCaretFromPoint(editable, 40, 24)).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(7);
    window.getSelection()?.removeAllRanges();
    delete (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
    editable.remove();
  });
});

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
