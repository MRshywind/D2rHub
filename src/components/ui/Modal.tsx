import { type ReactNode, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  closeOnContextMenu?: boolean;
}

export function Modal({ open, onClose, title, children, footer, width = "max-w-md", closeOnContextMenu = false }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }

    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label={title || "对话框"}
      className={`fixed inset-0 z-50 flex items-center justify-center ${closing ? "modal-backdrop-exit" : "modal-backdrop"}`}
      style={{ background: "rgba(18,24,34,0.08)" }}
      onClick={(e) => { if (open && e.target === backdropRef.current) onClose(); }}
      onContextMenu={(e) => {
        if (!closeOnContextMenu) return;
        e.preventDefault();
        if (open) onClose();
      }}
    >
      <div
        className={`relative w-full ${width} mx-4 rounded-modal overflow-hidden ${closing ? "modal-content-exit" : "modal-content"}`}
        style={{
          background: "linear-gradient(180deg, var(--surface-modal, var(--surface-glass)), var(--surface-card))",
          backdropFilter: "blur(16px) saturate(1.03)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-elevated)",
        }}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-sm font-semibold text-text-primary tracking-normal">{title}</h2>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="icon-btn w-7 h-7 hover:!bg-surface-hover"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className={`px-5 ${footer ? "pb-3" : "pb-5"} ${!title ? "pt-5" : ""}`}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-5 pb-5 pt-2 flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
