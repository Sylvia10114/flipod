import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          app: "#0C0C0E",
          surface: { 1: "#FFFFFF06", 2: "#FFFFFF08", 3: "#FFFFFF15" },
          overlay: "#1C1C22F2",
          dim: "#00000060",
        },
        accent: {
          feed: "#8B9CF7",
          practice: "#A855F7",
          success: "#22C55E",
          error: "#EF4444",
          gold: "#C4A96E",
          orange: "#F97316",
          blue: "#3B82F6",
        },
        text: {
          1: "#FFFFFFDE",
          2: "#FFFFFF8C",
          3: "#FFFFFF4D",
          4: "#FFFFFF20",
          "on-accent": "#0C0C0E",
        },
        stroke: {
          subtle: "#FFFFFF15",
          border: "#FFFFFF1A",
          active: "#8B9CF7",
          popup: "#FFFFFF12",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["Geist Mono", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        "title-lg": "22px",
        title: "16px",
        body: "14px",
        "body-lg": "15px",
        caption: "12px",
        "caption-sm": "11px",
        stat: "28px",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "12px",
        xl: "16px",
        pill: "24px",
        phone: "40px",
      },
      spacing: {
        "zone-header": "120px",
        "zone-controls": "180px",
        "body-x": "20px",
      },
    },
  },
  plugins: [],
};

export default config;
