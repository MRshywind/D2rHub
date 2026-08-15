interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  descriptionId?: string;
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  ariaLabel,
  descriptionId,
}: ToggleProps) {
  return (
    <label
      className={`inline-flex items-center gap-2.5 ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {label && (
        <span className="text-sm text-text-secondary select-none">{label}</span>
      )}
      <button
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || label || (checked ? "关闭开关" : "开启开关")}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full
          transition-all duration-200 ease-out active:scale-[0.97]
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2
          ${checked ? "bg-accent" : "bg-surface-hover border border-border-default"}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full shadow-sm
            transition-transform duration-200 ease-out
            ${checked ? "translate-x-[18px]" : "translate-x-[3px]"}`}
          style={{ background: checked ? "var(--cta-text, #fff)" : "var(--surface-glass)" }}
        />
      </button>
    </label>
  );
}
