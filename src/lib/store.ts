// Состояние приложения: серверы, подписки, подключение.

import { batch, createMemo, createRoot, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { api, errorText, inTauri, type LogLine, type Mode } from "./api";
import {
  isIp,
  parseLink,
  parseProfileTitle,
  parseSubscriptionBody,
  parseUserInfoHeader,
  parseUserInput,
  type Protocol,
  type SubscriptionInfo,
} from "./parser";
import { buildSingboxConfig, buildTestConfig, buildXrayConfig, pinServerAddress, type TunScope } from "./config";

export interface Server {
  id: string;
  name: string;
  link: string;
  protocol: Protocol;
  address: string;
  port: number;
  /** id подписки; нет — значит ключ добавлен вручную */
  subId?: string;
  /** "reality", "ws" и т.п. — для подписи в списке */
  detail?: string;
}

export interface Subscription {
  id: string;
  url: string;
  name: string;
  info?: SubscriptionInfo;
  updatedAt: number;
  error?: string;
  supportUrl?: string;
  webPageUrl?: string;
  announce?: string;
  /** как часто обновлять, часы (заголовок profile-update-interval) */
  refreshHours?: number;
}

export interface TunApp {
  /** имя exe-файла: по нему и маршрутизируем, поэтому обновления программы не мешают */
  name: string;
  title?: string;
}

export interface TunSettings {
  scope: TunScope;
  apps: TunApp[];
}

interface Persisted {
  servers: Server[];
  subs: Subscription[];
  selectedId?: string;
  mode: Mode;
  tun: TunSettings;
}

export type ConnState = "off" | "connecting" | "on" | "stopping";

const STORAGE_KEY = "nebo.v1";
const SUB_REFRESH_MS = 6 * 60 * 60 * 1000;
const refreshMs = (s: Subscription) => (s.refreshHours ? s.refreshHours * 3600 * 1000 : SUB_REFRESH_MS);

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { servers: [], subs: [], mode: "proxy", tun: { scope: "all", apps: [] }, ...JSON.parse(raw) };
  } catch {
    /* повреждённое хранилище — начинаем с нуля */
  }
  return { servers: [], subs: [], mode: "proxy", tun: { scope: "all", apps: [] } };
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function describe(outbound: Record<string, any>): string {
  const s = outbound.streamSettings;
  if (!s) return "";
  const parts = [s.network !== "raw" ? s.network : "", s.security === "reality" ? "reality" : s.security === "tls" ? "tls" : ""];
  return parts.filter(Boolean).join(" + ");
}

function toServer(link: string, subId?: string): Server {
  const p = parseLink(link);
  return {
    id: uid(),
    name: p.name,
    link,
    protocol: p.protocol,
    address: p.address,
    port: p.port,
    subId,
    detail: describe(p.outbound),
  };
}

