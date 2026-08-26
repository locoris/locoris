import {
  forwardRef,
  useRef,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent
} from "react";

type MobileEditorPressButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
> & {
  onPress: () => void;
};

const MobileEditorPressButton = forwardRef<
  HTMLButtonElement,
  MobileEditorPressButtonProps
>(function MobileEditorPressButton(
  { disabled, onPointerCancel, onPointerDown, onPress, type = "button", ...props },
  ref
) {
  const touchPressHandledRef = useRef(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);

    if (
      event.defaultPrevented ||
      disabled ||
      event.button !== 0
    ) {
      return;
    }

    // Prevent iOS from moving focus out of BlockNote before the command runs.
    event.preventDefault();

    if (event.pointerType === "mouse") {
      return;
    }

    touchPressHandledRef.current = true;
    onPress();
  };

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerCancel={(event) => {
        touchPressHandledRef.current = false;
        onPointerCancel?.(event);
      }}
      onClick={(event) => {
        if (touchPressHandledRef.current) {
          touchPressHandledRef.current = false;
          event.preventDefault();
          return;
        }

        onPress();
      }}
    />
  );
});

export default MobileEditorPressButton;
