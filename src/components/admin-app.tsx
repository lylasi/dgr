"use client";

import {
  AlertCircle,
  Award,
  BookOpen,
  CheckCircle2,
  Clock3,
  CircleHelp,
  Gift,
  ImagePlus,
  MinusCircle,
  Pause,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UsersRound,
  XCircle,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState, type ChangeEvent } from "react";
import { api, mutationId } from "@/components/api";
import {
  DailyCouponControls,
  DirectRewardDialog,
  RewardSettingsPanel,
} from "@/components/admin-rewards";
import {
  activityIcon,
  adminNavItems,
  AppHeader,
  Avatar,
  AVATARS,
  BottomNav,
  ConsumptionStartDialog,
  EmptyState,
  LiveClock,
  LoadingScreen,
  RewardVisual,
  TaskRewardSummary,
  THEMES,
  TimeCoin,
  Toast,
} from "@/components/shared";
import type {
  AdminState,
  AdminWorker,
  Assignment,
  RewardDefinition,
  RewardRequest,
  Task,
  TaskRewardBinding,
} from "@/components/types";
import { formatDateTime, formatDuration, HOUR, MINUTE } from "@/lib/time";

type AdminTab = "home" | "publish" | "reviews" | "workers" | "settings";

const taskPresets = [
  { title: "读书", description: "认真阅读，并说说今天学到了什么。", minutes: 30, icon: BookOpen },
  { title: "运动", description: "完成一次让身体动起来的运动。", minutes: 30, icon: Sparkles },
  { title: "做好事", description: "主动帮助别人，做一件温暖的小事。", minutes: 20, icon: Gift },
  { title: "得奖", description: "记录今天获得的好成绩或奖项。", minutes: 60, icon: Award },
  { title: "编程", description: "完成今天的编程练习或小作品。", minutes: 45, icon: Settings2 },
  { title: "做家务", description: "认真完成一项家务。", minutes: 20, icon: CheckCircle2 },
];

type TaskRewardDraft = {
  definitionId: string;
  quantity: number;
  probabilityPercent: number;
};

const assignmentStatusLabels: Record<Assignment["status"], string> = {
  claimed: "已参加",
  in_progress: "进行中",
  submitted: "待审核",
  revision_requested: "待完善",
  approved: "已入账",
  rejected: "未通过",
  cancelled: "已取消",
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请再试一次。";
}

