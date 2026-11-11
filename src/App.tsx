import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { store } from "./lib/store";
import { theme } from "./lib/theme";
import { APP_NAME } from "./lib/brand";
import type { Mode } from "./lib/api";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { ServerList } from "./components/ServerList";
import { AddKeyDialog, AdminDialog } from "./components/AddKeyDialog";
import { LogPanel } from "./components/LogPanel";
import { IconAuto, IconLog, IconMoon, IconSun } from "./components/Icons";

const KEYISH = /(vless|vmess|trojan|ss|socks5?|hy2|hysteria2|happ):\/\/|https?:\/\//i;

const THEME_LABEL = { system: "Тема: как в системе", light: "Тема: светлая", dark: "Тема: тёмная" } as const;

export default function App() {
  const [adding, setAdding] = createSignal<false | { initial?: string }>(false);
  const [logsOpen, setLogsOpen] = createSignal(false);

  onMount(() => {
    store.init();

    // Ctrl+V в любом месте окна — сразу импорт ключа
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!KEYISH.test(text)) return;
      e.preventDefault();
      store.importText(text).then(({ added, errors }) => {
        if (added) store.flash(added === 1 ? "Ключ добавлен" : `Добавлено серверов: ${added}`);
        else if (errors.length) setAdding({ initial: text });
      });
    };
    document.addEventListener("paste", onPaste);
    onCleanup(() => document.removeEventListener("paste", onPaste));
  });

  const modes: { id: Mode; label: string; title: string }[] = [
    { id: "proxy", label: "Прокси", title: "Системный прокси: браузеры и большинство программ" },
    { id: "tun", label: "TUN", title: "Весь трафик компьютера, включая игры. Нужны права администратора" },
  ];

  return (
    <div class="app">
      <div class="backdrop" aria-hidden="true">
        <span class="blob b1" />
        <span class="blob b2" />
        <span class="blob b3" />
      </div>

      <header class="top">
        <div class="brand">
          <span class="brand-mark" data-on={store.conn() === "on"} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                fill="currentColor"
                d="M7 18.5a4 4 0 0 1-.6-7.96 5.5 5.5 0 0 1 10.7-.9A4.25 4.25 0 0 1 17.25 18.5Z"
              />
            </svg>
          </span>
          {APP_NAME}
        </div>
        <div class="top-actions">
          <div class="segmented" role="radiogroup" aria-label="Режим">
            {modes.map((m) => (
              <button
                role="radio"
                aria-checked={store.data.mode === m.id}
                classList={{ on: store.data.mode === m.id }}
                title={m.title}
                disabled={store.conn() === "connecting" || store.conn() === "stopping"}
                onClick={() => store.setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button class="icon-btn" title={THEME_LABEL[theme.choice()]} aria-label={THEME_LABEL[theme.choice()]} onClick={theme.cycle}>
            {theme.choice() === "light" ? <IconSun /> : theme.choice() === "dark" ? <IconMoon /> : <IconAuto />}
          </button>
          <button
            class="icon-btn"
            classList={{ pressed: logsOpen() }}
            title="Журнал"
            aria-label="Журнал"
            aria-pressed={logsOpen()}
            onClick={() => setLogsOpen(!logsOpen())}
          >
            <IconLog />
          </button>
        </div>
      </header>

      <div class="layout">
        <div class="side">
          <ConnectionPanel />
          <Show when={store.error()}>
            <div class="panel alert" role="alert">
              <p>{store.error()}</p>
              <div class="alert-actions">
                <button class="btn small" onClick={() => setLogsOpen(true)}>
                  Открыть журнал
                </button>
                <button class="btn small" onClick={() => store.setError(null)}>
                  Скрыть
                </button>
              </div>
            </div>
          </Show>
        </div>
        <main class="main">
          <ServerList onAdd={() => setAdding({})} />
        </main>
      </div>

      <Show when={logsOpen()}>
        <LogPanel onClose={() => setLogsOpen(false)} />
      </Show>

      <Show when={store.notice()}>
        <div class="toast" role="status">
          {store.notice()}
        </div>
      </Show>

      <Show when={adding()}>
        {(a) => <AddKeyDialog initial={a().initial} onClose={() => setAdding(false)} />}
      </Show>
      <Show when={store.needAdmin()}>
        <AdminDialog />
      </Show>
    </div>
  );
}
