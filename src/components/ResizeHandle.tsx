import { useEffect, useRef } from "react";

interface Props {
  onDrag: (dxPixels: number) => void;
}

/** A thin draggable divider between two panels. Registers window-level drag
 * listeners once and reads the latest onDrag through a ref, so dragging
 * keeps working even while the pointer moves outside the handle itself. */
export default function ResizeHandle({ onDrag }: Props) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDragRef.current(dx);
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      onMouseDown={(e) => {
        dragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = "col-resize";
      }}
      className="group relative z-10 w-1 shrink-0 cursor-col-resize"
      role="separator"
      aria-orientation="vertical"
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-line group-hover:bg-accent group-active:bg-accent" />
    </div>
  );
}
