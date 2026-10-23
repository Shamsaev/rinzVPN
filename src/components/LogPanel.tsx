import { createEffect, For, Show } from "solid-js";
import { store } from "../lib/store";

export function LogPanel(props: { open: boolean; onToggle: () => void }) {
  let box: HTMLDivElement | undefined;

  createEffect(() => {
    store.logs();
    if (props.open && box) queueMicrotask(() => box && (box.scrollTop = box.scrollHeight));
  });

  return (
    <div class="logs" classList={{ open: props.open }}>
      <div class="logs-bar">
        <button class="logs-toggle" onClick={props.onToggle} aria-expanded={props.open}>
          Журнал {props.open ? "▾" : "▸"}
          <Show when={!props.open && store.logs().length}>
            <span class="logs-count">{store.logs().length}</span>
          </Show>
        </button>
        <Show when={props.open}>
          <button
            class="ghost-btn small"
            onClick={() => navigator.clipboard.writeText(store.logs().map((l) => `[${l.source}] ${l.line}`).join("\n"))}
          >
            Копировать
          </button>
          <button class="ghost-btn small" onClick={() => store.clearLogs()}>
            Очистить
          </button>
        </Show>
      </div>
      <Show when={props.open}>
        <div class="logs-body" ref={box}>
          <Show when={store.logs().length} fallback={<p class="logs-empty">Сообщения ядер появятся здесь после подключения.</p>}>
            <For each={store.logs()}>
              {(l) => (
                <div class="log-line" data-src={l.source}>
                  <span class="log-src">{l.source}</span>
                  {l.line}
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
