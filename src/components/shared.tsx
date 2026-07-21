"use client";

import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import {
  Award,
  BookOpen,
  Check,
  Clock3,
  Code2,
  Gamepad2,
  Gift,
  HeartHandshake,
  Home,
  Info,
  ListChecks,
  Medal,
  Play,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { AssignmentRewardItem, TaskRewardBinding } from "@/components/types";
import { formatClock, formatDuration, MINUTE } from "@/lib/time";

export const THEME_COLORS: Record<string, { bg: string; ink: string; ring: string }> = {
  purple: { bg: "#eee9ff", ink: "#6246c7", ring: "#b8a6ff" },
  blue: { bg: "#dff5ff", ink: "#286d9b", ring: "#8bd9fb" },
  green: { bg: "#dff8e8", ink: "#26754a", ring: "#8ee0ae" },
  orange: { bg: "#fff0d9", ink: "#9a5b1f", ring: "#ffc77f" },
  pink: { bg: "#ffe7f2", ink: "#a74472", ring: "#f7a8cc" },
};

const avatarIcons: Record<string, LucideIcon> = {
  star: Star,
  rocket: Sparkles,
  book: BookOpen,
  medal: Medal,
  heart: HeartHandshake,
  code: Code2,
};

export const AVATARS = ["star", "rocket", "book", "medal", "heart", "code"];
export const THEMES = Object.keys(THEME_COLORS);

export function Avatar({ avatar, theme, imageUrl, size = 54 }: { avatar: string; theme: string; imageUrl?: string | null; size?: number }) {
  const Icon = avatarIcons[avatar] || Star;
  const colors = THEME_COLORS[theme] || THEME_COLORS.purple;
  if (imageUrl) {
    return (
      <div
        className="shrink-0 overflow-hidden rounded-[22px] border-2 bg-white"
        style={{ width: size, height: size, borderColor: colors.ring }}
      >
        <Image
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          unoptimized
        />
      </div>
    );
  }
  return (
    <div
      className="grid shrink-0 place-items-center rounded-[22px] border-2"
      style={{ width: size, height: size, background: colors.bg, color: colors.ink, borderColor: colors.ring }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={2.7} />
    </div>
  );
}

const rewardIcons: Record<string, LucideIcon> = {
  gift: Gift,
  sparkles: Sparkles,
  clock: Clock3,
  book: BookOpen,
  toy: Gamepad2,
  food: Award,
  trip: Home,
};

export function rewardIcon(icon: string): LucideIcon {
  return rewardIcons[icon] || Gift;
}

export function RewardVisual({
  icon,
  imageUrl,
  theme = "purple",
  size = 54,
}: {
  icon: string;
  imageUrl?: string | null;
  theme?: string;
  size?: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const Icon = rewardIcons[icon] || Gift;
  const colors = THEME_COLORS[theme] || THEME_COLORS.purple;
  useEffect(() => setImageFailed(false), [imageUrl]);
  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-[20px] border-2"
      style={{ width: size, height: size, background: colors.bg, color: colors.ink, borderColor: colors.ring }}
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={2.7} aria-hidden="true" />
      {imageUrl && !imageFailed && (
        <Image
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 h-full w-full object-cover"
          unoptimized
          onError={() => setImageFailed(true)}
        />
      )}
    </div>
  );
}

type TaskRewardDisplayItem = TaskRewardBinding | AssignmentRewardItem;

function taskRewardValue(item: TaskRewardDisplayItem) {
  if (item.kind === "random_time") {
    return `${item.randomMinSeconds! / MINUTE}～${item.randomMaxSeconds! / MINUTE} 分钟随机时间`;
  }
  if (item.kind === "fixed_time") return `${item.fixedSeconds! / MINUTE} 分钟固定时间`;
  return item.physicalDescription || "实物奖励";
}

export function TaskRewardList({
  items,
  showOutcomes = false,
  emptyText = "未配置奖励券",
}: {
  items: TaskRewardDisplayItem[];
  showOutcomes?: boolean;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="rounded-xl bg-white/65 px-3 py-2 text-xs font-bold text-slate-500">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const awardedQuantity = "awardedQuantity" in item ? item.awardedQuantity : null;
        return (
          <div
            key={`${item.grantTier}:${"bindingId" in item ? item.bindingId : item.id}`}
            className="flex items-start gap-3 rounded-2xl bg-white/80 p-3"
          >
            <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-black text-slate-800">{item.name}</p>
                <span className="pill bg-purple-100 text-purple-700">× {item.quantity}</span>
              </div>
              <p className="mt-1 text-xs font-bold text-slate-600">{taskRewardValue(item)}</p>
              <p className="mt-1 text-xs font-black text-purple-700">
                {item.probabilityPercent === 100
                  ? "100% 必得"
                  : item.quantity > 1
                    ? `每张独立 ${item.probabilityPercent}% 概率`
                    : `${item.probabilityPercent}% 概率`}
              </p>
              {item.kind === "physical" && item.fulfillmentInstructions && (
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">交付：{item.fulfillmentInstructions}</p>
              )}
              {showOutcomes && awardedQuantity !== null && (
                <p className={`mt-1 text-xs font-black ${awardedQuantity > 0 ? "text-emerald-700" : "text-slate-500"}`}>
                  {awardedQuantity > 0 ? `本次实际获得 ${awardedQuantity} 张` : "本次概率未命中"}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function awardedTaskRewardItems(items: AssignmentRewardItem[]) {
  return items.filter((item) => (item.awardedQuantity || 0) > 0);
}

export function TaskRewardOutcomeSummary({
  baseRewardSeconds,
  reviewMultiplier,
  reviewTier,
  reviewNote,
  items,
}: {
  baseRewardSeconds: number;
  reviewMultiplier: number;
  reviewTier: "normal" | "excellent" | null;
  reviewNote: string | null;
  items: AssignmentRewardItem[];
}) {
  const [open, setOpen] = useState(false);
  const awardedItems = awardedTaskRewardItems(items);
  const awardedQuantity = awardedItems.reduce((total, item) => total + (item.awardedQuantity || 0), 0);
  const visibleItems = awardedItems.slice(0, 1);
  const creditedSeconds = Math.round(baseRewardSeconds * reviewMultiplier);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        {awardedItems.length > 0 ? (
          <div className="flex min-w-0 items-center gap-1.5" aria-label={`获得 ${awardedQuantity} 张奖励券`}>
            {visibleItems.map((item) => (
              <span key={item.id} className="relative" title={`${item.name} ×${item.awardedQuantity}`}>
                <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={30} />
                {(item.awardedQuantity || 0) > 1 && (
                  <span className="absolute -bottom-1 -right-1 rounded-full bg-purple-600 px-1.5 text-[10px] font-black leading-4 text-white">
                    ×{item.awardedQuantity}
                  </span>
                )}
              </span>
            ))}
            <span className="text-[11px] font-black text-purple-700">×{awardedQuantity}</span>
          </div>
        ) : null}
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-purple-100 text-purple-700 transition hover:bg-purple-200"
          aria-label="查看任务结算详情"
          title="查看详情"
          onClick={() => setOpen(true)}
        >
          <Info size={19} strokeWidth={2.6} />
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        >
          <section
            className="page-enter max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="任务结算详情"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-purple-600">任务结算</p>
                <h2 className="mt-0.5 text-xl font-black">审核详情</h2>
              </div>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="关闭详情" onClick={() => setOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3">
                <div>
                  <p className="text-[11px] font-black text-slate-500">审核结果</p>
                  <p className="mt-0.5 text-sm font-black text-slate-800">
                    {reviewTier === "excellent" ? `优秀完成 · 基础 ×${reviewMultiplier}` : "正常完成 · 基础 ×1"}
                  </p>
                </div>
                <span className="text-sm text-purple-700"><TimeCoin seconds={creditedSeconds} compact /></span>
              </div>
              {reviewNote && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-600">
                  管理员说：{reviewNote}
                </p>
              )}
              {awardedItems.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-black text-slate-600">获得的奖励券</p>
                  <TaskRewardList items={awardedItems} showOutcomes />
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function TaskRewardSummary({
  baseRewardSeconds,
  excellentMultiplier,
  bonusEnabled,
  items,
  showOutcomes = false,
  reviewTier = null,
}: {
  baseRewardSeconds: number;
  excellentMultiplier: number;
  bonusEnabled: boolean;
  items: TaskRewardDisplayItem[];
  showOutcomes?: boolean;
  reviewTier?: "normal" | "excellent" | null;
}) {
  const normalItems = items.filter((item) => item.grantTier === "normal");
  const excellentItems = items.filter((item) => item.grantTier === "excellent_bonus");
  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 p-3">
      <div className={`grid gap-2 ${bonusEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
        <div className="rounded-xl bg-blue-50 p-3">
          <p className="text-[11px] font-black text-blue-600">正常完成 · 基础 ×1</p>
          <p className="mt-1 text-sm text-purple-700"><TimeCoin seconds={baseRewardSeconds} compact /></p>
          {reviewTier === "normal" && <p className="mt-1 text-[11px] font-black text-emerald-700">本次审核结果</p>}
        </div>
        {bonusEnabled && (
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="text-[11px] font-black text-amber-700">优秀完成 · 基础 ×{excellentMultiplier}</p>
            <p className="mt-1 text-sm text-purple-700">
              <TimeCoin seconds={Math.round(baseRewardSeconds * excellentMultiplier)} compact />
            </p>
            {reviewTier === "excellent" && <p className="mt-1 text-[11px] font-black text-emerald-700">本次审核结果</p>}
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
          <p className="text-sm font-black text-slate-800">普通奖励券</p>
          <p className="text-[11px] font-bold text-slate-500">正常、优秀都会参与</p>
        </div>
        <TaskRewardList items={normalItems} showOutcomes={showOutcomes} emptyText="没有普通奖励券" />
      </div>
      {bonusEnabled && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
            <p className="text-sm font-black text-amber-900">优秀额外奖励券</p>
            <p className="text-[11px] font-bold text-amber-700">
              {reviewTier === "normal" ? "本次正常完成，未参与" : "仅优秀完成参与"}
            </p>
          </div>
          <TaskRewardList items={excellentItems} showOutcomes={showOutcomes} emptyText="没有优秀额外奖励券" />
        </div>
      )}
    </div>
  );
}

export function PencilMascot({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "w-20" : "w-32"} aria-label="微笑的铅笔小助手" role="img">
      <svg viewBox="0 0 150 170" className="h-auto w-full drop-shadow-[0_8px_8px_rgba(75,55,130,0.16)]">
        <g transform="rotate(7 75 85)">
          <path d="M48 16h54l15 23v101c0 12-10 22-22 22H55c-12 0-22-10-22-22V39z" fill="#ffd85e" stroke="#594a85" strokeWidth="6" />
          <path d="M48 16h54l15 23H33z" fill="#ff8f7e" stroke="#594a85" strokeWidth="6" strokeLinejoin="round" />
          <path d="M33 39h84v22H33z" fill="#a98cff" stroke="#594a85" strokeWidth="6" />
          <path d="M48 162h54l15-22H33z" fill="#f2c99f" stroke="#594a85" strokeWidth="6" strokeLinejoin="round" />
          <path d="M67 162h17l-8 10z" fill="#4b416d" />
          <circle cx="60" cy="93" r="5" fill="#4b416d" />
          <circle cx="91" cy="93" r="5" fill="#4b416d" />
          <path d="M61 113c8 9 21 9 29 0" fill="none" stroke="#4b416d" strokeWidth="5" strokeLinecap="round" />
          <circle cx="50" cy="107" r="7" fill="#ff9b8c" opacity=".55" />
          <circle cx="101" cy="107" r="7" fill="#ff9b8c" opacity=".55" />
        </g>
      </svg>
    </div>
  );
}

export function TimeCoin({ seconds, signed = false, compact = false }: { seconds: number; signed?: boolean; compact?: boolean }) {
  const sign = signed ? (seconds > 0 ? "+" : seconds < 0 ? "−" : "") : "";
  return (
    <span className="inline-flex items-center gap-1.5 font-black tabular-nums">
      <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-amber-500 bg-amber-200 text-amber-800 shadow-[0_2px_0_#d99f24]">
        <Clock3 size={15} strokeWidth={3} />
      </span>
      <span>{sign}{formatDuration(Math.abs(seconds), !compact)}</span>
    </span>
  );
}

export function ConsumptionStartDialog({
  activityName,
  balanceSeconds,
  workerName,
  busy = false,
  onCancel,
  onConfirm,
}: {
  activityName: string;
  balanceSeconds: number;
  workerName?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="page-enter w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consumption-start-title"
      >
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-4 border-amber-300 bg-amber-100 text-amber-700">
          <Clock3 size={31} strokeWidth={3} />
        </div>
        <div className="mt-4 text-center">
          <h2 id="consumption-start-title" className="text-xl font-black">确定开始消耗计时吗？</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">准备开始“{activityName}”</p>
        </div>
        <div className="mt-4 rounded-2xl bg-purple-50 p-4 text-center text-purple-800">
          <p className="text-xs font-black text-purple-600">{workerName ? `${workerName} 现在还剩` : "你现在还剩"}</p>
          <div className="mt-2 text-lg"><TimeCoin seconds={balanceSeconds} /></div>
        </div>
        <p className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 text-sm font-bold leading-6 text-orange-800">开始后会按秒消耗时间币，点击“结束”才会停止。误点后可以使用“误触取消”。</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>先不开始</button>
          <button type="button" className="primary-button" disabled={busy || balanceSeconds <= 0} onClick={onConfirm}>
            <Play className="mr-1 inline" size={18} />{busy ? "正在开始…" : "确定开始"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function useLiveSeconds(startedAt?: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

export function LiveClock({ startedAt, className = "" }: { startedAt: number; className?: string }) {
  const seconds = useLiveSeconds(startedAt);
  return <span className={`font-black tabular-nums ${className}`}>{formatClock(seconds)}</span>;
}

type NavItem<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
  badge?: number;
  disabled?: boolean;
  disabledLabel?: string;
};

export function BottomNav<T extends string>({
  items,
  active,
  onChange,
}: {
  items: NavItem<T>[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-purple-100 bg-white/95 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(64,54,110,0.1)] backdrop-blur md:left-1/2 md:max-w-3xl md:-translate-x-1/2 md:rounded-t-3xl md:border-x">
      <div className="mx-auto flex max-w-3xl items-center justify-around px-2">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`relative flex h-14 min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[11px] font-black transition ${selected ? "bg-purple-100 text-purple-700" : "text-slate-500"} ${item.disabled ? "opacity-55" : ""}`}
              onClick={() => onChange(item.id)}
              disabled={item.disabled}
              aria-current={selected ? "page" : undefined}
              aria-label={item.disabled ? `${item.label}，${item.disabledLabel || "暂未开放"}` : item.label}
              title={item.disabled ? item.disabledLabel || "暂未开放" : undefined}
            >
              <Icon size={22} strokeWidth={selected ? 3 : 2.3} />
              <span className="whitespace-nowrap leading-none">{item.label}</span>
              {item.disabled && <span className="text-[9px] leading-none text-slate-400">{item.disabledLabel || "暂未开放"}</span>}
              {Boolean(item.badge) && (
                <span className="absolute right-1.5 top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[10px] leading-5 text-white">
                  {item.badge! > 99 ? "99+" : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export const workerNavItems = [
  { id: "home" as const, label: "首页", icon: Home },
  { id: "tasks" as const, label: "打工", icon: ListChecks },
  { id: "running" as const, label: "进度", icon: Play },
  { id: "rewards" as const, label: "奖励", icon: Gift },
  { id: "ledger" as const, label: "明细", icon: Award },
  { id: "me" as const, label: "我的", icon: UserRound },
];

export const adminNavItems = [
  { id: "home" as const, label: "总览", icon: Home },
  { id: "publish" as const, label: "发布", icon: ListChecks },
  { id: "reviews" as const, label: "审核", icon: ShieldCheck },
  { id: "workers" as const, label: "角色", icon: UserRound },
  { id: "settings" as const, label: "设置", icon: Settings },
];

export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="app-card flex flex-col items-center px-6 py-9 text-center">
      <PencilMascot compact />
      <h3 className="mt-2 text-lg font-black">{title}</h3>
      <p className="mt-1 max-w-sm text-sm font-semibold leading-6 text-slate-500">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="flex flex-col items-center">
        <PencilMascot />
        <p className="mt-3 animate-pulse text-lg font-black text-purple-700">正在打开时间小金库…</p>
      </div>
    </main>
  );
}

export function AppHeader({
  title,
  subtitle,
  avatar,
  avatarUrl,
  theme,
  onSwitch,
  admin = false,
}: {
  title: string;
  subtitle: string;
  avatar?: string;
  avatarUrl?: string | null;
  theme?: string;
  onSwitch: () => void;
  admin?: boolean;
}) {
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))] sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {admin ? (
          <div className="grid h-13 w-13 shrink-0 place-items-center rounded-[20px] border-2 border-purple-300 bg-purple-100 text-purple-700">
            <ShieldCheck size={28} strokeWidth={2.8} />
          </div>
        ) : (
          <Avatar avatar={avatar || "star"} theme={theme || "purple"} imageUrl={avatarUrl} size={52} />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-black sm:text-xl">{title}</h1>
          <p className="truncate text-xs font-bold text-slate-500 sm:text-sm">{subtitle}</p>
        </div>
      </div>
      <button type="button" onClick={onSwitch} className="secondary-button !min-h-11 !px-3 text-sm">
        切换
      </button>
    </header>
  );
}

export function Toast({ message, tone = "success" }: { message: string; tone?: "success" | "error" }) {
  return (
    <div className={`fixed left-1/2 top-[max(16px,env(safe-area-inset-top))] z-50 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white shadow-xl ${tone === "success" ? "bg-emerald-600" : "bg-red-500"}`} role="status">
      {tone === "success" ? <Check size={19} strokeWidth={3} /> : <Clock3 size={19} strokeWidth={3} />}
      <span>{message}</span>
    </div>
  );
}

export function activityIcon(icon: string) {
  if (icon === "video") return Video;
  if (icon === "gamepad") return Gamepad2;
  return Clock3;
}
