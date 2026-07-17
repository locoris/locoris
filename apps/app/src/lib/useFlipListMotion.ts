import { useLayoutEffect, useRef, type RefObject } from "react";

interface FlipPosition {
  left: number;
  top: number;
}

export function useFlipListMotion(
  containerRef: RefObject<HTMLElement | null>,
  layoutKey: string,
  itemSelector = "[data-motion-key]"
) {
  const previousPositionsRef = useRef<Map<string, FlipPosition>>(new Map());
  const hasMeasuredRef = useRef(false);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    const nextPositions = new Map<string, FlipPosition>();

    items.forEach((item) => {
      const key = item.dataset.motionKey;

      if (!key) {
        return;
      }

      const rect = item.getBoundingClientRect();
      nextPositions.set(key, { left: rect.left, top: rect.top });

      if (
        !hasMeasuredRef.current ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      const previous = previousPositionsRef.current.get(key);

      if (typeof item.animate !== "function") {
        return;
      }

      if (!previous) {
        item.animate(
          [
            { opacity: 0, transform: "translateY(8px) scale(0.99)" },
            { opacity: 1, transform: "translateY(0) scale(1)" }
          ],
          {
            duration: 260,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)"
          }
        );
        return;
      }

      const deltaX = previous.left - rect.left;
      const deltaY = previous.top - rect.top;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        return;
      }

      item.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" }
        ],
        {
          duration: 360,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)"
        }
      );
    });

    previousPositionsRef.current = nextPositions;
    hasMeasuredRef.current = true;
  }, [containerRef, itemSelector, layoutKey]);
}
