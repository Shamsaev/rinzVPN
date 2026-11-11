// Форматирование трафика, сроков и «сколько осталось» для подписок.
import type { SubscriptionInfo } from "./parser";

export function fmtBytes(n: number): string {
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1).replace(".", ",")} ГБ`;
  const mb = n / 1024 ** 2;
  return `${Math.round(mb)} МБ`;
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const days = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;

export function fmtAgo(ts: number): string {
  if (!ts) return "ещё не обновлялась";
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${days(Math.round(h / 24))} назад`;
}

export interface SubUsage {
  used: number;
  total?: number;
  left?: number;
  /** 0..1, если известен лимит */
  ratio?: number;
  expireAt?: Date;
  daysLeft?: number;
  expired: boolean;
  /** трафик почти кончился или срок вот-вот истечёт */
  warn: boolean;
  hasTraffic: boolean;
}

export function usage(info?: SubscriptionInfo): SubUsage | undefined {
  if (!info) return undefined;
  const hasTraffic = info.upload != null || info.download != null || !!info.total;
  const used = (info.upload ?? 0) + (info.download ?? 0);
  const total = info.total && info.total > 0 ? info.total : undefined;
  const left = total != null ? Math.max(0, total - used) : undefined;
  const ratio = total ? Math.min(1, used / total) : undefined;
  const expireAt = info.expire && info.expire > 0 ? new Date(info.expire * 1000) : undefined;
  const daysLeft = expireAt ? Math.ceil((expireAt.getTime() - Date.now()) / 86400000) : undefined;
  const expired = daysLeft != null && daysLeft <= 0;
  const warn = expired || (daysLeft != null && daysLeft <= 3) || (ratio != null && ratio >= 0.9);
  if (!hasTraffic && !expireAt) return undefined;
  return { used, total, left, ratio, expireAt, daysLeft, expired, warn, hasTraffic };
}

export const fmtDate = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
