/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1A1A1A",
        muted: "#6B7280",
        line: "#E5E7EB",
        paper: "#FAFAFA",
        bullish: "#16A34A",
        bearish: "#DC2626",
        neutralSignal: "#D97706",
      },
    },
  },
  plugins: [],
};
