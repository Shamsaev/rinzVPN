// Сборка конфигов для ядер: Xray (всегда) и sing-box (только для TUN).

export const SOCKS_PORT = 10808;
export const HTTP_PORT = 10809;

const PRIVATE_CIDRS = [
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

export interface XrayOptions {
  socksPort?: number;
  httpPort?: number;
  logLevel?: "debug" | "info" | "warning" | "error" | "none";
  /** дополнительные outbound (из JSON-подписок) */
  extraOutbounds?: Record<string, any>[];
}

export function buildXrayConfig(outbound: Record<string, any>, opts: XrayOptions = {}) {
  const socksPort = opts.socksPort ?? SOCKS_PORT;
  const httpPort = opts.httpPort ?? HTTP_PORT;
  const sniffing = { enabled: true, destOverride: ["http", "tls", "quic"] };
  return {
    log: { loglevel: opts.logLevel ?? "warning" },
    inbounds: [
      {
        tag: "socks-in",
        listen: "127.0.0.1",
        port: socksPort,
        protocol: "socks",
        settings: { auth: "noauth", udp: true },
        sniffing,
      },
      {
        tag: "http-in",
        listen: "127.0.0.1",
        port: httpPort,
        protocol: "http",
        settings: {},
        sniffing,
      },
    ],
    outbounds: [
      outbound,
      ...(opts.extraOutbounds ?? []),
      { tag: "direct", protocol: "freedom" },
      { tag: "block", protocol: "blackhole" },
    ],
    routing: {
      domainStrategy: "AsIs",
      rules: [
        { type: "field", ip: PRIVATE_CIDRS, outboundTag: "direct" },
        { type: "field", domain: ["full:localhost"], outboundTag: "direct" },
      ],
    },
  };
}

/**
 * В TUN-режиме весь DNS идёт через туннель, поэтому домен самого сервера
 * заранее резолвим в IP (пока туннель ещё не поднят) и подставляем в outbound.
 * SNI/Host при этом остаются доменными.
 */
export function pinServerAddress(outbound: Record<string, any>, ip: string): Record<string, any> {
  const o = structuredClone(outbound);
  const s = o.settings ?? {};
  const targets: any[] = [...(s.vnext ?? []), ...(s.servers ?? [])];
  if (!targets.length && s.address) targets.push(s); // упрощённый формат: address прямо в settings
  for (const t of targets) {
    const original = t.address;
    t.address = ip;
    const tls = o.streamSettings?.tlsSettings;
    if (tls && !tls.serverName) tls.serverName = original;
  }
  return o;
}

export interface SingboxOptions {
  socksPort?: number;
  remoteDns?: string;
}

export function buildSingboxConfig(opts: SingboxOptions = {}) {
  const socksPort = opts.socksPort ?? SOCKS_PORT;
  return {
    log: { level: "warn", timestamp: true },
    dns: {
      servers: [{ type: "tcp", tag: "remote", server: opts.remoteDns ?? "1.1.1.1", detour: "proxy" }],
      final: "remote",
      strategy: "ipv4_only",
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        interface_name: "rinzVPN",
        address: ["172.19.0.1/30"],
        mtu: 9000,
        auto_route: true,
        strict_route: true,
        stack: "mixed",
      },
    ],
    outbounds: [
      { type: "socks", tag: "proxy", server: "127.0.0.1", server_port: socksPort, version: "5" },
      { type: "direct", tag: "direct" },
    ],
    route: {
      auto_detect_interface: true,
      rules: [
        { action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        // само ядро xray ходит к серверу напрямую, иначе получится петля
        { process_name: ["xray.exe", "xray"], outbound: "direct" },
        { ip_is_private: true, outbound: "direct" },
      ],
      final: "proxy",
    },
  };
}
