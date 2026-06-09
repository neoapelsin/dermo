import type { Config } from "tailwindcss";

/**
 * Конфиг Tailwind с плейсхолдерами дизайн-токенов бренда.
 * Конкретные значения цветов/шрифтов уточняются позже — сейчас нейтральные дефолты.
 * content покрывает все шаблоны и клиентский TS для корректного purge.
 */
const config: Config = {
  content: [
    "./src/**/*.{njk,md,html}",
    "./src/assets/ts/**/*.ts",
    "./admin/**/*.html",
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1200px",
      },
    },
    extend: {
      colors: {
        // Плейсхолдеры бренд-цветов — заменить на фирменные позже.
        brand: {
          DEFAULT: "#0f4c81",
          light: "#3a6ea5",
          dark: "#0a3a63",
        },
        accent: {
          DEFAULT: "#f59e0b",
          dark: "#b45309",
        },
      },
      fontFamily: {
        // Системный стек по умолчанию (без render-blocking веб-шрифтов).
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
