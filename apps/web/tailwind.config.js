/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      // Banknote-ink palette: deep green ink on a cool mist page. Up/down keep
      // their conventional green/red so nobody has to learn a new code, but in
      // inks that sit with the green rather than a dashboard's stock colours.
      colors: {
        mist: "#F2F4EF",
        paper: "#F2F4EF",
        ink: "#17302A",
        muted: "#5F6F69",
        line: "#D9E0DA",
        bullish: "#23784A",
        bearish: "#B3263E",
        neutralSignal: "#9A7B1F",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
