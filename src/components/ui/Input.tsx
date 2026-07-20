import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id, style, ...props }, ref) => {
    const inputId = id || label?.replace(/\s+/g, "-").toLowerCase();

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-text-secondary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`px-3 py-2 rounded-input border
            text-sm placeholder:text-text-muted
            transition-all duration-200 ease-out
            focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-accent/10
            ${error ? "border-error/50" : "border-border-default hover:border-border-strong"}
            ${className}`}
          style={{ color: "var(--input-text, var(--text-primary))", backgroundColor: "var(--input-bg, var(--surface-card))", ...style }}
          {...props}
        />
        {error && (
          <p className="text-xs text-error mt-0.5">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
