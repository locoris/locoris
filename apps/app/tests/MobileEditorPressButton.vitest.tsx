import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MobileEditorPressButton from "../src/components/MobileEditorPressButton";

afterEach(cleanup);

describe("MobileEditorPressButton", () => {
  it("runs a touch action on pointer down and suppresses the following click", () => {
    const onPress = vi.fn();
    const { getByRole } = render(
      <MobileEditorPressButton onPress={onPress}>Action</MobileEditorPressButton>
    );
    const button = getByRole("button");

    fireEvent.pointerDown(button, { button: 0, pointerType: "touch" });
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.click(button);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary mouse and keyboard clicks single-shot", () => {
    const onPress = vi.fn();
    const { getByRole } = render(
      <MobileEditorPressButton onPress={onPress}>Action</MobileEditorPressButton>
    );
    const button = getByRole("button");

    fireEvent.pointerDown(button, { button: 0, pointerType: "mouse" });
    fireEvent.click(button);

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
