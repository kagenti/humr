import { useEffect, type ReactNode } from "react";

interface ModalProps {
  onClose: () => void;
  widthClass?: string;
  children: ReactNode;
  /** When true, clicking the backdrop does not close the modal. Default: false. */
  disableBackdropClose?: boolean;
}

/**
 * Centered overlay modal with brutal styling. Escape key + backdrop click
 * close it; clicks inside the modal body don't bubble out. Children lay out
 * the modal content (header / body / footer) themselves.
 */
export function Modal({
  onClose,
  widthClass = "w-[560px]",
  children,
  disableBackdropClose,
}: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in"
      onClick={disableBackdropClose ? undefined : onClose}
    >
      <div
        className={`${widthClass} max-h-[85vh] overflow-hidden rounded-xl border-2 border-border bg-surface flex flex-col anim-scale-in`}
        style={{ boxShadow: "var(--shadow-brutal)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
