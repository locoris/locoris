import { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  editorBlockNoteSchema,
  type EditorStoredFontId
} from "../src/lib/blocknoteSchema";
import {
  captureMobileEditorFormatSelection,
  restoreMobileEditorFormatSelection
} from "../src/components/mobileEditorFormatSelection";

function selectFirstWord(editor: BlockNoteEditor<any, any, any>) {
  editor.transact((transaction) => {
    let from = 0;
    let to = 0;

    transaction.doc.descendants((node, position) => {
      if (!from && node.isText && node.text) {
        from = position;
        to = position + node.text.indexOf(" ");
        return false;
      }
      return true;
    });

    transaction.setSelection(TextSelection.create(transaction.doc, from, to));
  });
}

function collapseSelection(editor: BlockNoteEditor<any, any, any>) {
  editor.transact((transaction) => {
    transaction.setSelection(
      TextSelection.create(transaction.doc, transaction.selection.to)
    );
  });
}

describe("mobile editor format selection", () => {
  it("keeps applying font changes to the original selected text after focus loss", () => {
    const editor = BlockNoteEditor.create({
      schema: editorBlockNoteSchema,
      initialContent: [{ type: "paragraph", content: "Locoris note" }]
    });

    selectFirstWord(editor);
    let snapshot = captureMobileEditorFormatSelection(editor);
    collapseSelection(editor);

    const fonts: EditorStoredFontId[] = [
      "onest",
      "ibmPlexSans",
      "golosText",
      "ibmPlexSerif",
      "ibmPlexMono",
      "unbounded"
    ];

    fonts.forEach((font) => {
      expect(restoreMobileEditorFormatSelection(editor, snapshot)).toBe(true);
      editor.addStyles({ font });
      snapshot = captureMobileEditorFormatSelection(editor);

      expect(editor.document[0].content?.[0]).toMatchObject({
        text: "Locoris",
        styles: { font }
      });
      collapseSelection(editor);
    });

    expect(restoreMobileEditorFormatSelection(editor, snapshot)).toBe(true);

    expect(editor.document[0].content).toEqual([
      {
        type: "text",
        text: "Locoris",
        styles: { font: "unbounded" }
      },
      {
        type: "text",
        text: " note",
        styles: {}
      }
    ]);
  });
});
