"use client";

import {
  Award,
  CheckCircle2,
  Clock3,
  Gift,
  ListChecks,
  LockKeyhole,
  Pause,
  PenLine,
  Play,
  Send,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, mutationId } from "@/components/api";
import {
  activityIcon,
  AppHeader,
  Avatar,
  BottomNav,
  ConsumptionStartDialog,
  EmptyState,
  LiveClock,
  LoadingScreen,
  RewardVisual,
  TaskRewardOutcomeSummary,
  TaskRewardSummary,
  TimeCoin,
  Toast,
  useLiveSeconds,
  workerNavItems,
} from "@/components/shared";
import type { Assignment, RewardItem, RewardRequest, Task, WorkerState } from "@/components/types";
import { formatDateTime, formatDuration, MINUTE } from "@/lib/time";

type WorkerTab = "home" | "tasks" | "running" | "rewards" | "ledger" | "me";

const statusInfo: Record<Assignment["status"], { label: string; className: string }> = {
  claimed: { label: "可以开始做啦", className: "bg-blue-100 text-blue-700" },
  in_progress: { label: "正在努力中", className: "bg-orange-100 text-orange-700" },
  submitted: { label: "等管理员看看", className: "bg-purple-100 text-purple-700" },
  revision_requested: { label: "再改一改就更棒", className: "bg-amber-100 text-amber-800" },
  approved: { label: "奖励已到账", className: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "本次没有通过", className: "bg-red-100 text-red-700" },
  cancelled: { label: "已取消", className: "bg-slate-100 text-slate-500" },
};

const rewardRequestStatusInfo: Record<RewardRequest["status"], { label: string; className: string }> = {
  pending: { label: "等管理员审核", className: "bg-purple-100 text-purple-700" },
  revision_requested: { label: "需要补充", className: "bg-amber-100 text-amber-800" },
  approved: { label: "奖励已到账", className: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "本次未通过", className: "bg-red-100 text-red-700" },
  cancelled: { label: "已取消", className: "bg-slate-100 text-slate-500" },
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请再试一次。";
}