async function prepareAvatarImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("原图不能超过 8MB。");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片读取失败，请换一张图片。"));
      element.src = objectUrl;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("图片尺寸无效。");
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备不支持图片处理。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const sourceX = (image.naturalWidth - side) / 2;
    const sourceY = (image.naturalHeight - side) / 2;
    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, 256, 256);
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function AdminApp({
  onSwitch,
  onAuthorizationError,
}: {
  onSwitch: () => void;
  onAuthorizationError: (error: unknown) => boolean;
}) {
  const [state, setState] = useState<AdminState | null>(null);
  const [tab, setTab] = useState<AdminTab>("home");
  const [busy, setBusy] = useState(false);
  const [quickRewardWorkerId, setQuickRewardWorkerId] = useState<string | null>(null);
  const [rewardWorkerId, setRewardWorkerId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const load = useCallback(async (quiet = false) => {
    try {
      const data = await api<AdminState>("/api/admin");
      setState(data);
    } catch (error) {
      if (!onAuthorizationError(error) && !quiet) {
        setToast({ message: messageOf(error), tone: "error" });
      }
    }
  }, [onAuthorizationError]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function mutate(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const data = await api<AdminState>("/api/admin", {
        method: "POST",
        body: JSON.stringify({ ...body, requestId: body.requestId || mutationId() }),
      });
      setState(data);
      setToast({ message: success, tone: "success" });
      return true;
    } catch (error) {
      if (!onAuthorizationError(error)) setToast({ message: messageOf(error), tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <LoadingScreen />;

  const nav = adminNavItems.map((item) =>
    item.id === "reviews" ? { ...item, badge: state.reviews.length + state.rewardRequests.length } : item,
  );

  return (
    <div className="min-h-screen pb-28">
      {toast && <Toast {...toast} />}
      <AppHeader
        title="管理员控制台"
        subtitle={`${state.workers.filter((worker) => worker.isActive).length} 位打工人 · ${state.reviews.length + state.rewardRequests.length} 项待审核`}
        onSwitch={onSwitch}
        admin
      />
      <main className="page-enter mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6">
        {tab === "home" && <AdminHome state={state} setTab={setTab} mutate={mutate} busy={busy} onQuickReward={(workerId) => setQuickRewardWorkerId(workerId || "")} />}
        {tab === "publish" && <PublishPanel state={state} mutate={mutate} busy={busy} />}
        {tab === "reviews" && <ReviewPanel state={state} mutate={mutate} busy={busy} />}
        {tab === "workers" && <WorkersPanel state={state} mutate={mutate} busy={busy} onQuickReward={setQuickRewardWorkerId} onDirectReward={setRewardWorkerId} />}
        {tab === "settings" && (
          <AdminSettings state={state} mutate={mutate} busy={busy} onSwitch={onSwitch} />
        )}
      </main>
      <BottomNav items={nav} active={tab} onChange={setTab} />
      {quickRewardWorkerId !== null && (
        <QuickRewardDialog
          workers={state.workers.filter((worker) => worker.isActive)}
          initialWorkerId={quickRewardWorkerId}
          mutate={mutate}
          busy={busy}
          onClose={() => setQuickRewardWorkerId(null)}
        />
      )}
      {rewardWorkerId !== null && (
        <DirectRewardDialog
          state={state}
          initialWorkerId={rewardWorkerId}
          mutate={mutate}
          busy={busy}
          onClose={() => setRewardWorkerId(null)}
        />
      )}
    </div>
  );
}

function SectionTitle({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-black">{title}</h2>
        {text && <p className="mt-0.5 text-sm font-semibold text-slate-500">{text}</p>}
      </div>
      {action}
    </div>
  );
}

function AdminHome({
  state,
  setTab,
  mutate,
  busy,
  onQuickReward,
}: {
  state: AdminState;
  setTab: (tab: AdminTab) => void;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onQuickReward: (workerId?: string) => void;
}) {
  const activeWorkers = state.workers.filter((worker) => worker.isActive);
  const running = activeWorkers.filter((worker) => worker.activeTimer);
  const today = new Date().toDateString();
  const todayTransactions = state.transactions.filter((transaction) => new Date(transaction.createdAt).toDateString() === today);
  const todayIncome = todayTransactions.filter((item) => item.amountSeconds > 0).reduce((sum, item) => sum + item.amountSeconds, 0);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-3 gap-2 sm:gap-4">
        <button className="app-card min-h-28 px-2 py-4 text-center" onClick={() => setTab("workers")}>
          <UsersRound className="mx-auto text-blue-600" size={27} />
          <strong className="mt-2 block text-2xl">{activeWorkers.length}</strong>
          <span className="text-xs font-bold text-slate-500">打工人</span>
        </button>
        <button className="app-card min-h-28 px-2 py-4 text-center" onClick={() => setTab("reviews")}>
          <ShieldCheck className="mx-auto text-purple-600" size={27} />
          <strong className="mt-2 block text-2xl">{state.reviews.length + state.rewardRequests.length}</strong>
          <span className="text-xs font-bold text-slate-500">待审核</span>
        </button>
        <div className="app-card min-h-28 px-2 py-4 text-center">
          <Clock3 className="mx-auto text-orange-500" size={27} />
          <strong className="mt-2 block text-2xl">{running.length}</strong>
          <span className="text-xs font-bold text-slate-500">计时中</span>
        </div>
      </section>

      <section className="app-card purple-gradient-card overflow-hidden p-5 text-white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-purple-100">今天已发放与奖励</p>
            <div className="mt-2 text-xl sm:text-2xl"><TimeCoin seconds={todayIncome} /></div>
          </div>
          <Gift size={48} className="opacity-80" />
        </div>
        {activeWorkers.length > 0 && (
          <button
            type="button"
            className="mt-4 min-h-11 rounded-2xl bg-white px-4 py-2 font-black text-purple-700 shadow-md"
            onClick={() => onQuickReward(activeWorkers.length === 1 ? activeWorkers[0].id : undefined)}
          >
            <Plus className="mr-1 inline" size={18} />快速补录奖励
          </button>
        )}
      </section>

      {activeWorkers.length === 0 ? (
        <EmptyState
          title="先创建第一个打工人吧"
          text="创建角色、设置 PIN 和每日奖励后，就能开始发布任务。"
          action={<button className="primary-button" onClick={() => setTab("workers")}>去创建</button>}
        />
      ) : (
        <section>
          <SectionTitle title="打工人状态" text="可以在这里代为结束正在运行的计时" />
          <div className="space-y-3">
            {activeWorkers.map((worker) => (
              <div key={worker.id} className="app-card p-4">
                <div className="flex items-center gap-3">
                  <Avatar avatar={worker.avatar} theme={worker.theme} imageUrl={worker.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-black">{worker.name}</h3>
                      {worker.pendingReviewCount > 0 && <span className="pill bg-purple-100 text-purple-700">待审 {worker.pendingReviewCount}</span>}
                    </div>
                    <div className="mt-1 text-sm text-slate-600"><TimeCoin seconds={worker.balanceSeconds} compact /></div>
                  </div>
                </div>
                {worker.activeTimer ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-orange-50 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-orange-800">{worker.activeTimer.title}</p>
                      <LiveClock startedAt={worker.activeTimer.startedAt} className="text-xl text-orange-700" />
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {worker.activeTimer.type === "consumption" && (
                        <button
                          className="secondary-button !min-h-11 !px-2 text-xs"
                          disabled={busy}
                          onClick={() => mutate({ action: "cancel_consumption_timer", workerId: worker.id }, `已撤销 ${worker.name} 的误触计时，本次未扣款`)}
                        >
                          误触撤销
                        </button>
                      )}
                      <button
                        className="danger-button !px-3"
                        disabled={busy}
                        onClick={() => mutate({ action: "timer_stop", workerId: worker.id }, `已帮 ${worker.name} 结束计时`)}
                      >
                        <Pause className="inline" size={18} /> 结束
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-500">现在没有计时</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {state.reviews.length + state.rewardRequests.length > 0 && (
        <button className="primary-button w-full" onClick={() => setTab("reviews")}>
          去审核 {state.reviews.length + state.rewardRequests.length} 个任务
        </button>
      )}
    </div>
  );
}

function TaskRewardBindingEditor({
  title,
  text,
  definitions,
  items,
  onChange,
  tone = "purple",
}: {
  title: string;
  text: string;
  definitions: RewardDefinition[];
  items: TaskRewardDraft[];
  onChange: (items: TaskRewardDraft[]) => void;
  tone?: "purple" | "amber";
}) {
  const addDefinition = (definitionId: string) => {
    if (!definitionId) return;
    const existingIndex = items.findIndex((item) => item.definitionId === definitionId);
    if (existingIndex >= 0) {
      onChange(items.map((item, index) => index === existingIndex
        ? { ...item, quantity: item.quantity + 1 }
        : item));
      return;
    }
    onChange([...items, { definitionId, quantity: 1, probabilityPercent: 100 }]);
  };
  const background = tone === "amber" ? "bg-amber-50" : "bg-purple-50";
  const ink = tone === "amber" ? "text-amber-900" : "text-purple-900";
  return (
    <section className={`rounded-2xl p-4 ${background}`}>
      <div>
        <h3 className={`font-black ${ink}`}>{title}</h3>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{text}</p>
      </div>
      {definitions.length === 0 ? (
        <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm font-bold text-slate-500">请先到“设置 → 奖励设置”创建并启用奖励券模板。</p>
      ) : (
        <select
          className="field mt-3"
          value=""
          onChange={(event) => addDefinition(event.target.value)}
        >
          <option value="">＋ 添加一种奖励券</option>
          {definitions.map((definition) => (
            <option key={definition.id} value={definition.id}>{definition.name}</option>
          ))}
        </select>
      )}
      {items.length === 0 ? (
        <p className="mt-3 text-center text-xs font-bold text-slate-500">可以留空</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => {
            const definition = definitions.find((candidate) => candidate.id === item.definitionId);
            if (!definition) return null;
            return (
              <div key={item.definitionId} className="rounded-2xl bg-white p-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <RewardVisual icon={definition.icon} imageUrl={definition.imageUrl} theme={definition.theme} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="font-black">{definition.name}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {definition.kind === "random_time"
                        ? `${definition.randomMinSeconds! / MINUTE}～${definition.randomMaxSeconds! / MINUTE} 分钟随机时间`
                        : definition.kind === "fixed_time"
                          ? `${definition.fixedSeconds! / MINUTE} 分钟固定时间`
                          : definition.physicalDescription}
                    </p>
                    {definition.kind === "physical" && definition.fulfillmentInstructions && (
                      <p className="mt-1 text-xs font-semibold text-slate-500">交付：{definition.fulfillmentInstructions}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-red-500 hover:bg-red-50"
                    aria-label={`删除 ${definition.name}`}
                    onClick={() => onChange(items.filter((candidate) => candidate.definitionId !== item.definitionId))}
                  >
                    <XCircle size={20} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label>
                    <span className="label">数量（张）</span>
                    <input
                      className="field"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={item.quantity}
                      onChange={(event) => onChange(items.map((candidate) => candidate.definitionId === item.definitionId
                        ? { ...candidate, quantity: Number(event.target.value) }
                        : candidate))}
                    />
                  </label>
                  <label>
                    <span className="label">每张出现概率（%）</span>
                    <input
                      className="field"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      value={item.probabilityPercent}
                      onChange={(event) => onChange(items.map((candidate) => candidate.definitionId === item.definitionId
                        ? { ...candidate, probabilityPercent: Number(event.target.value) }
                        : candidate))}
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs font-bold text-purple-700">
                  {item.probabilityPercent === 100
                    ? "100%：每张都一定获得"
                    : `${item.quantity > 1 ? `${item.quantity} 张分别` : "这张"}独立判定 ${item.probabilityPercent}% 概率`}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PublishPanel({
  state,
  mutate,
  busy,
}: {
  state: AdminState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewardMinutes, setRewardMinutes] = useState("30");
  const [targetWorkerId, setTargetWorkerId] = useState("");
  const [timingMode, setTimingMode] = useState<"none" | "optional" | "required">("optional");
  const [minimumMinutes, setMinimumMinutes] = useState("10");
  const [bonusEnabled, setBonusEnabled] = useState(false);
  const [excellentMultiplier, setExcellentMultiplier] = useState("2");
  const [bonusCriteria, setBonusCriteria] = useState("");
  const [normalRewards, setNormalRewards] = useState<TaskRewardDraft[]>([]);
  const [excellentRewards, setExcellentRewards] = useState<TaskRewardDraft[]>([]);
  const [dueValue, setDueValue] = useState("");
  const [assignNow, setAssignNow] = useState(false);
  const [formError, setFormError] = useState("");
  const [showTimingHelp, setShowTimingHelp] = useState(false);

  function fillPreset(preset: (typeof taskPresets)[number]) {
    setTitle(preset.title);
    setDescription(preset.description);
    setRewardMinutes(String(preset.minutes));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const rewardMinutesNumber = Number(rewardMinutes);
    const minimumMinutesNumber = Number(minimumMinutes);
    const excellentMultiplierNumber = Number(excellentMultiplier);
    const dueAt = dueValue ? new Date(dueValue).getTime() : null;
    if (!Number.isInteger(rewardMinutesNumber) || rewardMinutesNumber < 1 || rewardMinutesNumber > 1440) {
      setFormError("基础奖励请填写 1～1440 的整数分钟。");
      return;
    }
    if (timingMode === "required" && (!Number.isInteger(minimumMinutesNumber) || minimumMinutesNumber < 1 || minimumMinutesNumber > 1440)) {
      setFormError("必需计时请填写 1～1440 的整数分钟。");
      return;
    }
    if (dueValue && !Number.isFinite(dueAt)) {
      setFormError("截止时间格式不正确，请重新选择。");
      return;
    }
    if (bonusEnabled && !bonusCriteria.trim()) {
      setFormError("请填写优秀完成标准。");
      return;
    }
    if (bonusEnabled && (!Number.isFinite(excellentMultiplierNumber) || excellentMultiplierNumber < 1)) {
      setFormError("优秀完成的基础时数倍率必须大于或等于 1。");
      return;
    }
    const allRewardDrafts = [...normalRewards, ...(bonusEnabled ? excellentRewards : [])];
    if (allRewardDrafts.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
      setFormError("每种奖励券的数量必须是正整数。");
      return;
    }
    if (allRewardDrafts.some((item) => !Number.isInteger(item.probabilityPercent) || item.probabilityPercent < 0 || item.probabilityPercent > 100)) {
      setFormError("奖励券出现概率必须是 0～100 的整数。");
      return;
    }
    setFormError("");
    const ok = await mutate({
      action: "create_task",
      title,
      description,
      rewardSeconds: rewardMinutesNumber * MINUTE,
      targetWorkerId: targetWorkerId || null,
      timingMode,
      minimumDurationSeconds: timingMode === "required" ? minimumMinutesNumber * MINUTE : null,
      bonusEnabled,
      excellentMultiplier: bonusEnabled ? excellentMultiplierNumber : 2,
      bonusCriteria: bonusEnabled ? bonusCriteria : null,
      rewardBindings: [
        ...normalRewards.map((item) => ({ ...item, grantTier: "normal" as const })),
        ...(bonusEnabled
          ? excellentRewards.map((item) => ({ ...item, grantTier: "excellent_bonus" as const }))
          : []),
      ],
      dueAt,
      assignNow: Boolean(assignNow && targetWorkerId),
    }, "任务发布成功");
    if (ok) {
      setTitle("");
      setDescription("");
      setBonusEnabled(false);
      setExcellentMultiplier("2");
      setBonusCriteria("");
      setNormalRewards([]);
      setExcellentRewards([]);
      setAssignNow(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle title="发布奖励任务" text="先用快捷项填充，再按需要修改" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {taskPresets.map((preset) => {
            const Icon = preset.icon;
            return (
              <button key={preset.title} type="button" onClick={() => fillPreset(preset)} className="soft-card min-h-20 px-2 py-3 text-center font-black text-slate-700">
                <Icon className="mx-auto mb-1 text-purple-600" size={22} />
                {preset.title}
              </button>
            );
          })}
        </div>
      </section>

      <form onSubmit={submit} className="app-card space-y-4 p-4 sm:p-6">
        <label>
          <span className="label">任务名称</span>
          <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：读书 30 分钟" required maxLength={60} />
        </label>
        <label>
          <span className="label">任务说明</span>
          <textarea className="field min-h-24 resize-y" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="用简单的话说清楚怎样算完成" maxLength={600} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">基础奖励（分钟）</span>
            <input className="field" type="number" inputMode="numeric" min={1} max={1440} value={rewardMinutes} onChange={(event) => setRewardMinutes(event.target.value)} />
          </label>
          <label>
            <span className="label">发布给谁</span>
            <select className="field" value={targetWorkerId} onChange={(event) => setTargetWorkerId(event.target.value)}>
              <option value="">全部打工人</option>
              {state.workers.filter((worker) => worker.isActive).map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <label htmlFor="timing-mode" className="label !mb-0">计时要求</label>
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-full text-purple-600 hover:bg-purple-100"
                aria-label="查看计时要求说明"
                title="查看计时要求说明"
                aria-haspopup="dialog"
                onClick={() => setShowTimingHelp(true)}
              >
                <CircleHelp size={19} strokeWidth={2.8} />
              </button>
            </div>
            <select id="timing-mode" className="field mt-2" value={timingMode} onChange={(event) => setTimingMode(event.target.value as typeof timingMode)}>
              <option value="none">不需要计时</option>
              <option value="optional">可以计时</option>
              <option value="required">必须计时</option>
            </select>
          </div>
          {timingMode === "required" && (
            <label>
              <span className="label">至少计时（分钟）</span>
              <input className="field" type="number" min={1} max={1440} value={minimumMinutes} onChange={(event) => setMinimumMinutes(event.target.value)} />
            </label>
          )}
          <label className={timingMode === "required" ? "col-span-2" : ""}>
            <span className="label">截止时间（可选）</span>
            <input className="field" type="datetime-local" value={dueValue} onChange={(event) => setDueValue(event.target.value)} />
          </label>
        </div>
        <label className="flex min-h-13 items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 font-black text-amber-900">
          <input
            className="h-5 w-5 accent-purple-600"
            type="checkbox"
            checked={bonusEnabled}
            onChange={(event) => {
              setBonusEnabled(event.target.checked);
              if (!event.target.checked) setExcellentRewards([]);
            }}
          />
          开启优秀完成奖励
        </label>
        {bonusEnabled && (
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <label>
              <span className="label">优秀基础时数倍率</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-black text-purple-700">×</span>
                <input className="field !pl-8" type="number" inputMode="decimal" min={1} step={0.1} value={excellentMultiplier} onChange={(event) => setExcellentMultiplier(event.target.value)} />
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">可填 ×1、×2、×3 或小数</p>
            </label>
            <label>
              <span className="label">优秀完成标准</span>
              <textarea className="field min-h-20" value={bonusCriteria} onChange={(event) => setBonusCriteria(event.target.value)} required placeholder="例如：能完整讲出故事内容并分享自己的想法" />
            </label>
          </div>
        )}
        <TaskRewardBindingEditor
          title="普通奖励券"
          text="正常完成和优秀完成都会参与；每张券按自己的概率独立判定。"
          definitions={state.rewardDefinitions.filter((definition) => definition.isActive)}
          items={normalRewards}
          onChange={setNormalRewards}
        />
        {bonusEnabled && (
          <TaskRewardBindingEditor
            title="优秀额外奖励券"
            text="只有审核为优秀完成时参与，普通奖励券不会跟随基础时数倍率增加。"
            definitions={state.rewardDefinitions.filter((definition) => definition.isActive)}
            items={excellentRewards}
            onChange={setExcellentRewards}
            tone="amber"
          />
        )}
        <div>
          <p className="label">奖励预览</p>
          <TaskRewardSummary
            baseRewardSeconds={Number.isFinite(Number(rewardMinutes)) ? Number(rewardMinutes) * MINUTE : 0}
            excellentMultiplier={bonusEnabled && Number.isFinite(Number(excellentMultiplier)) ? Number(excellentMultiplier) : 2}
            bonusEnabled={bonusEnabled}
            items={[
              ...normalRewards.flatMap((item): TaskRewardBinding[] => {
                const definition = state.rewardDefinitions.find((candidate) => candidate.id === item.definitionId);
                return definition ? [{ ...definition, bindingId: `normal:${item.definitionId}`, definitionId: item.definitionId, grantTier: "normal", quantity: item.quantity, probabilityPercent: item.probabilityPercent }] : [];
              }),
              ...excellentRewards.flatMap((item): TaskRewardBinding[] => {
                const definition = state.rewardDefinitions.find((candidate) => candidate.id === item.definitionId);
                return definition ? [{ ...definition, bindingId: `excellent:${item.definitionId}`, definitionId: item.definitionId, grantTier: "excellent_bonus", quantity: item.quantity, probabilityPercent: item.probabilityPercent }] : [];
              }),
            ]}
          />
        </div>
        {formError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{formError}</p>}
        {targetWorkerId && (
          <label className="flex items-center gap-3 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-black text-blue-800">
            <input className="h-5 w-5" type="checkbox" checked={assignNow} onChange={(event) => setAssignNow(event.target.checked)} />
            发布后直接分配给这个打工人
          </label>
        )}
        <button className="primary-button w-full" disabled={busy || !title.trim() || !Number.isInteger(Number(rewardMinutes)) || Number(rewardMinutes) < 1 || Number(rewardMinutes) > 1440 || (timingMode === "required" && (!Number.isInteger(Number(minimumMinutes)) || Number(minimumMinutes) < 1 || Number(minimumMinutes) > 1440)) || (bonusEnabled && (!bonusCriteria.trim() || !Number.isFinite(Number(excellentMultiplier)) || Number(excellentMultiplier) < 1))}>
          <Send className="mr-2 inline" size={19} /> {busy ? "正在发布…" : "发布任务"}
        </button>
      </form>

      {showTimingHelp && <TimingHelpDialog onClose={() => setShowTimingHelp(false)} />}

      <section>
        <SectionTitle title="已发布任务" text="有人参加后，奖励规则会保持不变" />
        {state.tasks.length === 0 ? (
          <EmptyState title="还没有任务" text="从上面的快捷任务开始发布吧。" />
        ) : (
          <div className="space-y-3">
            {state.tasks.map((task) => (
              <TaskAdminCard key={task.id} task={task} workers={state.workers} mutate={mutate} busy={busy} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function QuickRewardDialog({
  workers,
  initialWorkerId,
  mutate,
  busy,
  onClose,
}: {
  workers: AdminWorker[];
  initialWorkerId: string;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onClose: () => void;
}) {
  const [workerId, setWorkerId] = useState(() => {
    if (initialWorkerId && workers.some((worker) => worker.id === initialWorkerId)) return initialWorkerId;
    return workers.length === 1 ? workers[0].id : "";
  });
  const [title, setTitle] = useState("");
  const [rewardMinutes, setRewardMinutes] = useState("30");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function fillPreset(preset: (typeof taskPresets)[number]) {
    setTitle(preset.title);
    setRewardMinutes(String(preset.minutes));
    setNote(preset.description);
    setFormError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = Number(rewardMinutes);
    if (!workerId) {
      setFormError("请选择要发放奖励的打工人。");
      return;
    }
    if (!title.trim()) {
      setFormError("请填写奖励任务名称。");
      return;
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > 1440) {
      setFormError("奖励时数请填写 1～1440 的整数分钟。");
      return;
    }
    setFormError("");
    const worker = workers.find((item) => item.id === workerId);
    const ok = await mutate(
      {
        action: "quick_reward",
        workerId,
        title: title.trim(),
        rewardSeconds: amount * MINUTE,
        note: note.trim(),
      },
      `已为 ${worker?.name || "打工人"} 补录 ${formatDuration(amount * MINUTE, false)}`,
    );
    if (ok) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="page-enter max-h-[calc(100vh-24px)] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-reward-title"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <Gift size={24} strokeWidth={2.8} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="quick-reward-title" className="text-xl font-black">快速补录奖励</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">适合补记已经完成、但来不及提前发布的奖励任务。</p>
          </div>
          <button type="button" className="secondary-button !min-h-10 !w-10 !p-0" aria-label="关闭快速补录" disabled={busy} onClick={onClose}>×</button>
        </div>

        <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black leading-6 text-emerald-800">
          提交后会立即增加余额并写入“任务奖励”明细，不需要再次审核。
        </div>

        <div className="mt-5">
          <span className="label">常用奖励</span>
          <div className="grid grid-cols-3 gap-2">
            {taskPresets.map((preset) => {
              const Icon = preset.icon;
              return (
                <button key={preset.title} type="button" className="soft-card min-h-16 px-2 py-2 text-center text-sm font-black text-slate-700" onClick={() => fillPreset(preset)}>
                  <Icon className="mx-auto mb-0.5 text-emerald-600" size={19} />
                  {preset.title}
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <label>
            <span className="label">发给谁</span>
            <select className="field" value={workerId} onChange={(event) => setWorkerId(event.target.value)} required>
              <option value="">请选择打工人</option>
              {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}（当前 {formatDuration(worker.balanceSeconds, false)}）</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="label">奖励任务名称</span>
              <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：整理房间" maxLength={60} required />
            </label>
            <label>
              <span className="label">奖励分钟</span>
              <input className="field" type="number" inputMode="numeric" min={1} max={1440} step={1} value={rewardMinutes} onChange={(event) => setRewardMinutes(event.target.value)} required />
            </label>
          </div>
          <label>
            <span className="label">补录说明（可选）</span>
            <textarea className="field min-h-20 resize-y" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：昨天已完成，今天补录" maxLength={500} />
          </label>
          {formError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{formError}</p>}
          <button className="success-button w-full" disabled={busy || !workerId || !title.trim() || !Number.isInteger(Number(rewardMinutes)) || Number(rewardMinutes) < 1 || Number(rewardMinutes) > 1440}>
            <Gift className="mr-1 inline" size={19} />{busy ? "正在发放…" : "立即发放并记录"}
          </button>
        </form>
      </section>
    </div>
  );
}

function TimingHelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="page-enter max-h-[calc(100vh-24px)] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="timing-help-title"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-purple-100 text-purple-700">
            <Clock3 size={24} strokeWidth={2.8} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="timing-help-title" className="text-xl font-black">计时要求是什么意思？</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">它决定要不要记录做任务的时间，以及提交时是否有最低时长要求。</p>
          </div>
          <button type="button" className="secondary-button !min-h-10 !w-10 !p-0" aria-label="关闭说明" onClick={onClose}>×</button>
        </div>

        <div className="mt-5 space-y-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="font-black text-slate-800">不需要计时</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">不用打开计时器，完成后直接写完成说明并提交审核。适合“整理房间、做好事、得奖”这类不方便按时间计算的任务。</p>
          </div>
          <div className="rounded-2xl bg-blue-50 p-4">
            <p className="font-black text-blue-800">可以计时</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-blue-900">可以打开计时器记录用了多久，也可以不计时；没有最低时长限制。适合读书、编程、运动等想顺便记录过程的任务。</p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-4">
            <p className="font-black text-amber-900">必须计时</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-amber-900">提交前必须累计达到下方填写的最低分钟数，例如“至少计时 30 分钟”。计时可以暂停后继续，未达到要求时不能提交审核。</p>
          </div>
        </div>
        <p className="mt-4 rounded-2xl bg-purple-50 px-4 py-3 text-sm font-black leading-6 text-purple-800">三种模式都不会自动发奖励；奖励时数以任务设定为准，完成后还要经过管理员审核。</p>
        <button type="button" className="primary-button mt-5 w-full" onClick={onClose}>知道了</button>
      </section>
    </div>
  );
}

function TaskAdminCard({
  task,
  workers,
  mutate,
  busy,
}: {
  task: Task;
  workers: AdminWorker[];
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [assignWorker, setAssignWorker] = useState("");
  const availableWorkers = workers.filter((worker) => worker.isActive && !(task.assignedWorkerIds || []).includes(worker.id) && (!task.targetWorkerId || task.targetWorkerId === worker.id));
  return (
    <div className={`app-card p-4 ${task.status === "closed" ? "opacity-65" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-black">{task.title}</h3>
            {task.bonusEnabled && <span className="pill bg-amber-100 text-amber-800">优秀 ×{task.excellentMultiplier}</span>}
            <span className={`pill ${task.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{task.status === "published" ? "发布中" : "已关闭"}</span>
          </div>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">{task.description || "没有额外说明"}</p>
        </div>
        <div className="shrink-0 text-sm text-purple-700"><TimeCoin seconds={task.rewardSeconds} compact /></div>
      </div>
      <div className="mt-3">
        <TaskRewardSummary
          baseRewardSeconds={task.rewardSeconds}
          excellentMultiplier={task.excellentMultiplier}
          bonusEnabled={task.bonusEnabled}
          items={task.rewardBindings}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
        <span>已参加 {task.assignmentCount || 0}</span>
        <span>·</span>
        <span>{task.targetWorkerId ? workers.find((worker) => worker.id === task.targetWorkerId)?.name || "指定角色" : "全部打工人"}</span>
        {task.dueAt && <><span>·</span><span>截止 {formatDateTime(task.dueAt)}</span></>}
      </div>
      {task.status === "published" && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          {availableWorkers.length > 0 && (
            <div className="flex flex-1 gap-2">
              <select className="field !min-h-11 flex-1" value={assignWorker} onChange={(event) => setAssignWorker(event.target.value)}>
                <option value="">选择代分配对象</option>
                {availableWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
              </select>
              <button className="secondary-button !min-h-11 !px-3" disabled={busy || !assignWorker} onClick={() => mutate({ action: "assign_task", taskId: task.id, workerId: assignWorker }, "任务已分配")}>分配</button>
            </div>
          )}
          <button className="danger-button !min-h-11 !px-3" disabled={busy} onClick={() => mutate({ action: "close_task", taskId: task.id }, "任务已关闭")}>关闭</button>
        </div>
      )}
    </div>
  );
}

function ReviewPanel({
  state,
  mutate,
  busy,
}: {
  state: AdminState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [durationMinutes, setDurationMinutes] = useState<Record<string, string>>({});
  if (state.reviews.length === 0 && state.rewardRequests.length === 0) {
    return <EmptyState title="全部审核完啦" text="任务提交或自主奖励申报会出现在这里。" />;
  }
  return (
    <div className="space-y-7">
      {state.rewardRequests.length > 0 && (
        <section>
          <SectionTitle title="自主申报奖励" text="打工人自己填写的任务，只有通过后才会发放" />
          <div className="space-y-4">
            {state.rewardRequests.map((rewardRequest) => (
              <RewardRequestReviewCard
                key={rewardRequest.id}
                rewardRequest={rewardRequest}
                worker={state.workers.find((worker) => worker.id === rewardRequest.workerId)}
                mutate={mutate}
                busy={busy}
              />
            ))}
          </div>
        </section>
      )}

      {state.reviews.length > 0 && (
        <section>
          <SectionTitle title="管理员发布任务" text="按提交顺序排列，先看看最早提交的任务" />
          <div className="space-y-4">
            {[...state.reviews].sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0)).map((assignment) => {
              const worker = state.workers.find((item) => item.id === assignment.workerId);
              const note = notes[assignment.id] || "";
              const review = async (decision: "approve" | "excellent" | "revision" | "reject") => {
                const ok = await mutate({ action: "review", assignmentId: assignment.id, decision, note }, decision === "excellent" ? "优秀完成奖励已结算" : decision === "approve" ? "正常完成奖励已结算" : "审核结果已发送");
                if (ok) setNotes((value) => ({ ...value, [assignment.id]: "" }));
              };
              return (
                <div key={assignment.id} className="app-card overflow-hidden">
                  <div className="review-gradient-card p-4">
                    <div className="flex items-center gap-3">
                      {worker && <Avatar avatar={worker.avatar} theme={worker.theme} imageUrl={worker.avatarUrl} size={48} />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-purple-600">{worker?.name || "打工人"} 提交了</p>
                        <h3 className="truncate text-lg font-black">{assignment.title}</h3>
                      </div>
                      <TimeCoin seconds={assignment.rewardSeconds} compact />
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    <p className="text-sm font-semibold leading-6 text-slate-600">{assignment.description || "没有额外任务说明"}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-blue-50 p-3">
                        <p className="text-xs font-bold text-blue-600">累计计时</p>
                        <p className="mt-1 font-black text-blue-900">{formatDuration(assignment.durationSeconds)}</p>
                      </div>
                      <div className="rounded-2xl bg-amber-50 p-3">
                        <p className="text-xs font-bold text-amber-700">优秀规则</p>
                        <p className="mt-1 text-sm font-black text-amber-900">{assignment.bonusEnabled ? `基础时数 ×${assignment.excellentMultiplier}` : "本任务未开启优秀完成"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 rounded-2xl bg-blue-50 p-3">
                      <input
                        className="field"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={1440}
                        step={1}
                        placeholder={`修正累计分钟（当前 ${formatDuration(assignment.durationSeconds, false)}）`}
                        value={durationMinutes[assignment.id] || ""}
                        disabled={busy || Boolean(worker?.activeTimer)}
                        onChange={(event) => setDurationMinutes((value) => ({ ...value, [assignment.id]: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="secondary-button shrink-0 !px-3"
                        disabled={busy || Boolean(worker?.activeTimer) || (durationMinutes[assignment.id] ?? "") === "" || !Number.isInteger(Number(durationMinutes[assignment.id])) || Number(durationMinutes[assignment.id]) < 0 || Number(durationMinutes[assignment.id]) > 1440}
                        onClick={async () => {
                          const ok = await mutate({ action: "set_assignment_duration", assignmentId: assignment.id, durationSeconds: Number(durationMinutes[assignment.id]) * MINUTE }, "任务累计时长已修正");
                          if (ok) setDurationMinutes((value) => ({ ...value, [assignment.id]: "" }));
                        }}
                      >
                        修改
                      </button>
                    </div>
                    {worker?.activeTimer && <p className="text-xs font-bold text-amber-700">该角色正在计时，结束计时后才能修正累计时长。</p>}
                    {assignment.bonusCriteria && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">优秀标准：{assignment.bonusCriteria}</p>}
                    <TaskRewardSummary
                      baseRewardSeconds={assignment.rewardSeconds}
                      excellentMultiplier={assignment.excellentMultiplier}
                      bonusEnabled={assignment.bonusEnabled}
                      items={assignment.rewardItems}
                    />
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-xs font-bold text-slate-500">完成说明</p>
                      <p className="mt-1 font-semibold text-slate-700">{assignment.submissionNote || "没有填写"}</p>
                    </div>
                    <label>
                      <span className="label">审核评语（优秀、退回或未通过时必填）</span>
                      <textarea className="field min-h-20" value={note} onChange={(event) => setNotes((value) => ({ ...value, [assignment.id]: event.target.value }))} placeholder="写一句鼓励或需要改进的地方" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="success-button" disabled={busy} onClick={() => review("approve")}><CheckCircle2 className="mr-1 inline" size={18} />正常完成</button>
                      <button className="primary-button" disabled={busy || !assignment.bonusEnabled || !note.trim()} onClick={() => review("excellent")}><Sparkles className="mr-1 inline" size={18} />优秀完成 ×{assignment.excellentMultiplier}</button>
                      <button className="secondary-button" disabled={busy || !note.trim()} onClick={() => review("revision")}><RefreshCw className="mr-1 inline" size={18} />退回完善</button>
                      <button className="danger-button" disabled={busy || !note.trim()} onClick={() => review("reject")}><XCircle className="mr-1 inline" size={18} />未通过</button>
                    </div>
                    <button
                      type="button"
                      className="secondary-button w-full"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`确定撤销“${assignment.title}”吗？本次不会发放奖励，之后仍可重新参加。`)) {
                          void mutate({ action: "cancel_assignment", assignmentId: assignment.id, reason: "管理员撤销误操作任务" }, "任务已撤销");
                        }
                      }}
                    >
                      <XCircle className="mr-1 inline" size={18} />撤销误操作任务
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function RewardRequestReviewCard({
  rewardRequest,
  worker,
  mutate,
  busy,
}: {
  rewardRequest: RewardRequest;
  worker?: AdminWorker;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [note, setNote] = useState("");

  async function review(decision: "approve" | "revision" | "reject") {
    const ok = await mutate(
      { action: "review_reward_request", rewardRequestId: rewardRequest.id, decision, note },
      decision === "approve" ? "自主申报奖励已入账" : "审核结果已发送",
    );
    if (ok) setNote("");
  }

  return (
    <div className="app-card overflow-hidden">
      <div className="review-gradient-card p-4">
        <div className="flex items-center gap-3">
          {worker && <Avatar avatar={worker.avatar} theme={worker.theme} imageUrl={worker.avatarUrl} size={48} />}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black text-purple-600">{rewardRequest.workerName || worker?.name || "打工人"} 自主申报</p>
            <h3 className="truncate text-lg font-black">{rewardRequest.title}</h3>
          </div>
          <TimeCoin seconds={rewardRequest.rewardSeconds} compact />
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-500">完成说明</p>
          <p className="mt-1 whitespace-pre-wrap font-semibold leading-6 text-slate-700">{rewardRequest.description || "没有填写额外说明"}</p>
        </div>
        <p className="text-xs font-bold text-slate-500">申报于 {formatDateTime(rewardRequest.createdAt)}</p>
        <label>
          <span className="label">审核评语（退回或未通过时必填）</span>
          <textarea className="field min-h-20" value={note} onChange={(event) => setNote(event.target.value)} placeholder="写一句鼓励或需要补充的地方" maxLength={500} />
        </label>
        <button className="success-button w-full" disabled={busy} onClick={() => review("approve")}>
          <CheckCircle2 className="mr-1 inline" size={18} />通过并发放 {formatDuration(rewardRequest.rewardSeconds, false)}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="secondary-button" disabled={busy || !note.trim()} onClick={() => review("revision")}><RefreshCw className="mr-1 inline" size={18} />退回修改</button>
          <button className="danger-button" disabled={busy || !note.trim()} onClick={() => review("reject")}><XCircle className="mr-1 inline" size={18} />不通过</button>
        </div>
      </div>
    </div>
  );
}

function WorkersPanel({
  state,
  mutate,
  busy,
  onQuickReward,
  onDirectReward,
}: {
  state: AdminState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onQuickReward: (workerId: string) => void;
  onDirectReward: (workerId: string) => void;
}) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [avatar, setAvatar] = useState("star");
  const [theme, setTheme] = useState("purple");
  const [dailyMinutes, setDailyMinutes] = useState(120);
  const [showCreate, setShowCreate] = useState(state.workers.length === 0);

  async function create(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "create_worker", name, password: pin, avatar, theme, dailyRewardSeconds: dailyMinutes * MINUTE }, "打工人创建成功");
    if (ok) {
      setName("");
      setPin("");
      setShowCreate(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle title="角色管理" text="每日奖励修改后不会追溯当天已经发放的时数" />
        {state.workers.length === 0 ? <EmptyState title="还没有打工人" text="点击下方按钮创建第一个角色。" /> : (
          <div className="space-y-4">
            {state.workers.map((worker) => <WorkerManageCard key={worker.id} worker={worker} state={state} mutate={mutate} busy={busy} onQuickReward={onQuickReward} onDirectReward={onDirectReward} />)}
          </div>
        )}
      </section>

      <section className="border-t border-purple-100 pt-5">
        <button
          type="button"
          className={showCreate ? "secondary-button w-full" : "primary-button w-full"}
          onClick={() => setShowCreate((value) => !value)}
        >
          <UserPlus className="mr-2 inline" size={19} />{showCreate ? "收起创建表单" : "创建新角色"}
        </button>
        {showCreate && (
          <form onSubmit={create} className="app-card page-enter mt-3 p-4 sm:p-6">
            <SectionTitle title="创建打工人" text="每个角色都有自己的 PIN 和时间小金库" />
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="label">角色名称</span>
                <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：小明" required maxLength={30} />
              </label>
              <label>
                <span className="label">独立 PIN（至少 4 位）</span>
                <input className="field" type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} minLength={4} maxLength={20} required />
              </label>
            </div>
            <div className="mt-4">
              <span className="label">选择系统头像</span>
              <div className="flex flex-wrap gap-2">
                {AVATARS.map((item) => (
                  <button key={item} type="button" className={`rounded-2xl p-1 ${avatar === item ? "ring-3 ring-purple-400" : ""}`} onClick={() => setAvatar(item)}>
                    <Avatar avatar={item} theme={theme} size={48} />
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">创建后可在角色卡片中上传照片头像。</p>
            </div>
            <div className="mt-4">
              <span className="label">主题颜色</span>
              <div className="flex flex-wrap gap-3">
                {THEMES.map((item) => (
                  <button key={item} type="button" aria-label={`选择 ${item} 主题`} className={`h-11 w-11 rounded-full border-4 ${theme === item ? "border-slate-700" : "border-white"}`} style={{ background: item === "purple" ? "#9275ef" : item === "blue" ? "#73c8ed" : item === "green" ? "#72cf98" : item === "orange" ? "#f6b660" : "#ed8fba" }} onClick={() => setTheme(item)} />
                ))}
              </div>
            </div>
            <label className="mt-4 block">
              <span className="label">每日固定奖励</span>
              <select className="field" value={dailyMinutes} onChange={(event) => setDailyMinutes(Number(event.target.value))}>
                <option value={0}>关闭</option><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={120}>2 小时（默认）</option><option value={180}>3 小时</option>
              </select>
            </label>
            <button className="primary-button mt-5 w-full" disabled={busy || !name || pin.length < 4}><UserPlus className="mr-2 inline" size={19} />创建角色</button>
          </form>
        )}
      </section>
    </div>
  );
}

function WorkerManageCard({
  worker,
  state,
  mutate,
  busy,
  onQuickReward,
  onDirectReward,
}: {
  worker: AdminWorker;
  state: AdminState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onQuickReward: (workerId: string) => void;
  onDirectReward: (workerId: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [adjustMinutes, setAdjustMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [timerTarget, setTimerTarget] = useState("");
  const [pendingConsumptionId, setPendingConsumptionId] = useState<string | null>(null);
  const [customDailyMinutes, setCustomDailyMinutes] = useState("");
  const [manualActivityId, setManualActivityId] = useState(state.activities.find((activity) => activity.isActive)?.id || "");
  const [manualConsumptionMinutes, setManualConsumptionMinutes] = useState("");
  const timerAssignments = worker.assignments.filter((assignment) => ["claimed", "in_progress", "revision_requested"].includes(assignment.status) && assignment.timingMode !== "none");
  const editableAssignments = worker.assignments.filter((assignment) => ["claimed", "in_progress", "submitted", "revision_requested"].includes(assignment.status));
  const activeActivities = state.activities.filter((activity) => activity.isActive);
  const pendingConsumption = activeActivities.find((activity) => activity.id === pendingConsumptionId);
  const selectedManualActivity = activeActivities.some((activity) => activity.id === manualActivityId)
    ? manualActivityId
    : activeActivities[0]?.id || "";
  const manualConsumptionMinutesNumber = Number(manualConsumptionMinutes);
  const dailyPresets = [0, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR];

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imageDataUrl = await prepareAvatarImage(file);
      await mutate({ action: "upload_worker_avatar", workerId: worker.id, imageDataUrl }, `${worker.name} 的头像已更新`);
    } catch (error) {
      window.alert(messageOf(error));
    } finally {
      input.value = "";
    }
  }

  return (
    <div className={`app-card p-4 ${worker.isActive ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-3">
        <Avatar avatar={worker.avatar} theme={worker.theme} imageUrl={worker.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h3 className="truncate text-lg font-black">{worker.name}</h3>{!worker.isActive && <span className="pill bg-slate-100 text-slate-500">已停用</span>}</div>
          <div className="mt-1 text-sm"><TimeCoin seconds={worker.balanceSeconds} compact /></div>
        </div>
        {worker.isActive && (
          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              className="primary-button !min-h-10 !px-3 text-sm"
              disabled={busy || !state.rewardSystemEnabled || state.rewardDefinitions.filter((item) => item.isActive).length === 0}
              onClick={() => onDirectReward(worker.id)}
            >
              <Gift className="mr-1 inline" size={17} />发奖励券
            </button>
            <button
              type="button"
              className="secondary-button !min-h-10 !px-3 text-sm"
              disabled={busy}
              onClick={() => onQuickReward(worker.id)}
            >
              补录分钟
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className={`secondary-button cursor-pointer text-center ${worker.avatarUrl ? "" : "col-span-2"} ${busy ? "pointer-events-none opacity-60" : ""}`}>
          <ImagePlus className="mr-1 inline" size={18} />{worker.avatarUrl ? "更换头像" : "上传照片头像"}
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => void uploadAvatar(event)}
          />
        </label>
        {worker.avatarUrl ? (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`确定把 ${worker.name} 恢复为系统图标头像吗？`)) {
                void mutate({ action: "remove_worker_avatar", workerId: worker.id }, "已恢复系统图标头像");
              }
            }}
          >
            恢复系统图标
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs font-semibold text-slate-500">照片会在本机裁成正方形并压缩后保存到 SQLite。</p>

      {!worker.isActive && (
        <button className="success-button mt-4 w-full" disabled={busy} onClick={() => mutate({ action: "update_worker", workerId: worker.id, isActive: true }, "角色已重新启用")}>重新启用角色</button>
      )}
      {worker.isActive && (
        <div className="mt-4 space-y-3 border-t border-purple-100 pt-4">
          <label>
            <span className="label">每日固定奖励</span>
            <select className="field" value={worker.dailyRewardSeconds} disabled={busy} onChange={(event) => mutate({ action: "update_worker", workerId: worker.id, dailyRewardSeconds: Number(event.target.value) }, "每日奖励已更新")}>
              {!dailyPresets.includes(worker.dailyRewardSeconds) && <option value={worker.dailyRewardSeconds}>当前：{formatDuration(worker.dailyRewardSeconds, false)}</option>}
              <option value={0}>关闭</option><option value={30 * MINUTE}>30 分钟</option><option value={HOUR}>1 小时</option><option value={2 * HOUR}>2 小时</option><option value={3 * HOUR}>3 小时</option>
            </select>
          </label>

          <DailyCouponControls worker={worker} mutate={mutate} busy={busy} />

          {worker.activeTimer ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-orange-50 p-3">
              <div className="min-w-0"><p className="truncate text-sm font-black text-orange-800">{worker.activeTimer.title}</p><LiveClock startedAt={worker.activeTimer.startedAt} className="text-xl text-orange-700" /></div>
              <div className="flex shrink-0 gap-1.5">
                {worker.activeTimer.type === "consumption" && <button className="secondary-button !min-h-11 !px-2 text-xs" disabled={busy} onClick={() => mutate({ action: "cancel_consumption_timer", workerId: worker.id }, "误触消耗已撤销，本次未扣款")}>误触撤销</button>}
                <button className="danger-button !px-3" disabled={busy} onClick={() => mutate({ action: "timer_stop", workerId: worker.id }, "计时已结束")}><Pause className="inline" size={17} /> 结束</button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-blue-50 p-3">
              <span className="label">帮打工人计时</span>
              {timerAssignments.length > 0 && (
                <div className="flex gap-2">
                  <select className="field !min-h-11 flex-1" value={timerTarget} onChange={(event) => setTimerTarget(event.target.value)}><option value="">选择奖励任务</option>{timerAssignments.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>
                  <button className="secondary-button !min-h-11 !px-3" disabled={busy || !timerTarget} onClick={() => mutate({ action: "timer_start", workerId: worker.id, timerType: "reward_task", targetId: timerTarget }, "已开始任务计时")}><Play size={17} /></button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {state.activities.filter((activity) => activity.isActive).map((activity) => {
                  const Icon = activityIcon(activity.icon);
                  return <button key={activity.id} className="secondary-button !min-h-10 !px-3 text-sm" disabled={busy || worker.balanceSeconds <= 0} onClick={() => setPendingConsumptionId(activity.id)}><Icon className="mr-1 inline" size={16} />{activity.name}</button>;
                })}
              </div>
            </div>
          )}

          {!worker.activeTimer && activeActivities.length > 0 && (
            <div className="rounded-2xl bg-orange-50 p-3">
              <span className="label"><PenLine className="mr-1 inline" size={16} />直接填写消耗</span>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <select className="field" value={selectedManualActivity} onChange={(event) => setManualActivityId(event.target.value)}>
                  {activeActivities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                </select>
                <input
                  className="field"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={1440}
                  step={1}
                  placeholder="消耗分钟数"
                  value={manualConsumptionMinutes}
                  onChange={(event) => setManualConsumptionMinutes(event.target.value)}
                />
                <button
                  type="button"
                  className="primary-button !px-3"
                  disabled={busy || !selectedManualActivity || manualConsumptionMinutes === "" || !Number.isInteger(manualConsumptionMinutesNumber) || manualConsumptionMinutesNumber <= 0 || manualConsumptionMinutesNumber * MINUTE > worker.balanceSeconds}
                  onClick={async () => {
                    const activity = activeActivities.find((item) => item.id === selectedManualActivity);
                    const ok = await mutate({ action: "manual_consumption", workerId: worker.id, activityId: selectedManualActivity, durationSeconds: manualConsumptionMinutesNumber * MINUTE }, `已帮 ${worker.name} 记录${activity?.name || "消耗"}`);
                    if (ok) setManualConsumptionMinutes("");
                  }}
                >
                  确认扣除
                </button>
              </div>
            </div>
          )}

          {editableAssignments.length > 0 && (
            <details className="rounded-2xl bg-purple-50 p-3">
              <summary className="min-h-11 cursor-pointer py-2 font-black text-purple-800">任务管理（{editableAssignments.length}）</summary>
              <div className="mt-2 space-y-3">
                {editableAssignments.map((assignment) => (
                  <AdminAssignmentControls
                    key={assignment.id}
                    assignment={assignment}
                    hasActiveTimer={Boolean(worker.activeTimer)}
                    mutate={mutate}
                    busy={busy}
                  />
                ))}
              </div>
            </details>
          )}

          <details className="rounded-2xl bg-slate-50 p-3">
            <summary className="cursor-pointer font-black text-slate-700">更多管理</summary>
            <div className="mt-3 space-y-3">
              <div className="flex gap-2"><input className="field" type="number" inputMode="numeric" min={0} max={1440} placeholder="自定义每日奖励（分钟）" value={customDailyMinutes} onChange={(event) => setCustomDailyMinutes(event.target.value)} /><button className="secondary-button shrink-0 !px-3" disabled={busy || customDailyMinutes === ""} onClick={async () => { const ok = await mutate({ action: "update_worker", workerId: worker.id, dailyRewardSeconds: Number(customDailyMinutes) * MINUTE }, "每日奖励已更新"); if (ok) setCustomDailyMinutes(""); }}>应用</button></div>
              <div className="flex gap-2"><input className="field" type="password" inputMode="numeric" placeholder="设置新 PIN" value={pin} onChange={(event) => setPin(event.target.value)} /><button className="secondary-button shrink-0 !px-3" disabled={busy || pin.length < 4} onClick={async () => { const ok = await mutate({ action: "update_worker", workerId: worker.id, password: pin }, "PIN 已重置，旧登录已失效"); if (ok) setPin(""); }}>重置 PIN</button></div>
              <div className="grid grid-cols-2 gap-2"><input className="field" type="number" placeholder="调整分钟，可为负" value={adjustMinutes} onChange={(event) => setAdjustMinutes(event.target.value)} /><input className="field" placeholder="调整原因" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
              <button className="secondary-button w-full" disabled={busy || !adjustMinutes || reason.trim().length < 2} onClick={async () => { const ok = await mutate({ action: "adjust_balance", workerId: worker.id, amountSeconds: Number(adjustMinutes) * MINUTE, reason }, "余额调整完成"); if (ok) { setAdjustMinutes(""); setReason(""); } }}><MinusCircle className="mr-1 inline" size={17} />调整余额</button>
              <button className="danger-button w-full" disabled={busy} onClick={() => mutate({ action: "update_worker", workerId: worker.id, isActive: false }, "角色已停用")}>停用角色</button>
            </div>
          </details>
        </div>
      )}
      {pendingConsumption && (
        <ConsumptionStartDialog
          activityName={pendingConsumption.name}
          balanceSeconds={worker.balanceSeconds}
          workerName={worker.name}
          busy={busy}
          onCancel={() => setPendingConsumptionId(null)}
          onConfirm={async () => {
            const ok = await mutate(
              { action: "timer_start", workerId: worker.id, timerType: "consumption", targetId: pendingConsumption.id },
              `已帮 ${worker.name} 开始${pendingConsumption.name}`,
            );
            if (ok) setPendingConsumptionId(null);
          }}
        />
      )}
    </div>
  );
}

function AdminAssignmentControls({
  assignment,
  hasActiveTimer,
  mutate,
  busy,
}: {
  assignment: Assignment;
  hasActiveTimer: boolean;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [minutes, setMinutes] = useState("");
  const minuteNumber = Number(minutes);
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black">{assignment.title}</p>
          <p className="mt-0.5 text-xs font-bold text-slate-500">{assignmentStatusLabels[assignment.status]} · 已记录 {formatDuration(assignment.durationSeconds, false)}</p>
        </div>
        <TimeCoin seconds={assignment.rewardSeconds} compact />
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className="field"
          type="number"
          inputMode="decimal"
          min={0}
          max={1440}
          step={1}
          placeholder="设置累计分钟"
          value={minutes}
          disabled={busy || hasActiveTimer}
          onChange={(event) => setMinutes(event.target.value)}
        />
        <button
          type="button"
          className="secondary-button shrink-0 !px-3"
          disabled={busy || hasActiveTimer || minutes === "" || !Number.isInteger(minuteNumber) || minuteNumber < 0 || minuteNumber > 1440}
          onClick={async () => {
            const ok = await mutate({ action: "set_assignment_duration", assignmentId: assignment.id, durationSeconds: minuteNumber * MINUTE }, "任务累计时长已修改");
            if (ok) setMinutes("");
          }}
        >
          设置时长
        </button>
      </div>
      {hasActiveTimer && <p className="mt-1 text-xs font-bold text-amber-700">结束该角色当前计时后可修改时长。</p>}
      <button
        type="button"
        className="danger-button mt-2 w-full"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`确定撤销 ${assignment.title} 吗？本次不会发放奖励。`)) {
            void mutate({ action: "cancel_assignment", assignmentId: assignment.id, reason: "管理员撤销误操作任务" }, "任务已撤销");
          }
        }}
      >
        <XCircle className="mr-1 inline" size={17} />撤销任务
      </button>
    </div>
  );
}

function AdminSettings({
  state,
  mutate,
  busy,
  onSwitch,
}: {
  state: AdminState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onSwitch: () => void;
}) {
  const [activityName, setActivityName] = useState("");
  const recent = state.transactions.slice(0, 20);

  async function logout() {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout_current" }) });
    onSwitch();
  }

  return (
    <div className="space-y-6">
      <section>
        <RewardSettingsPanel state={state} mutate={mutate} busy={busy} />
      </section>

      <section>
        <SectionTitle title="消耗项目" text="打工人只能使用已启用的项目" />
        <div className="app-card p-4">
          <div className="flex gap-2">
            <input className="field" value={activityName} onChange={(event) => setActivityName(event.target.value)} placeholder="新项目名称" />
            <button className="primary-button shrink-0 !px-3" disabled={busy || !activityName.trim()} onClick={async () => { const ok = await mutate({ action: "create_activity", name: activityName }, "消耗项目已创建"); if (ok) setActivityName(""); }}><Plus size={20} /></button>
          </div>
          <div className="mt-3 space-y-2">
            {state.activities.map((activity) => {
              const Icon = activityIcon(activity.icon);
              return (
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2" key={activity.id}>
                  <div className="flex items-center gap-2 font-black"><Icon size={20} className="text-purple-600" />{activity.name}</div>
                  <button className={activity.isActive ? "danger-button !min-h-10 !px-3 text-sm" : "success-button !min-h-10 !px-3 text-sm"} disabled={busy} onClick={() => mutate({ action: "toggle_activity", activityId: activity.id, active: !activity.isActive }, activity.isActive ? "项目已停用" : "项目已启用")}>{activity.isActive ? "停用" : "启用"}</button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle title="最近明细" text="所有余额变化都保留记录" />
        <div className="app-card divide-y divide-purple-50 overflow-hidden">
          {recent.length === 0 ? <p className="p-5 text-center text-sm font-bold text-slate-500">还没有明细</p> : recent.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><p className="truncate text-sm font-black">{item.workerName} · {item.title}</p>{item.isReversed && <span className="pill shrink-0 bg-slate-100 text-slate-500">已撤销</span>}</div>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">{formatDateTime(item.createdAt)}{item.reason ? ` · ${item.reason}` : ""}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className={`block text-sm font-black ${item.amountSeconds > 0 ? "text-emerald-600" : "text-orange-600"}`}>{item.amountSeconds > 0 ? "+" : "−"}{formatDuration(Math.abs(item.amountSeconds), Math.abs(item.amountSeconds) < MINUTE)}</span>
                {item.type === "consumption" && !item.isReversed && (
                  <button
                    type="button"
                    className="mt-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-black text-orange-800"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`确定撤销 ${item.workerName} 的“${item.title}”吗？将原额退回。`)) {
                        void mutate({ action: "reverse_consumption", transactionId: item.id, reason: "管理员确认是误触消耗" }, "消耗已撤销，时数已原额退回");
                      }
                    }}
                  >
                    撤销消耗
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="app-card p-5">
        <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 shrink-0 text-amber-600" /><p className="text-sm font-semibold leading-6 text-slate-600">管理员密码来自服务器配置文件。修改 <code className="rounded bg-slate-100 px-1">ADMIN_PASSWORD</code> 并重启后，旧管理员登录会自动失效。</p></div>
        <button className="danger-button mt-4 w-full" onClick={logout}>退出管理员</button>
      </section>
    </div>
  );
}
