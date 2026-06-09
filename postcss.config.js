/**
 * PostCSS-конвейер для сборки Tailwind.
 * cssnano подключается только в продакшн-сборке (NODE_ENV=production),
 * чтобы в dev не минифицировать стили и не замедлять hot-reload.
 */
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import cssnano from "cssnano";

const isProduction = process.env.NODE_ENV === "production";

export default {
  plugins: [
    tailwindcss(),
    autoprefixer(),
    ...(isProduction ? [cssnano({ preset: "default" })] : []),
  ],
};
