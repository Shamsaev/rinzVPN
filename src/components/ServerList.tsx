import { For, Show, createMemo } from "solid-js";
import { store, type Server, type Subscription } from "../lib/store";

const PROTO_LABEL: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
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
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    parts.push(days < 0 ? "срок истёк" : `до ${d.toLocaleDateString("ru-RU")}`);
  }
  return parts.join(", ");
}

function PingBadge(props: { id: string }) {
  const v = () => store.pings[props.id];
  const cls = () => {
    const p = v();
    if (p === undefined || p === "…") return "ping";
    if (p === "err") return "ping bad";
    return p < 150 ? "ping good" : p < 400 ? "ping mid" : "ping bad";
  };
  return (
    <span class={cls()}>
      {(() => {
        const p = v();
        if (p === undefined) return "";
        if (p === "…") return "…";
        if (p === "err") return "нет связи";
        return `${p} мс`;
      })()}
    </span>
  );
}

function Row(props: { server: Server; removable: boolean }) {
  const active = () => store.data.selectedId === props.server.id;
  const live = () => store.connectedId() === props.server.id && store.conn() === "on";
  return (
    <li class="row" classList={{ active: active(), live: live(), removable: props.removable }}>
      <button class="row-main" onClick={() => store.select(props.server.id)} aria-current={active()}>
        <span class="radio" aria-hidden="true" />
        <span class="row-text">
          <span class="row-name">{props.server.name}</span>
          <span class="row-proto">
            {PROTO_LABEL[props.server.protocol]}
            <Show when={props.server.detail}> {props.server.detail}</Show>
          </span>
        </span>
        <PingBadge id={props.server.id} />
      </button>
      <Show when={props.removable}>
        <button
          class="icon-btn row-del"
          title="Удалить ключ"
          aria-label={`Удалить ${props.server.name}`}
          onClick={() => store.removeServer(props.server.id)}
        >
          ×
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
          <span>{props.sub.name}</span>
          <Show when={subMeta(props.sub)}>
            <small>{subMeta(props.sub)}</small>
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
          ⟳
        </button>
        <button
          class="icon-btn"
          title="Удалить подписку"
          aria-label="Удалить подписку"
          onClick={() => {
            if (confirm(`Удалить подписку «${props.sub.name}» и все её серверы?`)) store.removeSubscription(props.sub.id);
          }}
        >
          ×
        </button>
      </header>
      <Show when={props.sub.error}>
        <p class="group-error">{props.sub.error}</p>
      </Show>
      <ul class="rows">
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
        <h2>Серверы</h2>
        <Show when={!empty()}>
          <button class="ghost-btn" onClick={() => store.pingAll()}>
            Проверить пинг
          </button>
        </Show>
        <button class="add-btn" onClick={props.onAdd}>
          + Ключ
        </button>
      </div>

      <Show
        when={!empty()}
        fallback={
          <div class="empty">
            <p class="empty-title">Здесь появятся ваши серверы</p>
            <p>Вставьте ключ vless://, vmess://, trojan://, ss:// или ссылку на подписку.</p>
            <button class="primary-btn" onClick={props.onAdd}>
              Добавить ключ
            </button>
            <p class="empty-kbd">
              или скопируйте ключ и нажмите <kbd>Ctrl</kbd> + <kbd>V</kbd> прямо здесь
            </p>
          </div>
        }
      >
        <Show when={manual().length}>
          <section class="group">
            <header class="group-head">
              <div class="group-title">
                <span>Мои ключи</span>
              </div>
            </header>
            <ul class="rows">
              <For each={manual()}>{(s) => <Row server={s} removable />}</For>
            </ul>
          </section>
        </Show>
        <For each={store.data.subs}>{(sub) => <SubGroup sub={sub} />}</For>
      </Show>
    </div>
  );
}
