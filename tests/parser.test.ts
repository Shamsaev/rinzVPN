import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLink,
  parseProfileTitle,
  parseSubscriptionBody,
  parseUserInfoHeader,
  parseUserInput,
} from "../src/lib/parser";
import { buildSingboxConfig, buildXrayConfig, pinServerAddress } from "../src/lib/config";

const UUID = "b831381d-6324-4d53-ad4f-8cda48b30811";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export const SAMPLES: Record<string, string> = {
  vlessReality: `vless://${UUID}@example.com:443?type=tcp&security=reality&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc&fp=chrome&sni=www.microsoft.com&sid=6ba85179e30d4fc2&spx=%2F&flow=xtls-rprx-vision&encryption=none#%F0%9F%87%B3%F0%9F%87%B1%20Amsterdam`,
  vlessWsTls: `vless://${UUID}@1.2.3.4:443?type=ws&security=tls&sni=cdn.example.com&host=cdn.example.com&path=%2Fws%3Fed%3D2048&alpn=h2%2Chttp%2F1.1&fp=firefox#WS`,
  vlessGrpc: `vless://${UUID}@example.com:443?type=grpc&security=tls&serviceName=grpcsvc&mode=multi#gRPC`,
  vlessXhttp: `vless://${UUID}@example.com:443?type=xhttp&security=reality&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc&sni=www.apple.com&sid=ab&path=%2Fxh&mode=auto#XHTTP`,
  vlessIpv6: `vless://${UUID}@[2001:db8::1]:8443?type=httpupgrade&security=tls&path=%2Fup&host=h.example.com#v6`,
  trojan: `trojan://p%40ss%3Aword@trojan.example.com:443?sni=trojan.example.com&type=tcp#Trojan%20One`,
  vmess: `vmess://${b64(
    JSON.stringify({ v: "2", ps: "Мой VMess", add: "vm.example.com", port: "443", id: UUID, aid: "0", scy: "auto", net: "ws", type: "none", host: "vm.example.com", path: "/vm", tls: "tls", sni: "vm.example.com", fp: "chrome" }),
  )}`,
  ssSip002: `ss://${b64("chacha20-ietf-poly1305:secretpass")}@ss.example.com:8388#SS%20one`,
  ss2022: `ss://2022-blake3-aes-128-gcm:${encodeURIComponent("MTIzNDU2Nzg5MDEyMzQ1Ng==")}@ss.example.com:8388#SS2022`,
  ssLegacy: `ss://${b64("aes-256-gcm:pw@5.6.7.8:8000")}#legacy`,
  socks: `socks://${b64("user:pass")}@9.9.9.9:1080#Socks`,
};

describe("parseLink", () => {
  it("VLESS Reality + Vision", () => {
    const p = parseLink(SAMPLES.vlessReality);
    expect(p.name).toBe("🇳🇱 Amsterdam");
    expect(p.address).toBe("example.com");
    expect(p.port).toBe(443);
    const user = p.outbound.settings.vnext[0].users[0];
    expect(user.id).toBe(UUID);
    expect(user.flow).toBe("xtls-rprx-vision");
    expect(p.outbound.streamSettings.security).toBe("reality");
    expect(p.outbound.streamSettings.realitySettings.serverName).toBe("www.microsoft.com");
    expect(p.outbound.streamSettings.realitySettings.shortId).toBe("6ba85179e30d4fc2");
  });

  it("VLESS WS TLS", () => {
    const s = parseLink(SAMPLES.vlessWsTls).outbound.streamSettings;
    expect(s.network).toBe("ws");
    expect(s.wsSettings.path).toBe("/ws?ed=2048");
    expect(s.tlsSettings.alpn).toEqual(["h2", "http/1.1"]);
  });

  it("VLESS IPv6", () => {
    const p = parseLink(SAMPLES.vlessIpv6);
    expect(p.address).toBe("2001:db8::1");
    expect(p.port).toBe(8443);
  });

  it("Trojan с экранированным паролем", () => {
    const p = parseLink(SAMPLES.trojan);
    expect(p.outbound.settings.servers[0].password).toBe("p@ss:word");
    expect(p.outbound.streamSettings.security).toBe("tls");
    expect(p.name).toBe("Trojan One");
  });

  it("VMess", () => {
    const p = parseLink(SAMPLES.vmess);
    expect(p.name).toBe("Мой VMess");
    expect(p.outbound.streamSettings.network).toBe("ws");
  });

  it("Shadowsocks: SIP002, 2022, legacy", () => {
    expect(parseLink(SAMPLES.ssSip002).outbound.settings.servers[0].method).toBe("chacha20-ietf-poly1305");
    expect(parseLink(SAMPLES.ss2022).outbound.settings.servers[0].password).toBe("MTIzNDU2Nzg5MDEyMzQ1Ng==");
    const legacy = parseLink(SAMPLES.ssLegacy);
    expect(legacy.address).toBe("5.6.7.8");
    expect(legacy.port).toBe(8000);
  });

  it("SOCKS с base64-логином", () => {
    const p = parseLink(SAMPLES.socks);
    expect(p.outbound.settings.servers[0].users[0]).toEqual({ user: "user", pass: "pass" });
  });

  it("понятные ошибки", () => {
    expect(() => parseLink("hy2://x@y:1")).toThrow(/не поддерживается/);
    expect(() => parseLink("hello")).toThrow(/не похоже на ключ/);
  });
});

describe("ввод и подписки", () => {
  it("смешанный ввод", () => {
    const r = parseUserInput(`${SAMPLES.vlessReality}\n https://sub.example.com/abc \n мусор`);
    expect(r.links).toHaveLength(1);
    expect(r.subscriptions).toEqual(["https://sub.example.com/abc"]);
    expect(r.errors).toHaveLength(1);
  });

  it("base64-подписка", () => {
    const body = b64([SAMPLES.vlessReality, SAMPLES.trojan, SAMPLES.ssSip002].join("\n"));
    expect(parseSubscriptionBody(body).links).toHaveLength(3);
  });

  it("заголовки подписки", () => {
    expect(parseUserInfoHeader("upload=10; download=20; total=1000; expire=1767225600")).toEqual({
      upload: 10,
      download: 20,
      total: 1000,
      expire: 1767225600,
    });
    expect(parseProfileTitle(`base64:${b64("Моя подписка")}`)).toBe("Моя подписка");
  });
});

describe("конфиги", () => {
  it("pinServerAddress сохраняет SNI", () => {
    const o = parseLink(SAMPLES.trojan).outbound;
    const pinned = pinServerAddress(o, "10.0.0.1");
    expect(pinned.settings.servers[0].address).toBe("10.0.0.1");
    expect(pinned.streamSettings.tlsSettings.serverName).toBe("trojan.example.com");
    expect(o.settings.servers[0].address).toBe("trojan.example.com");
  });

  // Сохраняем конфиги на диск, чтобы проверить их настоящими xray / sing-box.
  it("выгрузка конфигов", () => {
    const out = process.env.CONFIG_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    for (const [k, link] of Object.entries(SAMPLES)) {
      writeFileSync(join(out, `xray-${k}.json`), JSON.stringify(buildXrayConfig(parseLink(link).outbound), null, 2));
    }
    writeFileSync(join(out, "singbox.json"), JSON.stringify(buildSingboxConfig(), null, 2));
  });
});
