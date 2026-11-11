// Тема: светлая или тёмная. При первом запуске берётся тема Windows,
// дальше — то, что выбрал пользователь (одна кнопка, один клик).
import { createRoot, createSignal } from "solid-js";

export type Theme = "light" | "dark";
const KEY = "app.theme";

function initial(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* хранилище недоступно */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const theme = createRoot(() => {
  const [value, setValue] = createSignal<Theme>(initial());
  const apply = (t: Theme) => document.documentElement.setAttribute("data-theme", t);
  apply(value());
  return {
    value,
    toggle() {
      const next: Theme = value() === "dark" ? "light" : "dark";
      setValue(next);
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* не страшно */
      }
    },
  };
});
