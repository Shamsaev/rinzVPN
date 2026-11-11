// Обёртки над командами Rust. Вне Tauri (обычный браузер, `npm run dev`)
// подменяются заглушками — удобно верстать интерфейс без сборки приложения.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Mode = "proxy" | "tun";

export interface CoreStatus {
  running: boolean;
  mode: Mode | null;
  started_at: number | null;
}

export interface LogLine {
  ts: number;
  source: string;
  line: string;
}

export interface SubscriptionResponse {
  body: string;
  userinfo: string | null;
  title: string | null;
  update_interval: string | null;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const mock = {
  running: false,
  mode: null as Mode | null,
  started: null as number | null,
};

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (inTauri) return invoke<T>(cmd, args);
  return mockInvoke(cmd, args) as Promise<T>;
}

async function mockInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 250));
  switch (cmd) {
    case "connect":
      mock.running = true;
      mock.mode = args?.mode as Mode;
      mock.started = Date.now();
      return { running: true, mode: mock.mode, started_at: mock.started };
    case "disconnect":
      mock.running = false;
      return null;
    case "status":
      return { running: mock.running, mode: mock.mode, started_at: mock.started };
    case "is_elevated":
      return false;
    case "launch_args":
    case "get_logs":
      return [];
    case "tcp_ping":
      return 40 + Math.round(Math.random() * 300);
    case "free_ports":
      return Array.from({ length: Number(args?.count ?? 1) }, (_, i) => 20000 + i);
    case "url_test":
      await new Promise((r) => setTimeout(r, 900));
      return (args?.ports as number[]).map(() => (Math.random() < 0.15 ? null : 90 + Math.round(Math.random() * 500)));
    case "resolve_host":
      return "203.0.113.10";
    case "fetch_subscription":
      throw "В браузерном превью подписки не загружаются";
    default:
      return null;
  }
}

function on<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<T>(event, (e) => cb(e.payload));
}

export const api = {
  connect: (mode: Mode, xrayConfig: string, singboxConfig: string | undefined, httpPort: number) =>
    call<CoreStatus>("connect", { mode, xrayConfig, singboxConfig: singboxConfig ?? null, httpPort }),
  freePorts: (count: number) => call<number[]>("free_ports", { count }),
  urlTest: (config: string, ports: number[]) => call<(number | null)[]>("url_test", { config, ports }),
  disconnect: () => call<void>("disconnect"),
  status: () => call<CoreStatus>("status"),
  getLogs: () => call<LogLine[]>("get_logs"),
  clearLogs: () => call<void>("clear_logs"),
  isElevated: () => call<boolean>("is_elevated"),
  launchArgs: () => call<string[]>("launch_args"),
  relaunchAsAdmin: (connectAfter: boolean) => call<void>("relaunch_as_admin", { connectAfter }),
  setTrayState: (connected: boolean, server?: string) =>
    call<void>("set_tray_state", { connected, server: server ?? null }),
  tcpPing: (host: string, port: number) => call<number>("tcp_ping", { host, port }),
  resolveHost: (host: string) => call<string>("resolve_host", { host }),
  fetchSubscription: (url: string) => call<SubscriptionResponse>("fetch_subscription", { url }),

  onLog: (cb: (l: LogLine) => void) => on<LogLine>("core-log", cb),
  onStopped: (cb: (p: { reason: string | null }) => void) => on("core-stopped", cb),
  onTrayToggle: (cb: () => void) => on("tray-toggle", cb),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
