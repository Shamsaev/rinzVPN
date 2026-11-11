import { For, Show, createMemo } from "solid-js";
import { store, type Server, type Subscription } from "../lib/store";
import { IconClose, IconGauge, IconPlus, IconRefresh } from "./Icons";

const PROTO_LABEL: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "SS",
  socks: "SOCKS",
};

function fmtBytes(n?: number) {
  if (n == null) return "";
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} ГБ`;
  return `${(n / 1024 ** 2).toFixed(0)} МБ`;
}

function subMeta(sub: Subscription): string {
  const parts: string[] = [];
  const i = sub.info;
  if (i && (i.upload != null || i.download != null)) {
    const used = (i.upload ?? 0) + (i.download ?? 0);
    parts.push(i.total ? `${fmtBytes(used)} из ${fmtBytes(i.total)}` : `${fmtBytes(used)} использовано`);
  }
  if (i?.expire) {
    const d = new Date(i.expire * 1000);
    parts.push(d.getTime() < Date.now() ? "срок истёк" : `до ${d.toLocaleDateString("ru-RU")}`);
  }
  return parts.join(", ");
}

function Ping(props: { id: string }) {
  const v = () => store.pings[props.id];
  const cls = () => {
    const p = v();
    if (p === undefined || p === "…") return "ping";
    if (p === "err") return "ping bad";
    return p < 300 ? "ping good" : p < 800 ? "ping mid" : "ping bad";
  };
  const text = () => {
    const p = v();
    if (p === undefined) return "—";
    if (p === "…") return "…";
    if (p === "err") return "нет ответа";
    return `${p} мс`;
  };
  return (
    <button
      class={cls()}
      title="Проверить этот сервер"
      onClick={(e) => {
        e.stopPropagation();
        store.pingAll([props.id]);
      }}
    >
      {text()}
    </button>
  );
}

function Row(props: { server: Server; removable: boolean }) {
  const active = () => store.data.selectedId === props.server.id;
  const live = () => store.connectedId() === props.server.id && store.conn() === "on";
  return (
    <li
      class="row"
      classList={{ active: active(), live: live() }}
      onClick={() => store.select(props.server.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), store.select(props.server.id))}
      tabindex="0"
      role="option"
      aria-selected={active()}
    >
      <span class="radio" aria-hidden="true" />
      <span class="row-name">{props.server.name}</span>
      <span class="row-proto">
        {PROTO_LABEL[props.server.protocol]}
        <Show when={props.server.detail}> · {props.server.detail}</Show>
      </span>
      <Ping id={props.server.id} />
      <Show when={props.removable} fallback={<span class="row-del-space" />}>
        <button
          class="icon-btn row-del"
          title="Удалить ключ"
          aria-label={`Удалить ${props.server.name}`}
          onClick={(e) => {
            e.stopPropagation();
            store.removeServer(props.server.id);
          }}
        >
          <IconClose width={15} height={15} />
        </button>
      </Show>
    </li>
  );
}

function SubGroup(props: { sub: Subscription }) {
  const servers = createMemo(() => store.data.servers.filter((s) => s.subId === props.sub.id));
  const busy = () => store.busySubs[props.sub.id];
  return (
    <section class="group">
      <header class="group-head">
        <div class="group-title">
          <h3>{props.sub.name}</h3>
          <Show when={subMeta(props.sub)}>
            <span>{subMeta(props.sub)}</span>
          </Show>
        </div>
        <button
          class="icon-btn"
          classList={{ spinning: busy() }}
          title="Обновить подписку"
          aria-label="Обновить подписку"
          disabled={busy()}
          onClick={() =>
            store
              .refreshSubscription(props.sub.id)
              .then((n) => store.flash(`Подписка обновлена: ${n} серверов`))
              .catch(() => {})
          }
        >
          <IconRefresh />
        </button>
        <button
          class="icon-btn"
          title="Удалить подписку"
          aria-label="Удалить подписку"
          onClick={() => {
            if (confirm(`Удалить подписку «${props.sub.name}» и все её серверы?`)) store.removeSubscription(props.sub.id);
          }}
        >
          <IconClose />
        </button>
      </header>
      <Show when={props.sub.error}>
        <p class="group-error">{props.sub.error}</p>
      </Show>
      <ul class="rows" role="listbox">
        <For each={servers()}>{(s) => <Row server={s} removable={false} />}</For>
      </ul>
    </section>
  );
}

export function ServerList(props: { onAdd: () => void }) {
  const manual = createMemo(() => store.data.servers.filter((s) => !s.subId));
  const empty = () => store.data.servers.length === 0 && store.data.subs.length === 0;

  return (
    <div class="servers">
      <div class="servers-head">
        <h2>
          Серверы
          <Show when={store.data.servers.length}>
            <span class="count">{store.data.servers.length}</span>
          </Show>
        </h2>
        <Show when={!empty()}>
          <button class="btn" onClick={() => store.pingAll()} disabled={store.testing()}>
            <IconGauge classList={{ pulsing: store.testing() }} />
            {store.testing() ? "Проверяю…" : "Проверить пинг"}
          </button>
        </Show>
        <button class="btn accent" onClick={props.onAdd}>
          <IconPlus />
          Добавить
        </button>
      </div>

      <Show
        when={!empty()}
        fallback={
          <div class="panel empty">
            <p class="empty-title">Пока пусто</p>
            <p class="muted">Вставьте ключ vless://, vmess://, trojan://, ss:// или ссылку на подписку.</p>
            <button class="btn accent" onClick={props.onAdd}>
              <IconPlus />
              Добавить ключ
            </button>
            <p class="hint">
              Или скопируйте ключ и нажмите <kbd>Ctrl</kbd> + <kbd>V</kbd> в любом месте окна
            </p>
          </div>
        }
      >
        <Show when={manual().length}>
          <section class="group">
            <header class="group-head">
              <div class="group-title">
                <h3>Мои ключи</h3>
              </div>
            </header>
            <ul class="rows" role="listbox">
              <For each={manual()}>{(s) => <Row server={s} removable />}</For>
            </ul>
          </section>
        </Show>
        <For each={store.data.subs}>{(sub) => <SubGroup sub={sub} />}</For>
      </Show>
    </div>
  );
}