function createAppStore() {
  const [data, setData] = createStore<Persisted>(load());
  const [conn, setConn] = createSignal<ConnState>("off");
  const [startedAt, setStartedAt] = createSignal<number | null>(null);
  const [connectedId, setConnectedId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [needAdmin, setNeedAdmin] = createSignal(false);
  const [pings, setPings] = createStore<Record<string, number | "err" | "…">>({});
  const [logs, setLogs] = createSignal<LogLine[]>([]);
  const [busySubs, setBusySubs] = createStore<Record<string, boolean>>({});
  const [testing, setTesting] = createSignal(false);

  const persist = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          servers: data.servers,
          subs: data.subs,
          selectedId: data.selectedId,
          mode: data.mode,
          tun: data.tun,
        }),
      );
    } catch {
      /* нет места или хранилище недоступно */
    }
  };

  const selected = createMemo(() => data.servers.find((s) => s.id === data.selectedId));

  let noticeTimer: number | undefined;
  function flash(text: string) {
    setNotice(text);
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => setNotice(null), 3500);
  }

  // ---------- подключение ----------

  async function connect() {
    const server = selected();
    if (!server) {
      setError("Сначала добавьте ключ и выберите сервер");
      return;
    }
    if (conn() === "connecting" || conn() === "stopping") return;
    setError(null);
    setConn("connecting");
    try {
      const parsed = parseLink(server.link);
      let outbound = parsed.outbound;
      let singbox: string | undefined;
      if (data.mode === "tun") {
        if (!(await api.isElevated())) {
          setNeedAdmin(true);
          setConn("off");
          return;
        }
        if (!isIp(parsed.address)) {
          outbound = pinServerAddress(outbound, await api.resolveHost(parsed.address));
        }
      }
      // свободные порты: 10808 может быть занят другим клиентом (Happ, v2rayN)
      const [socksPort, httpPort] = await api.freePorts(2);
      if (data.mode === "tun") singbox = JSON.stringify(buildSingboxConfig({ socksPort, scope: data.tun.scope, apps: data.tun.apps.map((a) => a.name) }), null, 2);
      const xray = JSON.stringify(
        buildXrayConfig(outbound, { socksPort, httpPort, extraOutbounds: parsed.extraOutbounds }),
        null,
        2,
      );
      // в режимах с выбором программ показываем в журнале, какая программа куда пошла
      const verbose = data.mode === "tun" && data.tun.scope !== "all" && data.tun.apps.length > 0;
      const st = await api.connect(data.mode, xray, singbox, httpPort, verbose);
      batch(() => {
        setConn("on");
        setStartedAt(st.started_at ?? Date.now());
        setConnectedId(server.id);
      });
      api.setTrayState(true, server.name).catch(() => {});
    } catch (e) {
      const msg = errorText(e);
      setConn("off");
      if (msg === "NEED_ADMIN") setNeedAdmin(true);
      else setError(msg);
    }
  }

  async function disconnect() {
    if (conn() !== "on") return;
    setConn("stopping");
    try {
      await api.disconnect();
    } finally {
      markStopped();
    }
  }

  function markStopped() {
    batch(() => {
      setConn("off");
      setStartedAt(null);
      setConnectedId(null);
    });
    api.setTrayState(false).catch(() => {});
  }

  const toggle = () => (conn() === "on" ? disconnect() : connect());

  /** Если уже подключены — переподключаемся с новыми настройками. */
  async function reconnectIfOn() {
    if (conn() !== "on") return;
    await api.disconnect().catch(() => {});
    markStopped();
    await connect();
  }

  function select(id: string) {
    if (data.selectedId === id) return;
    setData("selectedId", id);
    persist();
    reconnectIfOn();
  }

  function setMode(mode: Mode) {
    if (data.mode === mode) return;
    setData("mode", mode);
    persist();
    reconnectIfOn();
  }

  /** Сохраняет настройки TUN; если сейчас подключены в TUN — переподключаемся. */
  function setTun(next: TunSettings) {
    setData("tun", reconcile(next));
    persist();
    if (data.mode === "tun") reconnectIfOn();
  }

  // ---------- серверы и подписки ----------

  async function importText(text: string): Promise<{ added: number; errors: string[] }> {
    const res = parseUserInput(text);
    const errors = res.errors.map((e) => e.message);
    const known = new Set(data.servers.map((s) => s.link));
    const fresh = res.links.filter((l) => !known.has(l.link)).map((l) => toServer(l.link));
    let added = fresh.length;
    if (fresh.length) {
      setData("servers", (list) => [...fresh, ...list]);
    }
    for (const url of res.subscriptions) {
      if (data.subs.some((s) => s.url === url)) {
        errors.push("Эта подписка уже добавлена");
        continue;
      }
      try {
        added += await addSubscription(url);
      } catch (e) {
        errors.push(errorText(e));
      }
    }
    if (!data.selectedId && data.servers.length) setData("selectedId", data.servers[0].id);
    persist();
    if (added) pingAll();
    return { added, errors };
  }

  async function addSubscription(url: string): Promise<number> {
    const id = uid();
    const sub: Subscription = { id, url, name: hostOf(url), updatedAt: 0 };
    setData("subs", (s) => [...s, sub]);
    try {
      return await refreshSubscription(id);
    } catch (e) {
      // не смогли загрузить с первого раза — подписку не оставляем
      setData("subs", (s) => s.filter((x) => x.id !== id));
      throw e;
    }
  }

  async function refreshSubscription(id: string): Promise<number> {
    const sub = data.subs.find((s) => s.id === id);
    if (!sub) return 0;
    setBusySubs(id, true);
    try {
      const resp = await api.fetchSubscription(sub.url);
      const parsed = parseSubscriptionBody(resp.body);
      if (!parsed.links.length) {
        throw new Error(
          parsed.errors.length
            ? `В подписке нет поддерживаемых ключей (${parsed.errors[0].message})`
            : "Подписка пустая или в неизвестном формате",
        );
      }
      // сохраняем выбор, если такой же ключ остался в подписке
      const selectedLink = selected()?.subId === id ? selected()?.link : undefined;
      const servers = parsed.links.map((l) => toServer(l.link, id));
      batch(() => {
        setData("servers", (list) => [...list.filter((s) => s.subId !== id), ...servers]);
        const i = data.subs.findIndex((s) => s.id === id);
        setData("subs", i, {
          name: parseProfileTitle(resp.title) || sub.name,
          info: parseUserInfoHeader(resp.userinfo),
          updatedAt: Date.now(),
          error: undefined,
          supportUrl: resp.support_url || undefined,
          webPageUrl: resp.web_page_url || undefined,
          announce: parseProfileTitle(resp.announce) || undefined,
          refreshHours: Number(resp.update_interval) > 0 ? Number(resp.update_interval) : undefined,
        });
        if (selectedLink) {
          const same = servers.find((s) => s.link === selectedLink);
          if (same) setData("selectedId", same.id);
        }
      });
      persist();
      return servers.length;
    } catch (e) {
      const i = data.subs.findIndex((s) => s.id === id);
      if (i >= 0) setData("subs", i, "error", errorText(e));
      throw e;
    } finally {
      setBusySubs(id, false);
    }
  }

  function removeServer(id: string) {
    setData("servers", (l) => l.filter((s) => s.id !== id));
    if (data.selectedId === id) setData("selectedId", data.servers[0]?.id);
    persist();
  }

  function removeSubscription(id: string) {
    batch(() => {
      setData("subs", (l) => l.filter((s) => s.id !== id));
      setData("servers", (l) => l.filter((s) => s.subId !== id));
      if (!data.servers.some((s) => s.id === data.selectedId)) setData("selectedId", data.servers[0]?.id);
    });
    persist();
  }

  /** Настоящий пинг через сам сервер (запрос на generate_204). Без ids — все серверы. */
  async function pingAll(ids?: string[]) {
    if (!ids && testing()) return;
    const list = ids ? data.servers.filter((s) => ids.includes(s.id)) : [...data.servers];
    if (!list.length) return;
    const items: { outbound: Record<string, any>; extraOutbounds?: Record<string, any>[] }[] = [];
    const okIds: string[] = [];
    if (!ids) setPings(reconcile({}));
    for (const s of list) {
      try {
        const p = parseLink(s.link);
        items.push({ outbound: p.outbound, extraOutbounds: p.extraOutbounds });
        okIds.push(s.id);
        setPings(s.id, "…");
      } catch {
        setPings(s.id, "err");
      }
    }
    if (!items.length) return;
    if (!ids) setTesting(true);
    try {
      const ports = await api.freePorts(items.length);
      const res = await api.urlTest(JSON.stringify(buildTestConfig(items, ports)), ports);
      okIds.forEach((id, i) => setPings(id, res[i] ?? "err"));
    } catch (e) {
      okIds.forEach((id) => setPings(id, "err"));
      setError(`Не удалось проверить пинг: ${errorText(e)}`);
    } finally {
      if (!ids) setTesting(false);
    }
  }


  // ---------- старт приложения ----------

  async function init() {
    if (!data.selectedId && data.servers.length) setData("selectedId", data.servers[0].id);

    api.onLog((l) =>
      setLogs((prev) => {
        const next = prev.length >= 600 ? prev.slice(-599) : prev.slice();
        next.push(l);
        return next;
      }),
    );
    api.onStopped(({ reason }) => {
      markStopped();
      if (reason) setError(reason);
    });
    api.onTrayToggle(() => toggle());

    setLogs(await api.getLogs().catch(() => []));
    const st = await api.status().catch(() => null);
    if (st?.running) {
      setConn("on");
      setStartedAt(st.started_at);
      setConnectedId(data.selectedId ?? null);
      if (st.mode) setData("mode", st.mode);
    }

    // перезапуск от имени администратора с флагом --connect
    const args = await api.launchArgs().catch((): string[] => []);
    if (args.includes("--connect") && conn() === "off") connect();

    // подписки обновляем в фоне, если давно не обновлялись
    for (const sub of data.subs) {
      if (Date.now() - sub.updatedAt > refreshMs(sub)) refreshSubscription(sub.id).catch(() => {});
    }
    // и раз в 10 минут проверяем, не пора ли обновить снова
    setInterval(() => {
      for (const sub of data.subs) {
        if (!busySubs[sub.id] && Date.now() - sub.updatedAt > refreshMs(sub)) refreshSubscription(sub.id).catch(() => {});
      }
    }, 10 * 60 * 1000);
    if (data.servers.length) pingAll();
  }

  return {
    data,
    conn,
    startedAt,
    connectedId,
    error,
    setError,
    notice,
    flash,
    needAdmin,
    setNeedAdmin,
    pings,
    logs,
    clearLogs: () => {
      setLogs([]);
      api.clearLogs().catch(() => {});
    },
    busySubs,
    selected,
    connect,
    disconnect,
    toggle,
    select,
    setMode,
    importText,
    refreshSubscription,
    removeServer,
    removeSubscription,
    pingAll,
    testing,
    setTun,
    init,
    relaunchAsAdmin: () => api.relaunchAsAdmin(true).catch((e) => setError(errorText(e))),
    inTauri,
  };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "Подписка";
  }
}

export const store = createRoot(createAppStore);
