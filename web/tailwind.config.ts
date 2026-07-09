import type { Config } from "tailwindcss";

// Design language: a course library's card catalog, not a generic "app".
// Cool slate-paper background, brass accent for the save/bookmark action
// (like a due-date stamp), deep teal for navigation state, brick for the
// one destructive action (moderator remove). Serif for titles (the thing
// being catalogued), monospace for metadata (the stamped facts about it).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EDF1F1",
        surface: "#FFFFFF",
        ink: {
          DEFAULT: "#1E2A38",
          soft: "#5B6B75",
          faint: "#9AA7AE",
        },
        rule: "#D7DEDD",
        brass: {
          DEFAULT: "#B8860F",
          soft: "#E4C878",
          deep: "#8A6408",
        },
        teal: {
          DEFAULT: "#2F6F6B",
          deep: "#1F4D4A",
          soft: "#DCEBE9",
        },
        brick: {
          DEFAULT: "#9B3A2E",
          soft: "#F3DEDA",
        },
      },
      fontFamily: {
        display: ["Iowan Old Style", "Sitka Text", "Palatino Linotype", "Georgia", "serif"],
        body: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        stamp: ["SF Mono", "Cascadia Code", "Consolas", "Liberation Mono", "monospace"],
      },
      keyframes: {
        "stamp-in": {
          "0%": { transform: "scale(0.85)", opacity: "0.6" },
          "60%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "stamp-in": "stamp-in 220ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
