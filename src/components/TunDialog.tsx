import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js";
import { api, type AppInfo } from "../lib/api";
import type { TunScope } from "../lib/config";
import { store, type TunApp } from "../lib/store";
import { IconClose, IconPlus } from "./Icons";

const SCOPES: { id: TunScope; label: string; hint: string }[] = [
  { id: "all", label: "Весь трафик", hint: "Все программы компьютера идут через сервер." },
  { id: "only", label: "Только выбранные", hint: "Через сервер идут только программы из списка, остальное напрямую." },
  {
    id: "except",
    label: "Все, кроме выбранных",
    hint: "Программы из списка идут напрямую, например игры или банковские приложения.",
  },
];

const normName = (n: string) => {
  const t = n.trim().split(/[\\/]/).pop() ?? "";
  return t && !/\.exe$/i.test(t) ? `${t}.exe` : t;
};

/** Настройки TUN: какие программы идут через туннель. */
export function TunDialog(props: { onClose: () => void }) {
  const [scope, setScope] = createSignal<TunScope>(store.data.tun.scope);
  const [apps, setApps] = createSignal<TunApp[]>([...store.data.tun.apps]);
  const [picking, setPicking] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [manual, setManual] = createSignal("");
  const [running, { refetch }] = createResource(picking, () => api.listApps());
  let first!: HTMLButtonElement;
  onMount(() => first?.focus());

  const has = (name: string) => apps().some((a) => a.name.toLowerCase() === name.toLowerCase());
  const add = (a: TunApp) => {
    if (!a.name || has(a.name)) return;
    setApps([...apps(), a]);
  };
  const remove = (name: string) => setApps(apps().filter((a) => a.name !== name));

  const list = createMemo(() => {
    const q = query().trim().toLowerCase();
    const items = (running() ?? []).filter(
      (a: AppInfo) => !q || a.name.toLowerCase().includes(q) || (a.title ?? "").toLowerCase().includes(q),
    );
    // сначала программы с окнами, потом фоновые
    return items.sort((a, b) => Number(b.has_window) - Number(a.has_window) || a.name.localeCompare(b.name));
  });

  const needApps = () => scope() !== "all" && apps().length === 0;

  function save() {
    store.setTun({ scope: scope(), apps: apps() });
    store.flash("Настройки TUN сохранены");
    props.onClose();
  }

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel dialog wide" role="dialog" aria-labelledby="tun-title" onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
        <h3 id="tun-title">Режим TUN</h3>
        <p class="dialog-sub">Выберите, какие программы пускать через сервер.</p>

        <div class="choices" role="radiogroup" aria-label="Что идёт через сервер">
          <For each={SCOPES}>
            {(s, i) => (
              <button
                ref={(el) => i() === 0 && (first = el)}
                role="radio"
                aria-checked={scope() === s.id}
                class="choice"
                classList={{ on: scope() === s.id }}
                onClick={() => setScope(s.id)}
              >
                <span class="choice-dot" aria-hidden="true" />
                <span>
                  <span class="choice-label">{s.label}</span>
                  <span class="choice-hint">{s.hint}</span>
                </span>
              </button>
            )}
          </For>
        </div>

        <Show when={scope() !== "all"}>
          <div class="apps">
            <div class="apps-head">
              <h4>Программы</h4>
              <button class="btn small" onClick={() => setPicking(!picking())}>
                {picking() ? "Скрыть список" : "Выбрать из запущенных"}
              </button>
            </div>

            <Show when={apps().length} fallback={<p class="muted small">Список пуст. Добавьте программу из запущенных или по имени файла.</p>}>
              <ul class="app-chips">
                <For each={apps()}>
                  {(a) => (
                    <li class="chip">
                      <span class="chip-title">{a.title || a.name}</span>
                      <Show when={a.title}>
                        <span class="chip-name">{a.name}</span>
                      </Show>
                      <button class="chip-x" aria-label={`Убрать ${a.name}`} onClick={() => remove(a.name)}>
                        <IconClose width={13} height={13} />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <form
              class="manual"
              onSubmit={(e) => {
                e.preventDefault();
                const n = normName(manual());
                if (n) add({ name: n });
                setManual("");
              }}
            >
              <input
                value={manual()}
                onInput={(e) => setManual(e.currentTarget.value)}
                placeholder="Имя файла, например Discord.exe"
                spellcheck={false}
                aria-label="Имя exe-файла программы"
              />
              <button class="btn small" type="submit" disabled={!manual().trim()}>
                <IconPlus width={14} height={14} />
                Добавить
              </button>
            </form>

            <Show when={picking()}>
              <div class="picker">
                <div class="picker-bar">
                  <input
                    value={query()}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                    placeholder="Поиск по запущенным программам"
                    aria-label="Поиск"
                  />
                  <button class="btn small" onClick={() => refetch()}>
                    Обновить
                  </button>
                </div>
                <Show when={!running.loading} fallback={<p class="muted small pad">Загружаю список…</p>}>
                  <Show when={!running.error} fallback={<p class="small pad bad">{String(running.error)}</p>}>
                    <ul class="picker-list">
                      <For each={list()} fallback={<li class="muted small pad">Ничего не найдено</li>}>
                        {(a) => (
                          <li>
                            <button
                              class="picker-item"
                              disabled={has(a.name)}
                              title={a.path ?? a.name}
                              onClick={() => add({ name: a.name, title: a.title ?? undefined })}
                            >
                              <span class="picker-title">{a.title || a.name}</span>
                              <span class="picker-name">{a.name}</span>
                              <span class="picker-add">{has(a.name) ? "В списке" : "Добавить"}</span>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Show>
              </div>
            </Show>

            <p class="note">
              Программы запоминаются по имени файла, поэтому после их обновления добавлять заново не нужно.
            </p>
          </div>
        </Show>

        <div class="dialog-actions">
          <Show when={needApps()}>
            <span class="small warn-text">Добавьте хотя бы одну программу, иначе пойдёт весь трафик</span>
          </Show>
          <span class="spacer" />
          <button class="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button class="btn accent" onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
