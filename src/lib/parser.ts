// Разбор ключей (share-ссылок) в outbound для Xray-core.
// Поддержка: vless://, vmess://, trojan://, ss://, socks://

export type Protocol = "vless" | "vmess" | "trojan" | "shadowsocks" | "socks";

export interface ParsedLink {
  name: string;
  protocol: Protocol;
  address: string;
  port: number;
  /** outbound в формате Xray (tag = "proxy") */
  outbound: Record<string, any>;
  /** вспомогательные outbound из JSON-подписок (например, фрагментация через dialerProxy) */
  extraOutbounds?: Record<string, any>[];
}

export class LinkError extends Error {}

// ---------- утилиты ----------

export function b64decode(input: string): string {
  let s = input.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function tryB64decode(input: string): string | null {
  try {
    if (!/^[A-Za-z0-9+/=_\-\s]+$/.test(input)) return null;
    return b64decode(input);
  } catch {
    return null;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parsePort(raw: string | number | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new LinkError(`Неверный порт: ${raw}`);
  return n;
}

/** "host:port" или "[v6]:port" */
function splitHostPort(hp: string): { host: string; port: number } {
  const m = hp.match(/^\[([^\]]+)\]:(\d+)$/) ?? hp.match(/^([^:]+):(\d+)$/);
  if (!m) throw new LinkError(`Не удалось разобрать адрес: ${hp}`);
  return { host: m[1], port: parsePort(m[2]) };
}

function stripBrackets(h: string) {
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

export function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

// ---------- транспорт и TLS ----------

interface StreamParams {
  network?: string;
  security?: string;
  sni?: string;
  host?: string;
  path?: string;
  fp?: string;
  alpn?: string;
  pbk?: string;
  sid?: string;
  spx?: string;
  pqv?: string;
  serviceName?: string;
  authority?: string;
  mode?: string;
  headerType?: string;
  seed?: string;
  allowInsecure?: boolean;
  extra?: string;
}

const NETWORK_ALIASES: Record<string, string> = {
  "": "raw",
  tcp: "raw",
  raw: "raw",
  ws: "ws",
  websocket: "ws",
  grpc: "grpc",
  gun: "grpc",
  httpupgrade: "httpupgrade",
  xhttp: "xhttp",
  splithttp: "xhttp",
  kcp: "kcp",
  mkcp: "kcp",
};

export function buildStreamSettings(p: StreamParams, address: string): Record<string, any> {
  const rawNet = (p.network ?? "").toLowerCase();
  const network = NETWORK_ALIASES[rawNet];
  if (!network) throw new LinkError(`Транспорт «${rawNet}» пока не поддерживается`);

  const stream: Record<string, any> = { network };
  const security = (p.security ?? "none").toLowerCase() || "none";

  switch (network) {
    case "raw":
      if (p.headerType === "http") {
        stream.rawSettings = {
          header: {
            type: "http",
            request: {
              path: (p.path || "/").split(","),
              headers: p.host ? { Host: p.host.split(",") } : {},
            },
          },
        };
      }
      break;
    case "ws":
      stream.wsSettings = { path: p.path || "/", ...(p.host ? { host: p.host } : {}) };
      break;
    case "grpc":
      stream.grpcSettings = {
        serviceName: p.serviceName ?? p.path ?? "",
        multiMode: p.mode === "multi",
        ...(p.authority ? { authority: p.authority } : {}),
      };
      break;
    case "httpupgrade":
      stream.httpupgradeSettings = { path: p.path || "/", ...(p.host ? { host: p.host } : {}) };
      break;
    case "xhttp": {
      const xs: Record<string, any> = { path: p.path || "/", mode: p.mode || "auto" };
      if (p.host) xs.host = p.host;
      if (p.extra) {
        try {
          xs.extra = JSON.parse(p.extra);
        } catch {
          throw new LinkError("Параметр extra у xhttp — не валидный JSON");
        }
      }
      stream.xhttpSettings = xs;
      break;
    }
    case "kcp":
      stream.kcpSettings = {
        ...(p.headerType && p.headerType !== "none" ? { header: { type: p.headerType } } : {}),
        ...(p.seed ? { seed: p.seed } : {}),
      };
      break;
  }

  if (security === "tls") {
    const tls: Record<string, any> = { serverName: p.sni || p.host?.split(",")[0] || address };
    if (p.fp) tls.fingerprint = p.fp;
    if (p.alpn) tls.alpn = p.alpn.split(",").map((s) => s.trim()).filter(Boolean);
    if (p.allowInsecure) tls.allowInsecure = true;
    stream.security = "tls";
    stream.tlsSettings = tls;
  } else if (security === "reality") {
    if (!p.pbk) throw new LinkError("Для Reality в ключе нет публичного ключа (pbk)");
    const r: Record<string, any> = {
      serverName: p.sni || "",
      fingerprint: p.fp || "chrome",
      publicKey: p.pbk,
      shortId: p.sid || "",
    };
    if (p.spx) r.spiderX = p.spx;
    if (p.pqv) r.mldsa65Verify = p.pqv;
    stream.security = "reality";
    stream.realitySettings = r;
  } else if (security !== "none") {
    throw new LinkError(`Шифрование «${security}» не поддерживается`);
  }
  return stream;
}

function paramsFromQuery(q: URLSearchParams): StreamParams {
  const g = (k: string) => q.get(k) ?? undefined;
  return {
    network: g("type"),
    security: g("security"),
    sni: g("sni") ?? g("peer"),
    host: g("host"),
    path: g("path"),
    fp: g("fp"),
    alpn: g("alpn"),
    pbk: g("pbk"),
    sid: g("sid"),
    spx: g("spx"),
    pqv: g("pqv"),
    serviceName: g("serviceName"),
    authority: g("authority"),
    mode: g("mode"),
    headerType: g("headerType"),
    seed: g("seed"),
    allowInsecure: ["1", "true"].includes((g("allowInsecure") ?? g("insecure") ?? "").toLowerCase()),
    extra: g("extra"),
  };
}

// ---------- протоколы ----------

function parseUrlLike(link: string) {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new LinkError("Ссылка повреждена");
  }
  const host = stripBrackets(url.hostname);
  if (!host) throw new LinkError("В ссылке нет адреса сервера");
  const port = parsePort(url.port || (url.protocol === "trojan:" ? 443 : undefined));
  const name = safeDecode(url.hash.replace(/^#/, "")) || `${host}:${port}`;
  return { url, host, port, name, user: safeDecode(url.username), pass: safeDecode(url.password) };
}

function parseVless(link: string): ParsedLink {
  const { url, host, port, name, user } = parseUrlLike(link);
  if (!user) throw new LinkError("В ключе VLESS нет UUID");
  const q = url.searchParams;
  const flow = q.get("flow") || "";
  const encryption = q.get("encryption") || "none";
  return {
    name,
    protocol: "vless",
    address: host,
    port,
    outbound: {
      tag: "proxy",
      protocol: "vless",
      settings: {
        vnext: [{ address: host, port, users: [{ id: user, encryption, ...(flow ? { flow } : {}) }] }],
      },
      streamSettings: buildStreamSettings(paramsFromQuery(q), host),
    },
  };
}

function parseTrojan(link: string): ParsedLink {
  const { url, host, port, name, user } = parseUrlLike(link);
  if (!user) throw new LinkError("В ключе Trojan нет пароля");
  const q = url.searchParams;
  const params = paramsFromQuery(q);
  if (!params.security) params.security = "tls";
  const flow = q.get("flow") || "";
  return {
    name,
    protocol: "trojan",
    address: host,
    port,
    outbound: {
      tag: "proxy",
      protocol: "trojan",
      settings: { servers: [{ address: host, port, password: user, ...(flow ? { flow } : {}) }] },
      streamSettings: buildStreamSettings(params, host),
    },
  };
}

function parseVmess(link: string): ParsedLink {
  const body = link.slice("vmess://".length).split("#")[0];
  const decoded = tryB64decode(body);
  if (!decoded) throw new LinkError("Ключ VMess не в формате base64");
  let j: Record<string, any>;
  try {
    j = JSON.parse(decoded);
  } catch {
    throw new LinkError("Ключ VMess повреждён (не JSON)");
  }
  const host = String(j.add ?? "").trim();
  if (!host) throw new LinkError("В ключе VMess нет адреса");
  const port = parsePort(j.port);
  const net = String(j.net ?? "tcp");
  const tls = String(j.tls ?? "");
  const params: StreamParams = {
    network: net,
    security: tls === "tls" || tls === "reality" ? tls : "none",
    sni: j.sni || undefined,
    host: j.host || undefined,
    path: net === "grpc" ? undefined : j.path || undefined,
    serviceName: net === "grpc" ? j.path || "" : undefined,
    fp: j.fp || undefined,
    alpn: j.alpn || undefined,
    pbk: j.pbk || undefined,
    sid: j.sid || undefined,
    headerType: j.type && j.type !== "none" ? j.type : undefined,
    mode: net === "grpc" && j.type === "multi" ? "multi" : undefined,
    allowInsecure: j.allowInsecure === true || j.allowInsecure === "1",
  };
  return {
    name: String(j.ps || `${host}:${port}`),
    protocol: "vmess",
    address: host,
    port,
    outbound: {
      tag: "proxy",
      protocol: "vmess",
      settings: { vnext: [{ address: host, port, users: [{ id: String(j.id), security: j.scy || "auto" }] }] },
      streamSettings: buildStreamSettings(params, host),
    },
  };
}

function parseShadowsocks(link: string): ParsedLink {
  let rest = link.slice("ss://".length);
  let name = "";
  const hashIdx = rest.indexOf("#");
  if (hashIdx >= 0) {
    name = safeDecode(rest.slice(hashIdx + 1));
    rest = rest.slice(0, hashIdx);
  }
  let query = "";
  const qIdx = rest.indexOf("?");
  if (qIdx >= 0) {
    query = rest.slice(qIdx + 1);
    rest = rest.slice(0, qIdx);
  }
  rest = rest.replace(/\/$/, "");

  if (!rest.includes("@")) {
    // старый формат: всё в base64
    const d = tryB64decode(rest);
    if (!d || !d.includes("@")) throw new LinkError("Ключ Shadowsocks повреждён");
    rest = d;
  }
  const at = rest.lastIndexOf("@");
  let userinfo = rest.slice(0, at);
  const { host, port } = splitHostPort(rest.slice(at + 1));

  userinfo = safeDecode(userinfo);
  if (!userinfo.includes(":")) {
    const d = tryB64decode(userinfo);
    if (!d) throw new LinkError("Ключ Shadowsocks повреждён");
    userinfo = d;
  }
  const colon = userinfo.indexOf(":");
  const method = userinfo.slice(0, colon).toLowerCase();
  const password = userinfo.slice(colon + 1);
  if (!method || !password) throw new LinkError("В ключе Shadowsocks нет метода или пароля");

  if (new URLSearchParams(query).get("plugin")) {
    throw new LinkError("Shadowsocks с плагинами (obfs, v2ray-plugin) пока не поддерживается");
  }
  return {
    name: name || `${host}:${port}`,
    protocol: "shadowsocks",
    address: host,
    port,
    outbound: {
      tag: "proxy",
      protocol: "shadowsocks",
      settings: { servers: [{ address: host, port, method, password }] },
    },
  };
}

function parseSocks(link: string): ParsedLink {
  let normalized = link.replace(/^socks5?:\/\//i, "socks://");
  // socks://BASE64(user:pass)@host:port
  const m = normalized.match(/^socks:\/\/([^@/?#]+)@/);
  if (m && !m[1].includes(":")) {
    const d = tryB64decode(safeDecode(m[1]));
    if (d && d.includes(":")) {
      const [u, ...p] = d.split(":");
      normalized = normalized.replace(m[1], `${encodeURIComponent(u)}:${encodeURIComponent(p.join(":"))}`);
    }
  }
  const { host, port, name, user, pass } = parseUrlLike(normalized);
  return {
    name,
    protocol: "socks",
    address: host,
    port,
    outbound: {
      tag: "proxy",
      protocol: "socks",
      settings: { servers: [{ address: host, port, ...(user ? { users: [{ user, pass }] } : {}) }] },
    },
  };
}

export function parseLink(raw: string): ParsedLink {
  const link = raw.trim();
  const scheme = link.split("://")[0]?.toLowerCase();
  switch (scheme) {
    case JSON_SCHEME:
      return parseJsonLink(link);
    case "vless":
      return parseVless(link);
    case "vmess":
      return parseVmess(link);
    case "trojan":
      return parseTrojan(link);
    case "ss":
      return parseShadowsocks(link);
    case "socks":
    case "socks5":
      return parseSocks(link);
    case "hysteria2":
    case "hy2":
    case "tuic":
    case "wireguard":
    case "wg":
      throw new LinkError(`Протокол ${scheme} пока не поддерживается`);
    case "happ":
      throw new LinkError("Зашифрованные ссылки happ:// открываются только в самом Happ — попросите у провайдера обычную ссылку на подписку");
    default:
      throw new LinkError("Это не похоже на ключ (ожидается vless://, vmess://, trojan://, ss:// или ссылка на подписку)");
  }
}

// ---------- ввод пользователя и подписки ----------

export interface InputResult {
  links: { link: string; parsed: ParsedLink }[];
  subscriptions: string[];
  errors: { line: string; message: string }[];
}

const LINK_RE = /^(xray-json|vless|vmess|trojan|ss|socks5?|hysteria2|hy2|tuic|wireguard|wg|happ):\/\//i;

export function splitLines(text: string): string[] {
  return text
    .split(/[\r\n\s]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Разбирает то, что пользователь вставил: ключи, ссылки на подписки, base64-блоки. */
export function parseUserInput(text: string): InputResult {
  const res: InputResult = { links: [], subscriptions: [], errors: [] };
  let lines = splitLines(text);
  if (lines.length === 1 && !LINK_RE.test(lines[0]) && !/^https?:\/\//i.test(lines[0])) {
    const d = tryB64decode(lines[0]);
    if (d && d.includes("://")) lines = splitLines(d);
  }
  for (const line of lines) {
    if (/^https?:\/\//i.test(line)) {
      res.subscriptions.push(line);
      continue;
    }
    try {
      res.links.push({ link: line, parsed: parseLink(line) });
    } catch (e) {
      res.errors.push({ line, message: (e as Error).message });
    }
  }
  return res;
}

/** Тело ответа подписки: обычно base64 со списком ключей, иногда — просто список. */
export function parseSubscriptionBody(body: string): InputResult {
  const trimmed = body.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseJsonSubscription(trimmed);
  let text = trimmed;
  if (!trimmed.includes("://")) {
    const d = tryB64decode(trimmed);
    if (d) text = d;
  }
  const res: InputResult = { links: [], subscriptions: [], errors: [] };
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (!LINK_RE.test(line)) continue;
    try {
      res.links.push({ link: line, parsed: parseLink(line) });
    } catch (e) {
      res.errors.push({ line, message: (e as Error).message });
    }
  }
  return res;
}

export interface SubscriptionInfo {
  upload?: number;
  download?: number;
  total?: number;
  expire?: number;
}

export function parseUserInfoHeader(h: string | null | undefined): SubscriptionInfo | undefined {
  if (!h) return undefined;
  const out: SubscriptionInfo = {};
  for (const part of h.split(";")) {
    const [k, v] = part.split("=").map((s) => s.trim());
    const n = Number(v);
    if (["upload", "download", "total", "expire"].includes(k) && Number.isFinite(n)) {
      (out as any)[k] = n;
    }
  }
  return out;
}

export function parseProfileTitle(h: string | null | undefined): string | undefined {
  if (!h) return undefined;
  if (h.startsWith("base64:")) {
    return tryB64decode(h.slice(7)) ?? undefined;
  }
  return h;
}

// ---------- JSON-подписки (Remnawave / Marzban: …/json, формат v2ray-json) ----------
// Панель отдаёт массив полных конфигов Xray. Из каждого берём outbound прокси
// (и то, на что он ссылается через dialerProxy) и упаковываем во внутреннюю
// псевдо-ссылку xray-json://, чтобы хранить сервер так же, как обычный ключ.

const JSON_SCHEME = "xray-json";
const SUPPORTED_PROTOCOLS: Record<string, Protocol> = {
  vless: "vless",
  vmess: "vmess",
  trojan: "trojan",
  shadowsocks: "shadowsocks",
  socks: "socks",
};
const RESERVED_TAGS = new Set(["proxy", "direct", "block", "socks-in", "http-in"]);

function b64encodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function serverOf(o: Record<string, any>): { host: string; port: number } {
  const s = o.settings ?? {};
  const t = s.vnext?.[0] ?? s.servers?.[0] ?? s;
  const host = stripBrackets(String(t.address ?? ""));
  if (!host) throw new LinkError("В конфиге нет адреса сервера");
  return { host, port: parsePort(t.port) };
}

/** Выбирает из полного конфига Xray outbound прокси и его зависимости. */
function extractFromXrayConfig(cfg: Record<string, any>): { name?: string; outbound: any; extra: any[] } {
  const outbounds: any[] = Array.isArray(cfg.outbounds) ? cfg.outbounds : [];
  const proxy =
    outbounds.find((o) => o?.tag === "proxy" && SUPPORTED_PROTOCOLS[o.protocol]) ??
    outbounds.find((o) => SUPPORTED_PROTOCOLS[o?.protocol]);
  if (!proxy) {
    const p = outbounds.find((o) => o?.tag === "proxy")?.protocol;
    throw new LinkError(p ? `Протокол ${p} пока не поддерживается` : "В конфиге нет поддерживаемого сервера");
  }
  // собираем цепочку dialerProxy (например, outbound "fragment")
  const byTag = new Map(outbounds.filter((o) => o?.tag).map((o) => [o.tag, o]));
  const extra: any[] = [];
  const seen = new Set<string>();
  const walk = (o: any) => {
    const tag = o?.streamSettings?.sockopt?.dialerProxy ?? o?.proxySettings?.tag;
    if (!tag || seen.has(tag) || RESERVED_TAGS.has(tag)) return;
    seen.add(tag);
    const dep = byTag.get(tag);
    if (dep) {
      extra.push(dep);
      walk(dep);
    }
  };
  walk(proxy);
  return { name: cfg.remarks, outbound: { ...proxy, tag: "proxy" }, extra };
}

function parseJsonLink(link: string): ParsedLink {
  let data: { name?: string; outbound: any; extra?: any[] };
  try {
    data = JSON.parse(b64decode(link.slice(JSON_SCHEME.length + 3)));
  } catch {
    throw new LinkError("Сохранённый сервер повреждён — обновите подписку");
  }
  const protocol = SUPPORTED_PROTOCOLS[data.outbound?.protocol];
  if (!protocol) throw new LinkError(`Протокол ${data.outbound?.protocol} пока не поддерживается`);
  const { host, port } = serverOf(data.outbound);
  return {
    name: data.name || `${host}:${port}`,
    protocol,
    address: host,
    port,
    outbound: data.outbound,
    extraOutbounds: data.extra?.length ? data.extra : undefined,
  };
}

export function parseJsonSubscription(body: string): InputResult {
  const res: InputResult = { links: [], subscriptions: [], errors: [] };
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    res.errors.push({ line: body.slice(0, 40), message: "Подписка в формате JSON, но JSON повреждён" });
    return res;
  }
  const configs: any[] = Array.isArray(json) ? json : [json];
  configs.forEach((cfg, i) => {
    try {
      const { name, outbound, extra } = extractFromXrayConfig(cfg ?? {});
      const link = `${JSON_SCHEME}://${b64encodeUtf8(JSON.stringify({ name, outbound, extra }))}`;
      res.links.push({ link, parsed: parseJsonLink(link) });
    } catch (e) {
      res.errors.push({ line: cfg?.remarks ?? `#${i + 1}`, message: (e as Error).message });
    }
  });
  return res;
}
