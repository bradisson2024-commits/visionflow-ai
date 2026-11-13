/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#000000", 900: "#0a0a0a", 850: "#101010", 800: "#151515", 700: "#1e1e1e", 600: "#2a2a2a" },
        brand: { DEFAULT: "#ff7a00", 400: "#ff9433", 500: "#ff7a00", 600: "#e56b00" },
        muted: "#9a9a9a",
      },
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};
