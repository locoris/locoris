import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MobileEditorPressButton from "../src/components/MobileEditorPressButton";

afterEach(cleanup);

describe("MobileEditorPressButton", () => {
  it("runs a touch action once on pointer up and suppresses the following click", () => {
    const onPress = vi.fn();
    const { getByRole } = render(
      <MobileEditorPressButton onPress={onPress}>Action</MobileEditorPressButton>
    );
    const button = getByRole("button");

    fireEvent.pointerDown(button, { button: 0, pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.pointerUp(button, { button: 0, pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.click(button);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not activate a touch action when the gesture becomes a scroll", () => {
    const onPress = vi.fn();
    const { getByRole } = render(
      <MobileEditorPressButton onPress={onPress}>Action</MobileEditorPressButton>
    );
    const button = getByRole("button");

    fireEvent.pointerDown(button, { button: 0, pointerId: 2, pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { pointerId: 2, pointerType: "touch", clientX: 10, clientY: 28 });
    fireEvent.pointerUp(button, { button: 0, pointerId: 2, pointerType: "touch", clientX: 10, clientY: 28 });

    expect(onPress).not.toHaveBeenCalled();
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
