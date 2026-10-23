import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { store } from "./lib/store";
import type { Mode } from "./lib/api";
import { Breaker } from "./components/Breaker";
import { ServerList } from "./components/ServerList";
import { AddKeyDialog, AdminDialog } from "./components/AddKeyDialog";
import { LogPanel } from "./components/LogPanel";

const KEYISH = /(vless|vmess|trojan|ss|socks5?|hy2|hysteria2|happ):\/\/|https?:\/\//i;

export default function App() {
  const [adding, setAdding] = createSignal<false | { initial?: string }>(false);
  const [logsOpen, setLogsOpen] = createSignal(false);

  onMount(() => {
    store.init();

    // Ctrl+V в любом месте окна — сразу импорт ключа (как в Happ)
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
      <header class="top">
        <h1 class="wordmark">
          rinz<span>VPN</span>
        </h1>
        <div class="modes" role="radiogroup" aria-label="Режим">
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
      </header>

      <Breaker />

      <Show when={store.error()}>
        <div class="alert" role="alert">
          <p>{store.error()}</p>
          <div class="alert-actions">
            <button class="ghost-btn small" onClick={() => setLogsOpen(true)}>
              Открыть журнал
            </button>
            <button class="ghost-btn small" onClick={() => store.setError(null)}>
              Скрыть
            </button>
          </div>
        </div>
      </Show>

      <main class="scroll">
        <ServerList onAdd={() => setAdding({})} />
      </main>

      <LogPanel open={logsOpen()} onToggle={() => setLogsOpen(!logsOpen())} />

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
