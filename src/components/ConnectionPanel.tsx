import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { store } from "../lib/store";
import { days, fmtBytes, usage } from "../lib/format";

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

const SCOPE_TEXT = { all: "весь трафик", only: "выбранные программы", except: "все, кроме выбранных" } as const;

/** Левая панель: состояние, выбранный сервер и одна кнопка. */
export function ConnectionPanel(props: { onTunSettings: () => void }) {
  const [now, setNow] = createSignal(Date.now());
  const t = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(t));

  const state = store.conn;
  const server = store.selected;
  const busy = () => state() === "connecting" || state() === "stopping";
  const ping = () => (server() ? store.pings[server()!.id] : undefined);
  const subLeft = createMemo(() => {
    const s = server();
    const sub = s?.subId ? store.data.subs.find((x) => x.id === s.subId) : undefined;
    const u = usage(sub?.info);
    if (!u) return null;
    const parts: string[] = [];
    if (u.left != null) parts.push(fmtBytes(u.left));
    else if (u.hasTraffic) parts.push("безлимит");
    if (u.expired) parts.push("срок истёк");
    else if (u.daysLeft != null) parts.push(days(u.daysLeft));
    return parts.length ? { text: parts.join(" · "), warn: u.warn } : null;
  });

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
                <dd>
                  <Show when={store.data.mode === "tun"} fallback="Системный прокси">
                    <button class="link" onClick={props.onTunSettings} title="Настроить TUN">
                      TUN: {SCOPE_TEXT[store.data.tun.apps.length ? store.data.tun.scope : "all"]}
                    </button>
                  </Show>
                </dd>
              </div>
              <Show when={subLeft()}>
                <div>
                  <dt>Осталось</dt>
                  <dd classList={{ "warn-text": subLeft()!.warn }}>{subLeft()!.text}</dd>
                </div>
              </Show>
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
