import { useState, useEffect, useCallback, type ReactNode } from "react";
import { CheckCircle, AlertCircle, XCircle, Info, X } from "lucide-react";

type ToastType = "success" | "warning" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let nextId = 0;
type Listener = (toast: ToastItem) => void;
const listeners = new Set<Listener>();

export function showToast(type: ToastType, message: string) {
  const toast: ToastItem = { id: nextId++, type, message };
  listeners.forEach((fn) => fn(toast));
}

const iconMap: Record<ToastType, ReactNode> = {
  success: <CheckCircle size={16} />,
  warning: <AlertCircle size={16} />,
  error: <XCircle size={16} />,
  info: <Info size={16} />,
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: ToastItem) => {
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 4000);
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => {
      listeners.delete(addToast);
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 max-w-xs">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-enter toast-item toast-${toast.type}`}
        >
          <span className="shrink-0 toast-icon">{iconMap[toast.type]}</span>
          <p className="toast-message">
            {toast.message}
          </p>
          <button
            onClick={() =>
              setToasts((prev) => prev.filter((t) => t.id !== toast.id))
            }
            className="toast-close-btn"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
