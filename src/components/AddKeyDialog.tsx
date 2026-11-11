import { createSignal, For, onMount, Show } from "solid-js";
import { store } from "../lib/store";

export function AddKeyDialog(props: { onClose: () => void; initial?: string }) {
  const [text, setText] = createSignal(props.initial ?? "");
  const [busy, setBusy] = createSignal(false);
  const [errors, setErrors] = createSignal<string[]>([]);
  let area!: HTMLTextAreaElement;

  onMount(() => area.focus());

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      setText((prev) => (prev ? `${prev.trim()}\n${t}` : t));
    } catch {
      setErrors(["Нет доступа к буферу обмена — вставьте ключ в поле через Ctrl+V"]);
    }
    area.focus();
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!text().trim()) return;
    setBusy(true);
    setErrors([]);
    const { added, errors } = await store.importText(text());
    setBusy(false);
    if (added && !errors.length) {
      store.flash(added === 1 ? "Ключ добавлен" : `Добавлено серверов: ${added}`);
      props.onClose();
    } else {
      if (added) store.flash(`Добавлено серверов: ${added}`);
      setErrors(errors.length ? errors : ["Новых ключей не найдено — возможно, они уже есть в списке"]);
    }
  }

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form class="panel dialog" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
        <h3>Добавить ключ</h3>
        <p class="dialog-sub">Ключ сервера или ссылка на подписку. Можно несколько — каждый с новой строки.</p>
        <textarea
          ref={area}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder="vless://…  или  https://…/sub/…"
          rows={6}
          spellcheck={false}
        />
        <Show when={errors().length}>
          <ul class="dialog-errors">
            <For each={[...new Set(errors())].slice(0, 4)}>{(e) => <li>{e}</li>}</For>
          </ul>
        </Show>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={pasteFromClipboard}>
            Вставить из буфера
          </button>
          <span class="spacer" />
          <button type="button" class="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button type="submit" class="btn accent" disabled={busy() || !text().trim()}>
            {busy() ? "Добавляю…" : "Добавить"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function AdminDialog() {
  return (
    <div class="overlay">
      <div class="panel dialog" role="alertdialog" aria-labelledby="admin-title">
        <h3 id="admin-title">Нужны права администратора</h3>
        <p class="dialog-sub">
          Режим TUN создаёт сетевой адаптер, а в Windows это можно только от имени администратора. Nebo перезапустится
          и сразу подключится.
        </p>
        <div class="dialog-actions">
          <button
            class="btn"
            onClick={() => {
              store.setNeedAdmin(false);
              store.setMode("proxy");
              store.connect();
            }}
          >
            Подключить через прокси
          </button>
          <span class="spacer" />
          <button class="btn" onClick={() => store.setNeedAdmin(false)}>
            Отмена
          </button>
          <button
            class="btn accent"
            onClick={() => {
              store.setNeedAdmin(false);
              store.relaunchAsAdmin();
            }}
          >
            Перезапустить
          </button>
        </div>
      </div>
    </div>
  );
}
