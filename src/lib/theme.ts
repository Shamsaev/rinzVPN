// Тема оформления: системная, светлая или тёмная. Выбор хранится локально.
import { createRoot, createSignal } from "solid-js";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "app.theme";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* хранилище недоступно */
  }
  return "system";
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export const theme = createRoot(() => {
  const [choice, setChoice] = createSignal<ThemeChoice>(read());
  apply(choice());
  const set = (c: ThemeChoice) => {
    setChoice(c);
    apply(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* не страшно */
    }
  };
  const order: ThemeChoice[] = ["system", "light", "dark"];
  return { choice, set, cycle: () => set(order[(order.indexOf(choice()) + 1) % order.length]) };
});