export function WorkerApp({
  onSwitch,
  onAuthorizationError,
}: {
  onSwitch: () => void;
  onAuthorizationError: (error: unknown) => boolean;
}) {
  const [state, setState] = useState<WorkerState | null>(null);
  const [tab, setTab] = useState<WorkerTab>("home");
  const [busy, setBusy] = useState(false);
  const [showRewardRequest, setShowRewardRequest] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const load = useCallback(async (quiet = false) => {
    try {
      const data = await api<WorkerState>("/api/worker");
      setState(data);
    } catch (error) {
      if (!onAuthorizationError(error) && !quiet) setToast({ message: messageOf(error), tone: "error" });
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
      const data = await api<WorkerState>("/api/worker", {
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

  async function mutateReward(
    body: Record<string, unknown>,
    success: (nextState: WorkerState) => string,
  ) {
    setBusy(true);
    try {
      const data = await api<WorkerState>("/api/worker", {
        method: "POST",
        body: JSON.stringify({ ...body, requestId: body.requestId || mutationId() }),
      });
      setState(data);
      setToast({ message: success(data), tone: "success" });
      return data;
    } catch (error) {
      if (!onAuthorizationError(error)) setToast({ message: messageOf(error), tone: "error" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <LoadingScreen />;

  const nav = workerNavItems.map((item) => (
    item.id === "rewards" ? { ...item, badge: state.availableRewardCount } : item
  ));

  return (
    <div className={`min-h-screen ${state.activeTimer ? "pb-44" : "pb-28"}`}>
      {toast && <Toast {...toast} />}
      <AppHeader
        title={state.worker.name}
        subtitle="今天也要开心地赚时间币"
        avatar={state.worker.avatar}
        avatarUrl={state.worker.avatarUrl}
        theme={state.worker.theme}
        onSwitch={onSwitch}
      />
      <main className="page-enter mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6">
        {tab === "home" && <WorkerHome state={state} mutate={mutate} busy={busy} setTab={setTab} onOpenRewardRequest={() => setShowRewardRequest(true)} />}
        {tab === "tasks" && <TasksPanel state={state} mutate={mutate} busy={busy} onOpenRewardRequest={() => setShowRewardRequest(true)} />}
        {tab === "running" && <RunningPanel state={state} mutate={mutate} busy={busy} setTab={setTab} />}
        {tab === "rewards" && <RewardsPanel state={state} mutateReward={mutateReward} busy={busy} />}
        {tab === "ledger" && <LedgerPanel state={state} />}
        {tab === "me" && <WorkerMe state={state} onSwitch={onSwitch} />}
      </main>
      {state.activeTimer && (
        <StickyTimer
          state={state}
          busy={busy}
          stop={() => mutate({ action: "stop_timer" }, state.activeTimer?.type === "consumption" ? "本次消耗已结束" : "任务计时已暂停")}
          cancelConsumption={() => mutate({ action: "cancel_consumption_timer" }, "误触计时已取消，本次没有扣款")}
        />
      )}
      <BottomNav items={nav} active={tab} onChange={setTab} />
      {showRewardRequest && (
        <RewardRequestDialog
          state={state}
          mutate={mutate}
          busy={busy}
          onClose={() => setShowRewardRequest(false)}
        />
      )}
    </div>
  );
}

function StickyTimer({
  state,
  busy,
  stop,
  cancelConsumption,
}: {
  state: WorkerState;
  busy: boolean;
  stop: () => void;
  cancelConsumption: () => void;
}) {
  const timer = state.activeTimer!;
  const elapsed = useLiveSeconds(timer.startedAt);
  const remainingBalance = timer.type === "consumption"
    ? Math.max(0, state.worker.balanceSeconds - elapsed)
    : state.worker.balanceSeconds;
  const activeAssignment = timer.assignmentId
    ? state.assignments.find((assignment) => assignment.id === timer.assignmentId)
    : null;
  const totalTaskSeconds = activeAssignment ? activeAssignment.durationSeconds + elapsed : 0;
  const remainingRequirement = activeAssignment?.timingMode === "required"
    ? Math.max(0, (activeAssignment.minimumDurationSeconds || 0) - totalTaskSeconds)
    : null;
  const canUndoConsumption = timer.type === "consumption" && elapsed <= 30;
  const [autoStopRequested, setAutoStopRequested] = useState(false);
  useEffect(() => {
    if (timer.type === "consumption" && remainingBalance <= 0 && !busy && !autoStopRequested) {
      setAutoStopRequested(true);
      stop();
    }
  }, [autoStopRequested, busy, remainingBalance, stop, timer.type]);
  return (
    <div className="fixed inset-x-2 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-2xl rounded-[22px] border-2 border-orange-200 bg-orange-50 px-4 py-3 shadow-[0_10px_30px_rgba(114,73,24,0.2)]">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-200 text-orange-800"><Clock3 size={24} strokeWidth={3} /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-orange-900">{timer.title}</p>
          <div className="flex flex-wrap items-center gap-x-2 text-orange-700">
            <LiveClock startedAt={timer.startedAt} className="text-lg" />
            <span className="text-xs font-bold">剩余总时长 {formatDuration(remainingBalance, false)}</span>
          </div>
          {activeAssignment && (
            <p className="truncate text-[11px] font-bold text-orange-700">
              累计 {formatDuration(totalTaskSeconds)}
              {remainingRequirement !== null ? remainingRequirement > 0 ? ` · 距离要求还差 ${formatDuration(remainingRequirement)}` : " · 已达到最低要求" : " · 本任务计时可选"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {canUndoConsumption && (
            <button className="secondary-button !min-h-11 !px-2 text-xs" disabled={busy} onClick={cancelConsumption}>
              <XCircle className="mr-1 inline" size={16} />误触取消
            </button>
          )}
          <button className="danger-button !min-h-11 !px-3" disabled={busy} onClick={stop}><Pause className="mr-1 inline" size={18} />{timer.type === "consumption" ? "结束" : "暂停"}</button>
        </div>
      </div>
    </div>
  );
}

function WorkerHome({
  state,
  mutate,
  busy,
  setTab,
  onOpenRewardRequest,
}: {
  state: WorkerState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  setTab: (tab: WorkerTab) => void;
  onOpenRewardRequest: () => void;
}) {
  const [manualActivityId, setManualActivityId] = useState(state.activities[0]?.id || "");
  const [manualMinutes, setManualMinutes] = useState("");
  const [pendingConsumptionId, setPendingConsumptionId] = useState<string | null>(null);
  const recentResult = state.assignments.find((assignment) => ["approved", "revision_requested", "rejected"].includes(assignment.status));
  const pendingConsumption = state.activities.find((activity) => activity.id === pendingConsumptionId);
  const selectedManualActivity = state.activities.some((activity) => activity.id === manualActivityId)
    ? manualActivityId
    : state.activities[0]?.id || "";
  const manualMinutesNumber = Number(manualMinutes);
  return (
    <div className="space-y-5">
      <section className="app-card purple-gradient-card coin-pop overflow-hidden p-5 text-white sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-purple-100">我的时间币小金库</p>
            <div className="mt-3 text-2xl sm:text-3xl"><TimeCoin seconds={state.worker.balanceSeconds} /></div>
          </div>
          <div className="grid h-14 w-14 place-items-center rounded-full border-4 border-amber-300 bg-amber-200 text-amber-800 shadow-[0_4px_0_#d79c22]"><Clock3 size={28} strokeWidth={3} /></div>
        </div>
        <p className="mt-4 text-xs font-bold text-purple-100">每天固定奖励：{formatDuration(state.worker.dailyRewardSeconds, false)}</p>
      </section>

      <section className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="soft-card p-3 text-center"><TrendingUp className="mx-auto text-emerald-600" size={23} /><strong className="mt-2 block text-sm text-emerald-700">+{formatDuration(state.summary.todayIncomeSeconds, false)}</strong><span className="text-[11px] font-bold text-slate-500">今日获得</span></div>
        <div className="soft-card p-3 text-center"><TrendingDown className="mx-auto text-orange-600" size={23} /><strong className="mt-2 block text-sm text-orange-700">−{formatDuration(state.summary.todaySpentSeconds, false)}</strong><span className="text-[11px] font-bold text-slate-500">今日消耗</span></div>
        <div className="soft-card p-3 text-center"><ShieldCheckIcon /><strong className="mt-2 block text-sm text-purple-700">{formatDuration(state.summary.pendingRewardSeconds, false)}</strong><span className="text-[11px] font-bold text-slate-500">待审核</span></div>
      </section>

      {recentResult && (
        <section className={`app-card p-4 ${recentResult.status === "approved" ? "bg-emerald-50" : recentResult.status === "revision_requested" ? "bg-amber-50" : "bg-red-50"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {recentResult.status === "approved" ? <Sparkles className="shrink-0 text-emerald-600" /> : <Award className="shrink-0 text-amber-700" />}
              <div className="min-w-0">
                <p className="font-black">{recentResult.title} · {statusInfo[recentResult.status].label}</p>
                {recentResult.reviewTier === "excellent" && <span className="pill mt-1 bg-amber-100 text-amber-800"><Sparkles size={13} />优秀 ×{recentResult.reviewMultiplier}</span>}
              </div>
            </div>
            {recentResult.status === "approved" && (
              <div className="flex shrink-0 items-center gap-2 text-sm text-purple-700">
                <TimeCoin seconds={Math.round(recentResult.rewardSeconds * (recentResult.reviewMultiplier || 1))} compact />
                <TaskRewardOutcomeSummary
                  baseRewardSeconds={recentResult.rewardSeconds}
                  reviewMultiplier={recentResult.reviewMultiplier || 1}
                  reviewTier={recentResult.reviewTier}
                  reviewNote={recentResult.reviewNote}
                  items={recentResult.rewardItems}
                />
              </div>
            )}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3">
        <button className="app-card min-h-28 bg-blue-50 px-3 py-4 text-center" onClick={() => setTab("tasks")}><ListChecks className="mx-auto text-blue-600" size={30} /><strong className="mt-2 block">参加奖励任务</strong><span className="text-xs font-bold text-slate-500">还有 {state.availableTasks.length} 个可参加</span></button>
        <button className="app-card min-h-28 bg-amber-50 px-3 py-4 text-center" onClick={() => setTab("running")}><Play className="mx-auto text-amber-700" size={30} /><strong className="mt-2 block">我的任务</strong><span className="text-xs font-bold text-slate-500">查看进度和计时</span></button>
      </section>

      <button className="secondary-button w-full" onClick={onOpenRewardRequest}>
        <PenLine className="mr-2 inline" size={19} />自己申报已完成的奖励任务
      </button>

      <section>
        <h2 className="mb-3 text-xl font-black">花时间币</h2>
        <div className="grid grid-cols-2 gap-3">
          {state.activities.map((activity) => {
            const Icon = activityIcon(activity.icon);
            return (
              <button key={activity.id} className="app-card min-h-28 px-3 py-4 text-center" disabled={busy || Boolean(state.activeTimer) || state.worker.balanceSeconds <= 0} onClick={() => setPendingConsumptionId(activity.id)}>
                <Icon className="mx-auto text-orange-600" size={31} />
                <strong className="mt-2 block">{activity.name}</strong>
                <span className="text-xs font-bold text-slate-500">点击开始计时</span>
              </button>
            );
          })}
        </div>
        {state.activities.length > 0 && (
          <details className="mt-3 rounded-2xl bg-orange-50 p-3">
            <summary className="min-h-11 cursor-pointer py-2 font-black text-orange-800">
              <PenLine className="mr-2 inline" size={18} />直接填写消耗
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <select
                className="field"
                value={selectedManualActivity}
                disabled={busy || Boolean(state.activeTimer)}
                onChange={(event) => setManualActivityId(event.target.value)}
              >
                {state.activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
              </select>
              <input
                className="field"
                type="number"
                inputMode="decimal"
                min={1}
                max={1440}
                step={1}
                placeholder="消耗分钟数"
                value={manualMinutes}
                disabled={busy || Boolean(state.activeTimer)}
                onChange={(event) => setManualMinutes(event.target.value)}
              />
              <button
                type="button"
                className="primary-button !px-4"
                disabled={busy || Boolean(state.activeTimer) || !selectedManualActivity || manualMinutes === "" || !Number.isInteger(manualMinutesNumber) || manualMinutesNumber <= 0 || manualMinutesNumber * MINUTE > state.worker.balanceSeconds}
                onClick={async () => {
                  const activity = state.activities.find((item) => item.id === selectedManualActivity);
                  const ok = await mutate({ action: "manual_consumption", activityId: selectedManualActivity, durationSeconds: manualMinutesNumber * MINUTE }, `已记录${activity?.name || "消耗"}`);
                  if (ok) setManualMinutes("");
                }}
              >
                确认扣除
              </button>
            </div>
            <p className="mt-2 text-xs font-bold text-orange-700">不启动计时，填写后会立即从余额扣除并记入明细。</p>
          </details>
        )}
        {state.worker.balanceSeconds <= 0 && <p className="mt-3 rounded-2xl bg-orange-50 px-4 py-3 text-center text-sm font-black text-orange-700">时数不够啦，先完成一个奖励任务吧。</p>}
      </section>
      {pendingConsumption && (
        <ConsumptionStartDialog
          activityName={pendingConsumption.name}
          balanceSeconds={state.worker.balanceSeconds}
          busy={busy}
          onCancel={() => setPendingConsumptionId(null)}
          onConfirm={async () => {
            const ok = await mutate({ action: "start_consumption", activityId: pendingConsumption.id }, `开始${pendingConsumption.name}，记得及时结束哦`);
            if (ok) setPendingConsumptionId(null);
          }}
        />
      )}
    </div>
  );
}

function ShieldCheckIcon() {
  return <Star className="mx-auto text-purple-600" size={23} />;
}

function RewardRequestDialog({
  state,
  mutate,
  busy,
  onClose,
}: {
  state: WorkerState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewardMinutes, setRewardMinutes] = useState("30");
  const [editingId, setEditingId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const rewardMinutesNumber = Number(rewardMinutes);
  const editingRequest = editingId ? state.rewardRequests.find((item) => item.id === editingId) : null;
  const validRewardMinutes = Number.isInteger(rewardMinutesNumber) && rewardMinutesNumber >= 1 && rewardMinutesNumber <= 1440;

  function startRevision(request: RewardRequest) {
    setEditingId(request.id);
    setTitle(request.title);
    setDescription(request.description);
    setRewardMinutes(String(request.rewardSeconds / MINUTE));
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setRewardMinutes("30");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !validRewardMinutes) return;
    const action = editingRequest ? "resubmit_reward_request" : "submit_reward_request";
    const body = editingRequest
      ? { action, rewardRequestId: editingRequest.id, title, description, rewardSeconds: rewardMinutesNumber * MINUTE }
      : { action, title, description, rewardSeconds: rewardMinutesNumber * MINUTE };
    const ok = await mutate(body, editingRequest ? "奖励申报已重新提交" : "奖励申报已提交，等管理员审核");
    if (ok) {
      resetForm();
      onClose();
    }
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
        className="page-enter max-h-[calc(100vh-24px)] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-request-title"
      >
        <div className="purple-gradient-card flex items-start gap-3 p-5 text-white">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/20">
            <PenLine size={23} strokeWidth={2.8} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="reward-request-title" className="text-xl font-black">自己申报奖励</h2>
            <p className="mt-1 text-sm font-bold leading-6 text-purple-100">做了列表里没有的好事情？写下来交给管理员，审核通过才会入账。</p>
          </div>
          <button
            type="button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/20 text-xl font-black"
            aria-label="关闭奖励申报"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      <form ref={formRef} onSubmit={submit} className="scroll-mt-3 space-y-3 p-4 sm:p-5">
        <label>
          <span className="label">做了什么</span>
          <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：帮家里整理书架" maxLength={60} required />
        </label>
        <label>
          <span className="label">完成说明</span>
          <textarea className="field min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说说你具体完成了什么" maxLength={600} />
        </label>
        <label>
          <span className="label">申请奖励（分钟）</span>
          <input className="field" type="number" inputMode="numeric" min={1} max={1440} step={1} value={rewardMinutes} onChange={(event) => setRewardMinutes(event.target.value)} />
        </label>
        <div className="flex gap-2">
          <button className="primary-button flex-1" type="submit" disabled={busy || !title.trim() || !validRewardMinutes}>
            <Send className="mr-2 inline" size={18} />{editingRequest ? "重新提交审核" : "提交给管理员"}
          </button>
          {editingRequest && <button type="button" className="secondary-button" disabled={busy} onClick={resetForm}>取消修改</button>}
        </div>
      </form>
      {state.rewardRequests.length > 0 && (
        <div className="border-t border-purple-100 p-4 sm:p-5">
          <h3 className="font-black">我的申报记录</h3>
          <div className="mt-3 space-y-2">
            {state.rewardRequests.map((request) => {
              const status = rewardRequestStatusInfo[request.status];
              const canEdit = request.status === "revision_requested";
              const canCancel = request.status === "pending" || canEdit;
              return (
                <div key={request.id} className="rounded-2xl bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-black">{request.title}</p>
                      <span className={`pill mt-1 ${status.className}`}>{status.label}</span>
                    </div>
                    <TimeCoin seconds={request.rewardSeconds} compact />
                  </div>
                  {request.reviewNote && <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">管理员说：{request.reviewNote}</p>}
                  {(canEdit || canCancel) && (
                    <div className="mt-2 flex gap-2">
                      {canEdit && <button type="button" className="secondary-button !min-h-10 !px-3 text-xs" disabled={busy} onClick={() => startRevision(request)}>修改后重交</button>}
                      {canCancel && <button type="button" className="danger-button !min-h-10 !px-3 text-xs" disabled={busy} onClick={() => { if (window.confirm(`确定取消“${request.title}”吗？`)) void mutate({ action: "cancel_reward_request", rewardRequestId: request.id }, "奖励申报已取消"); }}>取消申报</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      </section>
    </div>
  );
}

function TasksPanel({
  state,
  mutate,
  busy,
  onOpenRewardRequest,
}: {
  state: WorkerState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onOpenRewardRequest: () => void;
}) {
  const activeAssignments = state.assignments.filter((assignment) => !["approved", "rejected", "cancelled"].includes(assignment.status));
  const recentAssignments = state.assignments
    .filter((assignment) => ["approved", "rejected"].includes(assignment.status))
    .sort((left, right) => (right.reviewedAt || right.submittedAt || 0) - (left.reviewedAt || left.submittedAt || 0))
    .slice(0, 10);
  const pendingRequests = state.rewardRequests.filter((request) => ["pending", "revision_requested"].includes(request.status)).length;
  return (
    <div className="space-y-6">
      <button
        type="button"
        className="app-card flex w-full items-center gap-3 bg-purple-50 p-4 text-left"
        onClick={onOpenRewardRequest}
      >
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-purple-200 text-purple-700">
          <PenLine size={24} strokeWidth={2.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-purple-900">自己申报奖励</p>
          <p className="mt-0.5 text-xs font-bold text-purple-600">
            {pendingRequests > 0 ? `${pendingRequests} 条正在等待处理` : "列表里没有的好事情，也可以提交审核"}
          </p>
        </div>
        <span className="shrink-0 text-sm font-black text-purple-700">打开</span>
      </button>
      <section>
        <h2 className="text-xl font-black">可以参加的任务</h2>
        <p className="mb-3 mt-0.5 text-sm font-semibold text-slate-500">选一个喜欢的任务，认真完成后等管理员审核</p>
        {state.availableTasks.length === 0 ? <EmptyState title="暂时没有新任务" text="管理员发布新任务后，就会出现在这里。" /> : (
          <div className="space-y-3">{state.availableTasks.map((task) => <AvailableTaskCard key={task.id} task={task} busy={busy} claim={() => mutate({ action: "claim_task", taskId: task.id }, "任务参加成功，加油完成吧")} />)}</div>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-xl font-black">我的任务</h2>
        {activeAssignments.length === 0 ? <EmptyState title="还没有参加任务" text="从上面挑一个感兴趣的任务吧。" /> : (
          <div className="space-y-4">{activeAssignments.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} activeTimer={state.activeTimer} mutate={mutate} busy={busy} />)}</div>
        )}
      </section>
      {recentAssignments.length > 0 && (
        <section>
          <h2 className="text-xl font-black">最近任务结果</h2>
          <p className="mb-3 mt-0.5 text-sm font-semibold text-slate-500">这里会显示实际到账的基础时数和奖励券</p>
          <div className="space-y-3">
            {recentAssignments.map((assignment) => (
              <article key={assignment.id} className={`app-card p-4 ${assignment.status === "approved" ? "border-emerald-200" : "border-red-100"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black">{assignment.title}</h3>
                      <span className={`pill ${statusInfo[assignment.status].className}`}>{statusInfo[assignment.status].label}</span>
                      {assignment.reviewTier === "excellent" && <span className="pill bg-amber-100 text-amber-800"><Sparkles size={13} />优秀 ×{assignment.reviewMultiplier}</span>}
                    </div>
                  </div>
                  {assignment.status === "approved" && (
                    <div className="flex shrink-0 items-center gap-2 text-sm text-purple-700">
                      <TimeCoin seconds={Math.round(assignment.rewardSeconds * (assignment.reviewMultiplier || 1))} compact />
                      <TaskRewardOutcomeSummary
                        baseRewardSeconds={assignment.rewardSeconds}
                        reviewMultiplier={assignment.reviewMultiplier || 1}
                        reviewTier={assignment.reviewTier}
                        reviewNote={assignment.reviewNote}
                        items={assignment.rewardItems}
                      />
                    </div>
                  )}
                </div>
                {assignment.status !== "approved" && (
                  <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">本次没有发放基础时数或奖励券。</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AvailableTaskCard({ task, busy, claim }: { task: Task; busy: boolean; claim: () => void }) {
  return (
    <div className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{task.title}</h3>{task.bonusEnabled && <span className="pill bg-amber-100 text-amber-800"><Sparkles size={14} />优秀 ×{task.excellentMultiplier}</span>}</div><p className="mt-1 text-sm font-semibold leading-6 text-slate-500">{task.description || "完成这个任务后提交管理员审核"}</p></div>
        <div className="shrink-0 text-sm text-purple-700"><TimeCoin seconds={task.rewardSeconds} compact /></div>
      </div>
      {task.bonusCriteria && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">优秀标准：{task.bonusCriteria}</p>}
      <div className="mt-3">
        <TaskRewardSummary
          baseRewardSeconds={task.rewardSeconds}
          excellentMultiplier={task.excellentMultiplier}
          bonusEnabled={task.bonusEnabled}
          items={task.rewardBindings}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs font-bold text-slate-500">{task.timingMode === "required" ? `需计时至少 ${formatDuration(task.minimumDurationSeconds || 0, false)}` : task.timingMode === "optional" ? "可以记录计时" : "不需要计时"}{task.dueAt ? ` · ${formatDateTime(task.dueAt)} 截止` : ""}</span><button className="primary-button shrink-0 !min-h-11 !px-4" disabled={busy} onClick={claim}>参加</button></div>
    </div>
  );
}

function AssignmentCard({
  assignment,
  activeTimer,
  mutate,
  busy,
}: {
  assignment: Assignment;
  activeTimer: WorkerState["activeTimer"];
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  const [manualMinutes, setManualMinutes] = useState("");
  const status = statusInfo[assignment.status];
  const isThisTimer = activeTimer?.assignmentId === assignment.id;
  const liveSegmentSeconds = useLiveSeconds(isThisTimer ? activeTimer?.startedAt : null);
  const totalDurationSeconds = assignment.durationSeconds + liveSegmentSeconds;
  const remainingRequirementSeconds = assignment.timingMode === "required"
    ? Math.max(0, (assignment.minimumDurationSeconds || 0) - totalDurationSeconds)
    : null;
  const canWork = ["claimed", "in_progress", "revision_requested"].includes(assignment.status);
  return (
    <div className="app-card overflow-hidden">
      <div className="blue-gradient-card p-4">
        <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black">{assignment.title}</h3><span className={`pill ${status.className}`}>{status.label}</span></div><p className="mt-1 text-sm font-semibold text-slate-500">{assignment.description || "认真完成后提交审核"}</p></div><TimeCoin seconds={assignment.rewardSeconds} compact /></div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="pill bg-blue-100 text-blue-700"><Clock3 size={14} />累计计时 {formatDuration(totalDurationSeconds)}</span>
          {remainingRequirementSeconds !== null && (
            <span className={`pill ${remainingRequirementSeconds > 0 ? "bg-orange-100 text-orange-800" : "bg-emerald-100 text-emerald-700"}`}>
              {remainingRequirementSeconds > 0 ? `还需 ${formatDuration(remainingRequirementSeconds)}` : "已达到计时要求"}
            </span>
          )}
          {assignment.bonusEnabled && <span className="pill bg-amber-100 text-amber-800"><Sparkles size={14} />优秀 ×{assignment.excellentMultiplier} 可得 {formatDuration(Math.round(assignment.rewardSeconds * assignment.excellentMultiplier), false)}</span>}
        </div>
        <TaskRewardSummary
          baseRewardSeconds={assignment.rewardSeconds}
          excellentMultiplier={assignment.excellentMultiplier}
          bonusEnabled={assignment.bonusEnabled}
          items={assignment.rewardItems}
        />
        {assignment.dueAt && <p className="text-xs font-bold text-slate-500">截止时间：{formatDateTime(assignment.dueAt)}</p>}
        {assignment.status === "revision_requested" && assignment.reviewNote && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">管理员说：{assignment.reviewNote}</p>}
        {canWork && (
          <>
            {assignment.timingMode !== "none" && (
              isThisTimer ? (
                <button className="danger-button w-full" disabled={busy} onClick={() => mutate({ action: "stop_timer" }, "任务计时已暂停")}><Pause className="mr-2 inline" size={19} />暂停计时 · <LiveClock startedAt={activeTimer!.startedAt} /></button>
              ) : (
                <button className="secondary-button w-full" disabled={busy || Boolean(activeTimer)} onClick={() => mutate({ action: "start_task_timer", assignmentId: assignment.id }, "开始计时，加油")}><Play className="mr-2 inline" size={19} />开始任务计时</button>
              )
            )}
            <label><span className="label">完成说明</span><textarea className="field min-h-20" value={note} onChange={(event) => setNote(event.target.value)} placeholder="说说你完成了什么、学到了什么" maxLength={500} /></label>
            <button className="primary-button w-full" disabled={busy || !note.trim() || Boolean(activeTimer && !isThisTimer)} onClick={async () => { const ok = await mutate({ action: "submit_task", assignmentId: assignment.id, note }, "任务已提交，等管理员看看吧"); if (ok) setNote(""); }}><Send className="mr-2 inline" size={18} />提交审核</button>
            {assignment.timingMode === "required" && <p className="text-center text-xs font-bold text-slate-500">最低要求 {formatDuration(assignment.minimumDurationSeconds || 0, false)} · {remainingRequirementSeconds && remainingRequirementSeconds > 0 ? `还差 ${formatDuration(remainingRequirementSeconds)}` : "已经达到"}</p>}
            <details className="rounded-2xl bg-slate-50 p-3">
              <summary className="min-h-11 cursor-pointer py-2 font-black text-slate-700">修改计时或取消任务</summary>
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <input
                    className="field"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={1440}
                    step={1}
                    placeholder={`累计分钟（现在 ${formatDuration(totalDurationSeconds, false)}）`}
                    value={manualMinutes}
                    disabled={busy || Boolean(activeTimer)}
                    onChange={(event) => setManualMinutes(event.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary-button shrink-0 !px-3"
                    disabled={busy || Boolean(activeTimer) || manualMinutes === "" || !Number.isInteger(Number(manualMinutes)) || Number(manualMinutes) < 0 || Number(manualMinutes) > 1440}
                    onClick={async () => {
                      const ok = await mutate({ action: "set_assignment_duration", assignmentId: assignment.id, durationSeconds: Number(manualMinutes) * MINUTE }, "累计时长已修改");
                      if (ok) setManualMinutes("");
                    }}
                  >
                    设置时长
                  </button>
                </div>
                {activeTimer && <p className="text-xs font-bold text-amber-700">请先暂停正在运行的计时，再修改累计时长。</p>}
                <button
                  type="button"
                  className="danger-button w-full"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`确定取消“${assignment.title}”吗？取消后可以重新参加。`)) {
                      void mutate({ action: "cancel_assignment", assignmentId: assignment.id }, "任务已取消");
                    }
                  }}
                >
                  <XCircle className="mr-1 inline" size={18} />取消这个任务
                </button>
              </div>
            </details>
          </>
        )}
        {assignment.status === "submitted" && <p className="rounded-2xl bg-purple-50 p-3 text-center text-sm font-black text-purple-700">已经交给管理员啦，审核前不会计入余额。</p>}
      </div>
    </div>
  );
}

function RunningPanel({ state, mutate, busy, setTab }: { state: WorkerState; mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>; busy: boolean; setTab: (tab: WorkerTab) => void }) {
  const ongoing = state.assignments.filter((assignment) => ["claimed", "in_progress", "revision_requested", "submitted"].includes(assignment.status));
  const activeElapsed = useLiveSeconds(state.activeTimer?.startedAt);
  const activeAssignment = state.activeTimer?.assignmentId
    ? state.assignments.find((assignment) => assignment.id === state.activeTimer?.assignmentId)
    : null;
  const activeTaskTotal = activeAssignment ? activeAssignment.durationSeconds + activeElapsed : 0;
  const remainingBalance = state.activeTimer?.type === "consumption"
    ? Math.max(0, state.worker.balanceSeconds - activeElapsed)
    : state.worker.balanceSeconds;
  const activeRequirementRemaining = activeAssignment?.timingMode === "required"
    ? Math.max(0, (activeAssignment.minimumDurationSeconds || 0) - activeTaskTotal)
    : null;

  return (
    <div className="space-y-5">
      {state.activeTimer ? (
        <section className="app-card orange-gradient-card p-5 text-center sm:p-6">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-orange-200 text-orange-700"><Clock3 size={34} strokeWidth={3} /></div>
          <p className="mt-4 text-sm font-black text-orange-700">{state.activeTimer.type === "consumption" ? "正在消耗时间币" : "奖励任务正在计时"}</p>
          <h2 className="mt-1 text-2xl font-black">{state.activeTimer.title}</h2>
          <LiveClock startedAt={state.activeTimer.startedAt} className="mt-3 block text-4xl text-orange-700" />

          <div className="mt-4 grid grid-cols-2 gap-2 text-left">
            <div className="rounded-2xl bg-white/75 p-3">
              <p className="text-xs font-black text-slate-500">{activeAssignment ? "累计任务计时" : "本次已经使用"}</p>
              <p className="mt-1 font-black text-orange-800">{formatDuration(activeAssignment ? activeTaskTotal : activeElapsed)}</p>
            </div>
            <div className="rounded-2xl bg-white/75 p-3">
              <p className="text-xs font-black text-slate-500">剩余总时长</p>
              <p className="mt-1 font-black text-purple-700">{formatDuration(remainingBalance)}</p>
            </div>
          </div>

          {activeAssignment && (
            <div className="mt-3 rounded-2xl bg-blue-50 p-4 text-left">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-black text-blue-900">审核通过奖励</span>
                <span className="text-sm text-purple-700"><TimeCoin seconds={activeAssignment.rewardSeconds} compact /></span>
              </div>
              <p className={`mt-2 text-sm font-black ${activeRequirementRemaining !== null && activeRequirementRemaining > 0 ? "text-orange-700" : "text-emerald-700"}`}>
                {activeRequirementRemaining === null
                  ? "这个任务计时可选，没有最低时长要求"
                  : activeRequirementRemaining > 0
                    ? `距离最低计时要求还差 ${formatDuration(activeRequirementRemaining)}`
                    : "已经达到最低计时要求，可以完成后提交"}
              </p>
              {activeAssignment.description && <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">任务说明：{activeAssignment.description}</p>}
              {activeAssignment.dueAt && <p className="mt-2 text-xs font-bold text-slate-500">截止时间：{formatDateTime(activeAssignment.dueAt)}</p>}
              <div className="mt-3">
                <TaskRewardSummary
                  baseRewardSeconds={activeAssignment.rewardSeconds}
                  excellentMultiplier={activeAssignment.excellentMultiplier}
                  bonusEnabled={activeAssignment.bonusEnabled}
                  items={activeAssignment.rewardItems}
                />
              </div>
            </div>
          )}

          {!activeAssignment && <p className="mt-3 rounded-2xl bg-orange-100 px-4 py-3 text-sm font-bold text-orange-800">消耗计时会按秒减少剩余总时长，余额用完后自动结束。</p>}
          <button className="danger-button mt-5 w-full" disabled={busy} onClick={() => mutate({ action: "stop_timer" }, state.activeTimer?.type === "consumption" ? "本次消耗已结束" : "任务计时已暂停")}><Pause className="mr-2 inline" />{state.activeTimer.type === "consumption" ? "结束消耗" : "暂停任务"}</button>
        </section>
      ) : <EmptyState title="现在没有计时" text={`当前剩余总时长 ${formatDuration(state.worker.balanceSeconds, false)}。参加任务或选择消耗项目后，就可以开始计时。`} action={<button className="primary-button" onClick={() => setTab("tasks")}>去看任务</button>} />}

      <section>
        <h2 className="text-xl font-black">任务进度</h2>
        <p className="mb-3 mt-0.5 text-sm font-semibold text-slate-500">奖励、计时要求和完成进度都在这里</p>
        {ongoing.length === 0 ? (
          <p className="soft-card p-4 text-center text-sm font-bold text-slate-500">暂时没有进行中的任务</p>
        ) : (
          <div className="space-y-3">
            {ongoing.map((item) => {
              const isActive = state.activeTimer?.assignmentId === item.id;
              const totalDuration = item.durationSeconds + (isActive ? activeElapsed : 0);
              const requirementRemaining = item.timingMode === "required"
                ? Math.max(0, (item.minimumDurationSeconds || 0) - totalDuration)
                : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`app-card w-full p-4 text-left ${isActive ? "!border-orange-300 bg-orange-50" : ""}`}
                  onClick={() => setTab("tasks")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-black">{item.title}</p>
                      <span className={`pill mt-1 ${statusInfo[item.status].className}`}>{statusInfo[item.status].label}</span>
                    </div>
                    <span className="shrink-0 text-sm text-purple-700"><TimeCoin seconds={item.rewardSeconds} compact /></span>
                  </div>
                  {item.description && <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-slate-600">{item.description}</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-blue-50 px-3 py-2">
                      <p className="text-[11px] font-bold text-blue-600">累计计时</p>
                      <p className="mt-0.5 text-sm font-black text-blue-900">{formatDuration(totalDuration)}</p>
                    </div>
                    <div className={`rounded-xl px-3 py-2 ${requirementRemaining !== null && requirementRemaining > 0 ? "bg-orange-50" : "bg-emerald-50"}`}>
                      <p className={`text-[11px] font-bold ${requirementRemaining !== null && requirementRemaining > 0 ? "text-orange-600" : "text-emerald-600"}`}>计时要求</p>
                      <p className={`mt-0.5 text-sm font-black ${requirementRemaining !== null && requirementRemaining > 0 ? "text-orange-900" : "text-emerald-800"}`}>
                        {requirementRemaining === null ? item.timingMode === "none" ? "无需计时" : "可以计时" : requirementRemaining > 0 ? `还需 ${formatDuration(requirementRemaining)}` : "已经达到"}
                      </p>
                    </div>
                  </div>
                  {item.dueAt && <p className="mt-2 text-xs font-bold text-slate-500">截止时间：{formatDateTime(item.dueAt)}</p>}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

const rewardSourceLabels: Record<RewardItem["sourceType"], string> = {
  daily: "每日免费派发",
  task: "任务奖励",
  admin_direct: "管理员直接发放",
  achievement: "成就奖励",
  adjustment: "补发或纠错",
};

const rewardStatusLabels: Record<RewardItem["status"], string> = {
  available: "可使用",
  redeemed: "已使用",
  fulfilled: "已收到",
  cancelled: "已撤销",
  expired: "已过期",
};

function groupAvailableRewards(items: RewardItem[]) {
  const groups = new Map<string, { item: RewardItem; items: RewardItem[] }>();
  for (const item of items.filter((reward) => reward.status === "available")) {
    const key = item.definitionId
      ? `${item.definitionId}:${item.definitionVersion}`
      : `${item.kind}:${item.name}:${item.randomMinSeconds}:${item.randomMaxSeconds}:${item.fixedSeconds}:${item.imageUrl || ""}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { item, items: [item] });
  }
  return [...groups.values()];
}

function rewardValueText(item: RewardItem) {
  if (item.kind === "random_time") {
    return `${item.randomMinSeconds! / MINUTE}～${item.randomMaxSeconds! / MINUTE} 分钟随机时间`;
  }
  if (item.kind === "fixed_time") return `${item.fixedSeconds! / MINUTE} 分钟固定时间`;
  return item.physicalDescription || "明确的实物奖励";
}

function RewardsPanel({
  state,
  mutateReward,
  busy,
}: {
  state: WorkerState;
  mutateReward: (
    body: Record<string, unknown>,
    success: (nextState: WorkerState) => string,
  ) => Promise<WorkerState | null>;
  busy: boolean;
}) {
  const [confirmPhysical, setConfirmPhysical] = useState<RewardItem | null>(null);
  const [lastResult, setLastResult] = useState<{ name: string; seconds: number } | null>(null);
  const availableGroups = useMemo(() => groupAvailableRewards(state.rewardItems), [state.rewardItems]);
  const timeGroups = availableGroups.filter((group) => group.item.kind !== "physical");
  const physicalGroups = availableGroups.filter((group) => group.item.kind === "physical");
  const history = useMemo(() => [...state.rewardItems]
    .sort((left, right) => Math.max(
      right.usedAt || 0,
      right.cancelledAt || 0,
      right.grantedAt,
    ) - Math.max(left.usedAt || 0, left.cancelledAt || 0, left.grantedAt))
    .slice(0, 30), [state.rewardItems]);
  const todayGrant = state.todayDailyCouponGrant;

  async function redeemReward(item: RewardItem) {
    if (item.kind === "fixed_time" && !window.confirm(`确定使用“${item.name}”吗？将立即增加 ${item.fixedSeconds! / MINUTE} 分钟。`)) {
      return;
    }
    const next = await mutateReward(
      { action: "redeem_reward_item", rewardItemId: item.id },
      (nextState) => {
        const used = nextState.rewardItems.find((reward) => reward.id === item.id);
        return used?.resultSeconds
          ? `获得 ${used.resultSeconds / MINUTE} 分钟时间币！`
          : "奖励券已使用";
      },
    );
    const used = next?.rewardItems.find((reward) => reward.id === item.id);
    if (used?.resultSeconds) setLastResult({ name: used.name, seconds: used.resultSeconds });
  }

  return (
    <div className="space-y-6">
      {!state.rewardSystemEnabled && (
        <section className="app-card border-amber-200 bg-amber-50 p-4 text-center">
          <p className="font-black text-amber-800">奖励系统暂时休息中</p>
          <p className="mt-1 text-sm font-semibold text-amber-700">已有奖励券会安全保留，恢复后可以继续使用。</p>
        </section>
      )}

      {todayGrant && todayGrant.actualQuantity > 0 && (
        <section className="app-card purple-gradient-card overflow-hidden p-5 text-white sm:p-6">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-white/20"><Gift size={34} strokeWidth={2.8} /></div>
            <div>
              <p className="text-sm font-black text-purple-100">今日派发</p>
              <h2 className="mt-1 text-2xl font-black">收到 {todayGrant.actualQuantity} 张随机时间券</h2>
              <p className="mt-1 text-sm font-bold text-purple-100">
                每张 {todayGrant.randomMinSeconds / MINUTE}～{todayGrant.randomMaxSeconds / MINUTE} 分钟 · 永久有效
              </p>
            </div>
          </div>
        </section>
      )}

      {lastResult && (
        <section className="app-card page-enter border-emerald-200 bg-emerald-50 p-5 text-center">
          <Sparkles className="mx-auto text-emerald-600" size={36} />
          <p className="mt-2 text-sm font-black text-emerald-700">{lastResult.name}</p>
          <p className="mt-1 text-3xl font-black text-emerald-700">+{lastResult.seconds / MINUTE} 分钟</p>
          <button className="secondary-button mt-3 !min-h-10 text-sm" onClick={() => setLastResult(null)}>知道啦</button>
        </section>
      )}

      <section>
        <div className="mb-3">
          <h2 className="text-xl font-black">我的时间券</h2>
          <p className="mt-0.5 text-sm font-semibold text-slate-500">随机券和固定券都由你选择什么时候使用</p>
        </div>
        {timeGroups.length === 0 ? (
          <EmptyState title="还没有时间券" text="每日派发或管理员发放的时间券会出现在这里。" />
        ) : (
          <div className="space-y-3">
            {timeGroups.map(({ item, items }) => {
              const average = item.kind === "random_time"
                ? (item.randomMinSeconds! + item.randomMaxSeconds!) / (2 * MINUTE)
                : null;
              return (
                <article className="app-card p-4" key={`${item.id}:${items.length}`}>
                  <div className="flex items-start gap-3">
                    <RewardVisual icon={item.icon} theme={item.theme} size={56} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black">{item.name}</h3>
                        <span className="pill bg-purple-100 text-purple-700">× {items.length}</span>
                      </div>
                      <p className="mt-1 text-sm font-black text-purple-700">{rewardValueText(item)}</p>
                      {average !== null && <p className="mt-1 text-xs font-semibold text-slate-500">平均 {average} 分钟，每个整数分钟机会相同</p>}
                      <p className="mt-1 text-xs font-bold text-slate-500">有效期：永久 · {rewardSourceLabels[item.sourceType]}</p>
                    </div>
                  </div>
                  {item.description && <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-600">{item.description}</p>}
                  <button
                    className="primary-button mt-3 w-full"
                    disabled={busy || !state.rewardSystemEnabled}
                    onClick={() => void redeemReward(items[0])}
                  >
                    {item.kind === "random_time" ? <><Sparkles className="mr-1 inline" size={18} />打开惊喜</> : <><Clock3 className="mr-1 inline" size={18} />使用整张券</>}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-xl font-black">待领取实物</h2>
          <p className="mt-0.5 text-sm font-semibold text-slate-500">实际收到后，再用自己的当前密码确认</p>
        </div>
        {physicalGroups.length === 0 ? (
          <div className="soft-card p-4 text-center text-sm font-bold text-slate-500">现在没有待确认的实物券</div>
        ) : (
          <div className="space-y-3">
            {physicalGroups.map(({ item, items }) => (
              <article className="app-card p-4" key={`${item.id}:${items.length}`}>
                <div className="flex items-start gap-3">
                  <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={72} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{item.name}</h3>{items.length > 1 && <span className="pill bg-emerald-100 text-emerald-700">× {items.length}</span>}</div>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{item.physicalDescription}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">有效期：永久</p>
                  </div>
                </div>
                <div className="mt-3 rounded-2xl bg-blue-50 px-3 py-2 text-sm font-semibold leading-6 text-blue-900">
                  交付说明：{item.fulfillmentInstructions}
                </div>
                <button
                  className="success-button mt-3 w-full"
                  disabled={busy || !state.rewardSystemEnabled}
                  onClick={() => setConfirmPhysical(items[0])}
                ><CheckCircle2 className="mr-1 inline" size={18} />确认收到</button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-xl font-black">最近奖励记录</h2>
          <p className="mt-0.5 text-sm font-semibold text-slate-500">发放、使用结果和实物确认都会保留</p>
        </div>
        {history.length === 0 ? (
          <div className="soft-card p-4 text-center text-sm font-bold text-slate-500">还没有奖励记录</div>
        ) : (
          <div className="app-card divide-y divide-purple-50 overflow-hidden">
            {history.map((item) => (
              <div className="flex items-center gap-3 p-4" key={item.id}>
                <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-black">{item.name}</p><span className={`pill ${item.status === "available" ? "bg-blue-100 text-blue-700" : item.status === "cancelled" ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700"}`}>{rewardStatusLabels[item.status]}</span></div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{rewardSourceLabels[item.sourceType]} · {formatDateTime(item.usedAt || item.cancelledAt || item.grantedAt, state.worker.timezone)}</p>
                  {item.resultSeconds && <p className="mt-1 text-xs font-black text-emerald-700">实际获得 {item.resultSeconds / MINUTE} 分钟</p>}
                  {item.cancellationReason && <p className="mt-1 text-xs font-semibold text-slate-500">原因：{item.cancellationReason}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {confirmPhysical && (
        <PhysicalRewardConfirmDialog
          item={confirmPhysical}
          busy={busy}
          onClose={() => setConfirmPhysical(null)}
          onConfirm={async (password) => {
            const next = await mutateReward(
              { action: "confirm_physical_reward", rewardItemId: confirmPhysical.id, password },
              () => "已确认收到实物，记录保存成功",
            );
            if (next) setConfirmPhysical(null);
            return Boolean(next);
          }}
        />
      )}
    </div>
  );
}

function PhysicalRewardConfirmDialog({
  item,
  busy,
  onClose,
  onConfirm,
}: {
  item: RewardItem;
  busy: boolean;
  onClose: () => void;
  onConfirm: (password: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState("");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form
        className="page-enter w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="physical-confirm-title"
        onSubmit={async (event) => { event.preventDefault(); await onConfirm(password); }}
      >
        <div className="flex items-center gap-3">
          <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={64} />
          <div><h2 id="physical-confirm-title" className="text-xl font-black">确认已经收到</h2><p className="mt-1 text-sm font-semibold text-slate-500">{item.name}</p></div>
        </div>
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">请在实际收到实物之后操作。输入你自己的当前密码或 PIN，系统不会保存输入内容。</p>
        <label className="mt-4 block">
          <span className="label">当前密码或 PIN</span>
          <input className="field" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required maxLength={200} />
        </label>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>先不确认</button>
          <button className="success-button" disabled={busy || !password}>{busy ? "正在确认…" : "确认收到"}</button>
        </div>
      </form>
    </div>
  );
}

function LedgerPanel({ state }: { state: WorkerState }) {
  const [filter, setFilter] = useState<"all" | "income" | "spent" | "daily">("all");
  const rows = useMemo(() => state.transactions.filter((item) => filter === "all" || filter === "income" && item.amountSeconds > 0 || filter === "spent" && item.amountSeconds < 0 || filter === "daily" && item.type === "daily_reward"), [state.transactions, filter]);
  return (
    <div className="space-y-4">
      <section className="app-card grid grid-cols-3 gap-2 p-4 text-center"><div><p className="text-xs font-bold text-slate-500">当前余额</p><p className="mt-1 text-sm font-black text-purple-700">{formatDuration(state.worker.balanceSeconds, false)}</p></div><div><p className="text-xs font-bold text-slate-500">累计收入</p><p className="mt-1 text-sm font-black text-emerald-700">{formatDuration(state.transactions.filter((x) => x.amountSeconds > 0).reduce((a, b) => a + b.amountSeconds, 0), false)}</p></div><div><p className="text-xs font-bold text-slate-500">累计消耗</p><p className="mt-1 text-sm font-black text-orange-700">{formatDuration(Math.abs(state.transactions.filter((x) => x.amountSeconds < 0).reduce((a, b) => a + b.amountSeconds, 0)), false)}</p></div></section>
      <div className="flex gap-2 overflow-x-auto pb-1">{([['all','全部'],['income','收入'],['spent','消耗'],['daily','每日奖励']] as const).map(([id,label]) => <button key={id} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-black ${filter === id ? "bg-purple-600 text-white" : "bg-white text-slate-600 shadow-sm"}`} onClick={() => setFilter(id)}>{label}</button>)}</div>
      {rows.length === 0 ? <EmptyState title="还没有明细" text="奖励和消耗记录会出现在这里。" /> : <div className="app-card divide-y divide-purple-50 overflow-hidden">{rows.map((item) => <div className="flex items-center justify-between gap-3 p-4" key={item.id}><div className="flex min-w-0 items-center gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${item.amountSeconds > 0 ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>{item.amountSeconds > 0 ? <TrendingUp size={21} /> : <TrendingDown size={21} />}</div><div className="min-w-0"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-black">{item.title}</p>{item.isReversed && <span className="pill shrink-0 bg-slate-100 text-slate-500">已撤销</span>}</div><p className="mt-0.5 text-xs font-semibold text-slate-500">{formatDateTime(item.createdAt, state.worker.timezone)}{item.reason ? ` · ${item.reason}` : ""}</p></div></div><div className={`shrink-0 text-right text-sm font-black ${item.amountSeconds > 0 ? "text-emerald-600" : "text-orange-600"}`}><p>{item.amountSeconds > 0 ? "+" : "−"}{formatDuration(Math.abs(item.amountSeconds), Math.abs(item.amountSeconds) < MINUTE)}</p><p className="mt-0.5 text-[10px] text-slate-400">余额 {formatDuration(item.balanceAfterSeconds, false)}</p></div></div>)}</div>}
    </div>
  );
}

function WorkerMe({ state, onSwitch }: { state: WorkerState; onSwitch: () => void }) {
  async function logout() {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout_current" }) });
    onSwitch();
  }
  return (
    <div className="space-y-5">
      <section className="app-card flex flex-col items-center p-7 text-center"><Avatar avatar={state.worker.avatar} theme={state.worker.theme} imageUrl={state.worker.avatarUrl} size={84} /><h2 className="mt-4 text-2xl font-black">{state.worker.name}</h2><p className="mt-1 text-sm font-bold text-slate-500">我的时间小金库</p><div className="mt-4 rounded-2xl bg-purple-50 px-5 py-3 text-purple-700"><TimeCoin seconds={state.worker.balanceSeconds} /></div></section>
      <section className="app-card p-5"><div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 shrink-0 text-purple-600" /><div><h3 className="font-black">这台设备已记住登录</h3><p className="mt-1 text-sm font-semibold leading-6 text-slate-500">退出后会清除本机对这个角色的登录，下次需要重新输入 PIN。</p></div></div><button className="danger-button mt-4 w-full" onClick={logout}>退出这个角色</button></section>
      <button className="secondary-button w-full" onClick={onSwitch}>切换到其他角色</button>
    </div>
  );
}
