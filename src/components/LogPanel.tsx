import { createEffect, For, Show } from "solid-js";
import { store } from "../lib/store";
import { IconClose } from "./Icons";

/** Журнал ядер: выезжает снизу по кнопке в шапке. */
export function LogPanel(props: { onClose: () => void }) {
  let box: HTMLDivElement | undefined;

  createEffect(() => {
    store.logs();
    queueMicrotask(() => box && (box.scrollTop = box.scrollHeight));
  });

  return (
    <section class="panel logs" aria-label="Журнал">
      <header class="logs-head">
        <h2>Журнал</h2>
        <button
          class="btn small"
          onClick={() => navigator.clipboard.writeText(store.logs().map((l) => `[${l.source}] ${l.line}`).join("\n"))}
        >
          Копировать
        </button>
        <button class="btn small" onClick={() => store.clearLogs()}>
          Очистить
        </button>
        <button class="icon-btn" title="Закрыть журнал" aria-label="Закрыть журнал" onClick={props.onClose}>
          <IconClose />
        </button>
      </header>
      <div class="logs-body" ref={box}>
        <Show when={store.logs().length} fallback={<p class="muted">Здесь появятся сообщения ядер после подключения.</p>}>
          <For each={store.logs()}>
            {(l) => (
              <div class="log-line">
                <span class="log-src">{l.source}</span>
                {l.line}
              </div>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
