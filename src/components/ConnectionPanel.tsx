import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { store } from "../lib/store";

const PROTO: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  socks: "SOCKS",
};

const STATUS = {
  off: "Не подключено",
  connecting: "Подключение…",
  on: "Подключено",
  stopping: "Отключение…",
} as const;

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ""}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Левая панель: состояние, выбранный сервер и одна кнопка. */
export function ConnectionPanel() {
  const [now, setNow] = createSignal(Date.now());
  const t = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(t));

  const state = store.conn;
  const server = store.selected;
  const busy = () => state() === "connecting" || state() === "stopping";
  const ping = () => (server() ? store.pings[server()!.id] : undefined);

  const uptime = createMemo(() =>
    state() === "on" && store.startedAt() ? fmtDuration(now() - store.startedAt()!) : null,
  );

  return (
    <aside class="panel conn" data-state={state()}>
      <div class="conn-status">
        <span class="dot" aria-hidden="true" />
        {STATUS[state()]}
        <Show when={uptime()}>
          <span class="conn-time">{uptime()}</span>
        </Show>
      </div>

      <Show
        when={server()}
        fallback={
          <div class="conn-empty">
            <p class="conn-name">Сервер не выбран</p>
            <p class="muted">Добавьте ключ или подписку, и сервер появится в списке справа.</p>
          </div>
        }
      >
        {(s) => (
          <div class="conn-server">
            <p class="conn-name" title={s().name}>
              {s().name}
            </p>
            <dl class="facts">
              <div>
                <dt>Протокол</dt>
                <dd>
                  {PROTO[s().protocol]}
                  <Show when={s().detail}> · {s().detail}</Show>
                </dd>
              </div>
              <div>
                <dt>Режим</dt>
                <dd>{store.data.mode === "tun" ? "Весь трафик (TUN)" : "Системный прокси"}</dd>
              </div>
              <Show when={typeof ping() === "number"}>
                <div>
                  <dt>Задержка</dt>
                  <dd>{ping()} мс</dd>
                </div>
              </Show>
            </dl>
          </div>
        )}
      </Show>

      <button
        class="conn-btn"
        classList={{ on: state() === "on" }}
        onClick={() => store.toggle()}
        disabled={busy() || (!server() && state() === "off")}
      >
        {state() === "on" ? "Отключить" : state() === "connecting" ? "Подключаю…" : state() === "stopping" ? "Отключаю…" : "Подключить"}
      </button>
    </aside>
  );
}
