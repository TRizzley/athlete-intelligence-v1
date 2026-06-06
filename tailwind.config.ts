import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0A0C10",
        surface: "#11151C",
        "surface-2": "#171C25",
        "surface-3": "#1E242F",
        border: "#262D3A",
        "border-strong": "#323B4A",
        foreground: "#EAEDF2",
        muted: "#929CB0",
        "muted-2": "#5E6878",
        accent: "#7DA2FF",
        "accent-strong": "#4F7BF0",
        success: "#34D399",
        "success-soft": "#10271F",
        warning: "#FBBF24",
        "warning-soft": "#2A2310",
        danger: "#F87171",
        "danger-soft": "#2A1414",
      },
      borderRadius: {
        xl: "0.85rem",
        "2xl": "1.1rem",
      },
      maxWidth: {
        app: "440px",
        content: "720px",
        wide: "1100px",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
