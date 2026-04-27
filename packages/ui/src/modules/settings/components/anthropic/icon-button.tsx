import type { ReactNode } from "react";

export function IconButton({
  onClick,
  title,
  hoverTone,
  children,
}: {
  onClick: () => void | Promise<void>;
  title: string;
  hoverTone: "accent" | "danger" | "neutral";
  children: ReactNode;
}) {
  const hover =
    hoverTone === "accent"
      ? "hover:text-accent hover:border-accent"
      : hoverTone === "danger"
        ? "hover:text-danger hover:border-danger"
        : "hover:text-text hover:border-border";
  return (
    <button
      onClick={onClick}
      className={`btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted ${hover}`}
      style={{ boxShadow: "var(--shadow-brutal-sm)" }}
      title={title}
    >
      {children}
    </button>
  );
}
