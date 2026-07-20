/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // These are referenced by utility classes but actual theming
        // comes from CSS custom properties in tokens.css
        surface: {
          base:   "var(--surface-base)",
          glass:  "var(--surface-glass)",
          card:   "var(--surface-card)",
          control: "var(--surface-control)",
          elevated: "var(--surface-modal)",
          hover:  "var(--surface-hover)",
          active: "var(--surface-active)",
        },
        border: {
          DEFAULT: "var(--border-default)",
          strong:  "var(--border-strong)",
          focus:   "var(--border-focus)",
        },
        text: {
          primary:   "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted:     "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover:   "var(--accent-hover)",
          glow:    "var(--accent-glow)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        error:   "var(--error)",
        info:    "var(--info)",
      },
      borderRadius: {
        card:   "var(--radius-card)",
        input:  "var(--radius-input)",
        modal:  "var(--radius-modal)",
        badge:  "var(--radius-badge)",
      },
      boxShadow: {
        card:     "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
        glow:     "var(--shadow-glow)",
      },
      fontFamily: {
        sans: ['"Inter"','-apple-system','BlinkMacSystemFont','"Segoe UI"','"Microsoft YaHei"','"PingFang SC"','sans-serif'],
        mono: ['"JetBrains Mono"','Consolas','monospace'],
      },
      fontSize: {
        '2xs':  'var(--text-2xs)',
        'xs':   'var(--text-xs)',
        'sm':   'var(--text-sm)',
        'md':   'var(--text-md)',
        'lg':   'var(--text-lg)',
        'xl':   'var(--text-xl)',
      },
      animation: {
        "shimmer": "shimmer 1.5s infinite",
        "slide-up": "slide-up 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right 300ms cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 200ms ease-out",
      },
    },
  },
  plugins: [],
};
