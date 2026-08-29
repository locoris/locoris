import { TextSelection, type Transaction } from "prosemirror-state";

export type MobileEditorFormatSelection = {
  anchor: number;
  head: number;
};

type TransactionEditor = {
  transact: <Result>(callback: (transaction: Transaction) => Result) => Result;
};

export function captureMobileEditorFormatSelection(
  editor: TransactionEditor
): MobileEditorFormatSelection | null {
  try {
    return editor.transact((transaction) =>
      transaction.selection instanceof TextSelection
        ? {
            anchor: transaction.selection.anchor,
            head: transaction.selection.head
          }
        : null
    );
  } catch {
    return null;
  }
}

export function restoreMobileEditorFormatSelection(
  editor: TransactionEditor,
  snapshot: MobileEditorFormatSelection | null
) {
  if (!snapshot) {
    return false;
  }

  try {
    editor.transact((transaction) => {
      const maxPosition = transaction.doc.content.size;
      const anchor = Math.min(Math.max(1, snapshot.anchor), maxPosition);
      const head = Math.min(Math.max(1, snapshot.head), maxPosition);

      transaction.setSelection(
        TextSelection.between(transaction.doc.resolve(anchor), transaction.doc.resolve(head))
      );
    });
    return true;
  } catch {
    return false;
  }
}
