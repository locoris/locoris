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
  {
    disabled,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPress,
    type = "button",
    ...props
  },
  ref
) {
  const touchStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);

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

    touchStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false
    };
  };

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled}
      data-mobile-editor-press="true"
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        const start = touchStartRef.current;
        if (!start || start.pointerId !== event.pointerId || start.moved) {
          return;
        }

        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9) {
          start.moved = true;
        }
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        const start = touchStartRef.current;
        touchStartRef.current = null;

        if (
          event.defaultPrevented ||
          disabled ||
          event.pointerType === "mouse" ||
          !start ||
          start.pointerId !== event.pointerId ||
          start.moved
        ) {
          return;
        }

        event.preventDefault();
        suppressClickUntilRef.current = performance.now() + 720;
        onPress();
      }}
      onPointerCancel={(event) => {
        touchStartRef.current = null;
        onPointerCancel?.(event);
      }}
      onClick={(event) => {
        if (performance.now() < suppressClickUntilRef.current) {
          event.preventDefault();
          return;
        }

        onPress();
      }}
    />
  );
});

export default MobileEditorPressButton;
