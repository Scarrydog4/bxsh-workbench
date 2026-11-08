/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",

  ],
  theme: {
    extend: {
      fontSize: { xs: ['12px','16px'], sm: ['14px','20px'], base: ['16px','24px'], lg: ['16px','24px'], xl: ['20px','28px'], '2xl': ['24px','32px'], '3xl': ['24px','32px'], '4xl': ['24px','32px'] },
      boxShadow: { DEFAULT: 'var(--shadow-control)', sm: 'var(--shadow-control)', md: 'var(--shadow-overlay)', lg: 'var(--shadow-overlay)', xl: 'var(--shadow-overlay)', '2xl': 'var(--shadow-overlay)' },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        sidebar: "hsl(var(--sidebar))",
        ok: "hsl(var(--ok))",
        warn: "hsl(var(--warn))",
        danger: "hsl(var(--danger))",
        info: "hsl(var(--info))",
        gold: "hsl(var(--gold))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        mono: ['"Geist Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "8px", xl: "12px", lg: "12px",
        md: "8px",
        sm: "8px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
