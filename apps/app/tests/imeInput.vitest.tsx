import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { useState } from "react";

import { initializeI18n } from "../src/i18n";
import {
  isCommitEnterKey,
  isImeCompositionActive
} from "../src/lib/keyboardInput";
import PlannerTimeField from "../src/components/planner/PlannerTimeField";

beforeAll(async () => {
  await initializeI18n("en");
});

afterEach(cleanup);

function CompositionProbe({ onCommit }: { onCommit: (value: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <input
      aria-label="CJK draft"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (isCommitEnterKey(event)) onCommit(event.currentTarget.value);
      }}
    />
  );
}

describe("IME-safe keyboard handling", () => {
  test("recognizes both standards-based and Android keyCode composition signals", () => {
    expect(isImeCompositionActive({ key: "Enter", isComposing: true })).toBe(true);
    expect(isImeCompositionActive({ key: "Enter", keyCode: 229 })).toBe(true);
    expect(isImeCompositionActive({
      key: "Enter",
      nativeEvent: { isComposing: true }
    })).toBe(true);
    expect(isCommitEnterKey({ key: "Enter" })).toBe(true);
  });

  test("does not commit CJK text until composition has finished", () => {
    const onCommit = vi.fn();
    render(<CompositionProbe onCommit={onCommit} />);
    const input = screen.getByRole("textbox", { name: "CJK draft" });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "日本語" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: false, keyCode: 13 });
    expect(onCommit).toHaveBeenCalledWith("日本語");
  });

  test("does not normalize a planner time field while an IME is composing", () => {
    const onChange = vi.fn();
    render(
      <PlannerTimeField
        valueMinutes={9 * 60}
        language="en"
        ariaLabel="Start time"
        onChange={onChange}
      />
    );
    const input = screen.getByRole("textbox", { name: "Start time" });

    fireEvent.change(input, { target: { value: "0933" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", isComposing: false, keyCode: 13 });
    expect(onChange).toHaveBeenCalledWith(9 * 60 + 33);
  });
});
