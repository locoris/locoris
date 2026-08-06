import { describe, expect, it } from "vitest";

import type { NoteContent } from "../src/types";
import {
  blocksToHtmlBody,
  blocksToMarkdown
} from "../src/lib/exportImport/noteSerialization";

function content(blocks: unknown[]) {
  return blocks as NoteContent;
}

describe("note export serialization", () => {
  it("drops executable link schemes from HTML and Markdown", () => {
    const blocks = content([
      {
        type: "paragraph",
        props: {},
        content: [
          {
            type: "link",
            href: "javascript:alert(1)",
            content: [{ type: "text", text: "Open *this*", styles: {} }]
          }
        ]
      }
    ]);

    expect(blocksToHtmlBody(blocks)).toBe("<p>Open *this*</p>");
    expect(blocksToMarkdown(blocks)).toBe("Open \\*this\\*");
  });

  it("keeps safe links and encodes Markdown destinations", () => {
    const blocks = content([
      {
        type: "paragraph",
        props: {},
        content: [
          {
            type: "link",
            href: "https://example.com/a path_(draft)",
            content: [{ type: "text", text: "Reference", styles: {} }]
          }
        ]
      }
    ]);

    expect(blocksToHtmlBody(blocks)).toContain(
      'href="https://example.com/a path_(draft)" rel="noopener noreferrer"'
    );
    expect(blocksToMarkdown(blocks)).toBe(
      "[Reference](https://example.com/a%20path_%28draft%29)"
    );
  });

  it("rejects injected CSS values while preserving supported colors", () => {
    const blocks = content([
      {
        type: "paragraph",
        props: {
          textColor: 'red;background:url("javascript:alert(1)")',
          backgroundColor: "#aabbcc",
          textAlignment: "center;display:none"
        },
        content: [
          {
            type: "text",
            text: "Visible",
            styles: {
              textColor: 'blue;content:"hidden"',
              backgroundColor: "yellow"
            }
          }
        ]
      }
    ]);

    const html = blocksToHtmlBody(blocks);
    expect(html).toContain("background:#aabbcc");
    expect(html).toContain("background:yellow");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("display:none");
    expect(html).not.toContain("content:");
  });
});
