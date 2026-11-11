import { For, Show, createMemo } from "solid-js";
import { store, type Server, type Subscription } from "../lib/store";
import { IconClose, IconGauge, IconLink, IconPlus, IconRefresh } from "./Icons";
import { days, fmtAgo, fmtBytes, fmtDate, usage } from "../lib/format";
import { api } from "../lib/api";

const PROTO_LABEL: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "SS",
  socks: "SOCKS",
};

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

function SubInfo(props: { sub: Subscription }) {
  const u = createMemo(() => usage(props.sub.info));
  return (
    <div class="sub-info">
      <Show when={props.sub.announce}>
        <p class="announce">{props.sub.announce}</p>
      </Show>
      <Show
        when={u()}
        fallback={<p class="muted small">Провайдер не передаёт данные о трафике и сроке действия.</p>}
      >
        {(x) => (
          <>
            <Show when={x().hasTraffic}>
              <div class="meter" classList={{ warn: (x().ratio ?? 0) >= 0.9 }}>
                <div class="meter-fill" style={{ width: `${Math.max(2, (x().ratio ?? 0) * 100)}%` }} />
              </div>
              <div class="sub-line">
                <span>
                  Использовано <b>{fmtBytes(x().used)}</b>
                  {x().total ? ` из ${fmtBytes(x().total!)}` : ""}
                </span>
                <span>{x().left != null ? <>Осталось <b>{fmtBytes(x().left!)}</b></> : <b>Безлимит</b>}</span>
              </div>
            </Show>
            <div class="sub-line" classList={{ warn: x().warn, bad: x().expired }}>
              <span>
                {x().expireAt
                  ? x().expired
                    ? `Срок истёк ${fmtDate(x().expireAt!)}`
                    : `Действует до ${fmtDate(x().expireAt!)}`
                  : "Бессрочно"}
              </span>
              <Show when={x().daysLeft != null && !x().expired}>
                <span>Ещё {days(x().daysLeft!)}</span>
              </Show>
            </div>
          </>
        )}
      </Show>
      <p class="sub-updated">Обновлено {fmtAgo(props.sub.updatedAt)}</p>
    </div>
  );
}

function SubGroup(props: { sub: Subscription }) {
  const servers = createMemo(() => store.data.servers.filter((s) => s.subId === props.sub.id));
  const busy = () => store.busySubs[props.sub.id];
  const open = (url: string) => api.openUrl(url).catch((e) => store.setError(String(e)));
  return (
    <section class="group">
      <header class="group-head">
        <div class="group-title">
          <h3>{props.sub.name}</h3>
        </div>
        <Show when={props.sub.webPageUrl}>
          <button class="btn small" onClick={() => open(props.sub.webPageUrl!)}>
            <IconLink width={14} height={14} />
            Сайт
          </button>
        </Show>
        <Show when={props.sub.supportUrl}>
          <button class="btn small" onClick={() => open(props.sub.supportUrl!)}>
            Поддержка
          </button>
        </Show>
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
      <SubInfo sub={props.sub} />
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
