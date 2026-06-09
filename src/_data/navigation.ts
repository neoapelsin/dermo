import type { NavItem } from "./types.js";

/**
 * Основная навигация сайта. Используется в шапке (page.njk) и подвале.
 * Вложенные пункты (children) рендерятся как выпадающие меню.
 */
const navigation: NavItem[] = [
  { title: "Логистика", url: "/logistika/" },
  { title: "Торговля", url: "/torgovlya/" },
  {
    title: "Доставка",
    url: "/dostavka/",
    children: [
      { title: "Автотранспортом", url: "/dostavka/avto/" },
      { title: "ЖД", url: "/dostavka/zhd/" },
      { title: "Морем", url: "/dostavka/more/" },
      { title: "Авиа", url: "/dostavka/avia/" },
    ],
  },
  {
    title: "Товары",
    url: "/tovary/",
    children: [
      { title: "Напольные покрытия", url: "/tovary/napolnye-pokrytiya/" },
      { title: "Стройматериалы", url: "/tovary/stroymaterialy/" },
      { title: "Керамика и плитка", url: "/tovary/keramika-plitka/" },
      { title: "Электроника", url: "/tovary/elektronika/" },
      { title: "Запчасти", url: "/tovary/zapchasti/" },
      { title: "Текстиль", url: "/tovary/tekstil/" },
      { title: "Оборудование", url: "/tovary/oborudovanie/" },
    ],
  },
  {
    title: "Города",
    url: "/goroda/",
    children: [
      { title: "Москва", url: "/goroda/moskva/" },
      { title: "Санкт-Петербург", url: "/goroda/sankt-peterburg/" },
      { title: "Екатеринбург", url: "/goroda/ekaterinburg/" },
      { title: "Новосибирск", url: "/goroda/novosibirsk/" },
      { title: "Казань", url: "/goroda/kazan/" },
    ],
  },
  { title: "Кейсы", url: "/kejsy/" },
  { title: "Блог", url: "/blog/" },
  { title: "О компании", url: "/o-kompanii/" },
  { title: "Контакты", url: "/kontakty/" },
];

export default navigation;
