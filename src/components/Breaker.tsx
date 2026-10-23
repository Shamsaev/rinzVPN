import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { store } from "../lib/store";

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const TITLES = {
  off: "Отключено",
  connecting: "Подключаюсь",
  on: "Подключено",
  stopping: "Отключаюсь",
} as const;

/** Главный переключатель: вся панель — одна большая кнопка-рубильник. */
export function Breaker() {
  const [now, setNow] = createSignal(Date.now());
  const t = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(t));

  const state = store.conn;
  const server = store.selected;
  const busy = () => state() === "connecting" || state() === "stopping";

  const hint = createMemo(() => {
    if (state() === "on" && store.startedAt()) return fmtDuration(now() - store.startedAt()!);
    if (state() === "connecting") return "Запускаю ядро…";
    if (!server()) return "Добавьте ключ, чтобы подключиться";
    return "Нажмите, чтобы подключиться";
  });

  return (
    <button
      class="breaker"
      data-state={state()}
      onClick={() => store.toggle()}
      disabled={busy() || (!server() && state() === "off")}
      aria-pressed={state() === "on"}
      aria-label={state() === "on" ? "Отключить" : "Подключить"}
    >
      <div class="breaker-text">
        <div class="breaker-title">
          <span class="lamp" aria-hidden="true" />
          {TITLES[state()]}
        </div>
        <div class="breaker-hint">{hint()}</div>
        <Show when={server()}>
          <div class="breaker-server" title={server()!.name}>
            {server()!.name}
            <span class="breaker-mode">{store.data.mode === "tun" ? "весь трафик" : "системный прокси"}</span>
          </div>
        </Show>
      </div>
      <div class="lever" aria-hidden="true">
        <div class="lever-knob" />
      </div>
    </button>
  );
}
