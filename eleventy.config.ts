import { pathToFileURL } from "node:url";
import type { Breadcrumb } from "./src/_data/types.js";

/**
 * Карта слаг → человекочитаемая подпись.
 * Используется для генерации заголовков-заглушек и хлебных крошек,
 * чтобы не дублировать тексты в каждом шаблоне.
 */
const LABELS: Record<string, string> = {
  logistika: "Логистика",
  torgovlya: "Торговля",
  "o-kompanii": "О компании",
  kontakty: "Контакты",
  dostavka: "Доставка",
  avto: "Доставка автотранспортом",
  zhd: "Доставка ЖД",
  more: "Доставка морем",
  avia: "Доставка авиа",
  tovary: "Товары",
  "napolnye-pokrytiya": "Напольные покрытия",
  stroymaterialy: "Стройматериалы",
  "keramika-plitka": "Керамика и плитка",
  elektronika: "Электроника",
  zapchasti: "Запчасти",
  tekstil: "Текстиль",
  oborudovanie: "Оборудование",
  goroda: "Города",
  moskva: "Москва",
  "sankt-peterburg": "Санкт-Петербург",
  ekaterinburg: "Екатеринбург",
  novosibirsk: "Новосибирск",
  kazan: "Казань",
  kejsy: "Кейсы",
  blog: "Блог",
  r: "Акция",
  "belaya-dostavka": "Белая доставка",
};

/**
 * Строит список хлебных крошек из URL страницы.
 * Всегда начинается с «Главная». Последняя крошка помечается last (без ссылки).
 */
function buildBreadcrumbs(url: string): Breadcrumb[] {
  const parts = url.split("/").filter(Boolean);
  const crumbs: Breadcrumb[] = [{ name: "Главная", url: "/" }];
  let acc = "";
  parts.forEach((part, index) => {
    acc += `/${part}`;
    crumbs.push({
      name: LABELS[part] || part,
      url: `${acc}/`,
      last: index === parts.length - 1,
    });
  });
  return crumbs;
}

// Тип конфигуратора 11ty намеренно ослаблен: пакет не экспортирует строгий
// публичный тип для аргумента конфиг-функции в текущей версии.
type EleventyConfig = {
  addDataExtension: (ext: string, options: unknown) => void;
  addPassthroughCopy: (path: unknown) => void;
  addWatchTarget: (path: string) => void;
  setTemplateFormats: (formats: string[] | string) => void;
  addFilter: (name: string, fn: (...args: never[]) => unknown) => void;
  addGlobalData: (name: string, value: unknown) => void;
};

export default function (eleventyConfig: EleventyConfig) {
  // Поддержка дата-файлов на TypeScript (_data/*.ts и *.11tydata.ts).
  // tsx-загрузчик (node --import tsx) делает динамический import .ts рабочим.
  eleventyConfig.addDataExtension("ts", {
    read: false,
    parser: async (filePath: string) => {
      const mod = await import(
        `${pathToFileURL(filePath).href}?cacheBust=${Date.now()}`
      );
      return mod.default ?? mod;
    },
  });

  // Статика: картинки и Decap CMS-админка.
  eleventyConfig.addPassthroughCopy({ "src/assets/img": "assets/img" });
  eleventyConfig.addPassthroughCopy({ admin: "admin" });

  // CSS и JS собираются вне 11ty (postcss/esbuild) прямо в _site —
  // следим за изменениями, чтобы browsersync перезагружал страницу.
  eleventyConfig.addWatchTarget("./_site/assets/css/styles.css");
  eleventyConfig.addWatchTarget("./_site/assets/js/main.js");

  eleventyConfig.setTemplateFormats(["njk", "md"]);

  // Фильтр хлебных крошек (для партиалов навигации и JSON-LD BreadcrumbList).
  eleventyConfig.addFilter("breadcrumbs", (url: string) =>
    buildBreadcrumbs(url),
  );

  // Абсолютный URL из относительного пути.
  eleventyConfig.addFilter("absoluteUrl", (path: string, base: string) => {
    if (!path) return base;
    if (/^https?:\/\//.test(path)) return path;
    return `${base.replace(/\/$/, "")}${path}`;
  });

  // Дата в ISO (для sitemap lastmod и <time datetime>).
  eleventyConfig.addFilter("isoDate", (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  });

  // Дата в человекочитаемом русском формате (для шаблона статьи).
  eleventyConfig.addFilter("readableDate", (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  });

  // Глобальные вычисляемые данные: заголовок-заглушка из карты LABELS,
  // если страница не задала свой title во front matter.
  eleventyConfig.addGlobalData("eleventyComputed", {
    title: (data: {
      title?: string;
      page?: { fileSlug?: string };
      site?: { defaultTitle?: string };
    }) =>
      data.title ||
      (data.page?.fileSlug ? LABELS[data.page.fileSlug] : undefined) ||
      data.site?.defaultTitle ||
      "",
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    // Завершающий слеш в URL обеспечивается permalink-шаблонами в данных папок.
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
