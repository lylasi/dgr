"use client";

import {
  Award,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  CircleHelp,
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
  awardedTaskRewardItems,
  Avatar,
  BottomNav,
  ConsumptionStartDialog,
  EmptyState,
  LiveClock,
  LoadingScreen,
  RewardVisual,
  TaskRewardList,
  TaskRewardSummary,
  TimeCoin,
  Toast,
  useLiveSeconds,
  workerNavItems,
} from "@/components/shared";
import type { Assignment, RewardItem, RewardRequest, Task, WorkerState } from "@/components/types";
import { formatDateTime, formatDuration, MINUTE } from "@/lib/time";

type WorkerTab = "home" | "tasks" | "rewards" | "ledger" | "me";

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
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [detailAssignmentId, setDetailAssignmentId] = useState<string | null>(null);
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);

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
  const detailAssignment = detailAssignmentId
    ? state.assignments.find((assignment) => assignment.id === detailAssignmentId) || null
    : null;

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
        {tab === "home" && <WorkerHome state={state} mutate={mutate} busy={busy} onOpenTaskPicker={() => setShowTaskPicker(true)} onOpenRewardRequest={() => setShowRewardRequest(true)} onOpenTaskDetail={(assignment) => setDetailAssignmentId(assignment.id)} />}
        {tab === "tasks" && <TasksPanel state={state} mutate={mutate} busy={busy} onOpenRewardRequest={() => setShowRewardRequest(true)} onOpenTaskPicker={() => setShowTaskPicker(true)} onOpenTaskDetail={(assignment) => setDetailAssignmentId(assignment.id)} />}
        {tab === "rewards" && <RewardsPanel state={state} mutateReward={mutateReward} busy={busy} />}
        {tab === "ledger" && <LedgerPanel state={state} onOpenTaskDetail={(assignment) => setDetailAssignmentId(assignment.id)} />}
        {tab === "me" && <WorkerMe state={state} onSwitch={onSwitch} />}
      </main>
      {state.activeTimer && (
        <StickyTimer
          state={state}
          busy={busy}
          stop={() => mutate({ action: "stop_timer" }, state.activeTimer?.type === "consumption" ? "本次消耗已结束" : "任务计时已暂停")}
          cancelConsumption={() => mutate({ action: "cancel_consumption_timer" }, "误触计时已取消，本次没有扣款")}
          onOpenTaskDetail={activeAssignment => setDetailAssignmentId(activeAssignment.id)}
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
      {showTaskPicker && (
        <AvailableTasksDialog
          tasks={state.availableTasks}
          busy={busy}
          claim={async (task) => {
            const ok = await mutate({ action: "claim_task", taskId: task.id }, "任务参加成功，加油完成吧");
            if (ok) setShowTaskPicker(false);
          }}
          onClose={() => setShowTaskPicker(false)}
        />
      )}
      {detailAssignment && (
        <TaskDetailDialog
          assignment={detailAssignment}
          activeTimer={state.activeTimer}
          timezone={state.worker.timezone}
          onClose={() => setDetailAssignmentId(null)}
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
  onOpenTaskDetail,
}: {
  state: WorkerState;
  busy: boolean;
  stop: () => void;
  cancelConsumption: () => void;
  onOpenTaskDetail: (assignment: Assignment) => void;
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
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="fixed inset-x-2 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-2xl rounded-[22px] border-2 border-orange-200 bg-orange-50 px-4 py-3 shadow-[0_10px_30px_rgba(114,73,24,0.2)]">
      <div className="flex items-center gap-3">
        <div className="hidden h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-200 text-orange-800 min-[360px]:grid"><Clock3 size={24} strokeWidth={3} /></div>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
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
        </button>
        <div className="flex shrink-0 gap-1.5">
          {canUndoConsumption && (
            <button className="secondary-button !min-h-11 !px-2 text-xs" disabled={busy} onClick={cancelConsumption} aria-label="撤销误触计时">
              <XCircle className="inline min-[380px]:mr-1" size={16} /><span className="hidden min-[380px]:inline">误触取消</span>
            </button>
          )}
          <button className="danger-button !min-h-11 !px-3" disabled={busy} onClick={stop} aria-label={timer.type === "consumption" ? "结束计时" : "暂停任务计时"}><Pause className="inline min-[360px]:mr-1" size={18} /><span className="hidden min-[360px]:inline">{timer.type === "consumption" ? "结束" : "暂停"}</span></button>
          <button type="button" className="grid h-11 w-9 place-items-center rounded-xl bg-orange-100 text-orange-800" aria-label={expanded ? "收起计时详情" : "展开计时详情"} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={19} /> : <ChevronUp size={19} />}</button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-orange-200 pt-3 text-xs">
          <div className="rounded-xl bg-white/70 px-3 py-2"><p className="font-bold text-orange-600">本次计时</p><p className="mt-0.5 font-black text-orange-900">{formatDuration(elapsed)}</p></div>
          <div className="rounded-xl bg-white/70 px-3 py-2"><p className="font-bold text-orange-600">开始时间</p><p className="mt-0.5 font-black text-orange-900">{formatDateTime(timer.startedAt, state.worker.timezone)}</p></div>
          {activeAssignment && <button type="button" className="secondary-button col-span-2 !min-h-10 text-sm" onClick={() => onOpenTaskDetail(activeAssignment)}>查看完整任务、计时与奖励</button>}
        </div>
      )}
    </div>
  );
}

function WorkerHome({
  state,
  mutate,
  busy,
  onOpenTaskPicker,
  onOpenRewardRequest,
  onOpenTaskDetail,
}: {
  state: WorkerState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onOpenTaskPicker: () => void;
  onOpenRewardRequest: () => void;
  onOpenTaskDetail: (assignment: Assignment) => void;
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
            <button type="button" className="flex shrink-0 items-center gap-2 rounded-xl px-1 py-1 text-sm text-purple-700" onClick={() => onOpenTaskDetail(recentResult)} aria-label="查看任务完整结果">
              {recentResult.status === "approved" && <TimeCoin seconds={Math.round(recentResult.rewardSeconds * (recentResult.reviewMultiplier || 1))} compact />}
              <span className="pill bg-purple-100 text-purple-700">详情</span>
            </button>
          </div>
        </section>
      )}

      <button type="button" className="app-card flex w-full items-center gap-3 bg-blue-50 p-4 text-left" onClick={onOpenTaskPicker}><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-100 text-blue-700"><ListChecks size={26} /></div><div className="min-w-0 flex-1"><strong className="block">打工任务</strong><span className="text-xs font-bold text-slate-500">{state.availableTasks.length} 个可参加 · {state.assignments.filter((item) => ["claimed", "in_progress", "submitted", "revision_requested"].includes(item.status)).length} 个进行中</span></div><span className="text-sm font-black text-purple-700">打开</span></button>

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
  onOpenTaskPicker,
  onOpenTaskDetail,
}: {
  state: WorkerState;
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onOpenRewardRequest: () => void;
  onOpenTaskPicker: () => void;
  onOpenTaskDetail: (assignment: Assignment) => void;
}) {
  const activeAssignments = state.assignments.filter((assignment) => !["approved", "rejected", "cancelled"].includes(assignment.status));
  const recentAssignments = state.assignments
    .filter((assignment) => ["approved", "rejected"].includes(assignment.status))
    .sort((left, right) => (right.reviewedAt || right.submittedAt || 0) - (left.reviewedAt || left.submittedAt || 0))
    .slice(0, 10);
  const pendingRequests = state.rewardRequests.filter((request) => ["pending", "revision_requested"].includes(request.status)).length;
  return (
    <div className="space-y-5">
      <section className="app-card grid grid-cols-3 gap-2 p-3 text-center">
        <div><p className="text-lg font-black text-blue-700">{state.availableTasks.length}</p><p className="text-[11px] font-bold text-slate-500">可参加</p></div>
        <div><p className="text-lg font-black text-orange-700">{activeAssignments.filter((item) => item.status !== "submitted").length}</p><p className="text-[11px] font-bold text-slate-500">待完成</p></div>
        <div><p className="text-lg font-black text-purple-700">{activeAssignments.filter((item) => item.status === "submitted").length}</p><p className="text-[11px] font-bold text-slate-500">审核中</p></div>
      </section>
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
        <p className="mb-3 mt-0.5 text-sm font-semibold text-slate-500">从任务库里挑一项参加</p>
        <button
          type="button"
          className="app-card flex w-full items-center gap-3 p-4 text-left"
          disabled={state.availableTasks.length === 0}
          onClick={onOpenTaskPicker}
        >
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-100 text-blue-700"><ListChecks size={23} /></div>
          <div className="min-w-0 flex-1">
            <p className="font-black">{state.availableTasks.length > 0 ? `${state.availableTasks.length} 个任务可以参加` : "暂时没有新任务"}</p>
            <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{state.availableTasks.length > 0 ? state.availableTasks.slice(0, 3).map((task) => task.title).join(" · ") : "管理员发布后会出现在这里"}</p>
          </div>
          {state.availableTasks.length > 0 && <span className="shrink-0 text-sm font-black text-purple-700">选择</span>}
        </button>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-black">我的任务</h2>
        {activeAssignments.length === 0 ? <EmptyState title="还没有参加任务" text="从上面挑一个感兴趣的任务吧。" /> : (
          <div className="space-y-3">{activeAssignments.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} activeTimer={state.activeTimer} mutate={mutate} busy={busy} onOpenDetail={() => onOpenTaskDetail(assignment)} />)}</div>
        )}
      </section>
      {recentAssignments.length > 0 && (
        <section>
          <h2 className="text-xl font-black">最近任务结果</h2>
          <p className="mb-3 mt-0.5 text-sm font-semibold text-slate-500">点开一项查看完整计时与计提</p>
          <div className="app-card divide-y divide-purple-50 overflow-hidden">
            {recentAssignments.map((assignment) => (
              <button key={assignment.id} type="button" className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-purple-50" onClick={() => onOpenTaskDetail(assignment)}>
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${assignment.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {assignment.status === "approved" ? <CheckCircle2 size={21} /> : <XCircle size={21} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h3 className="truncate text-sm font-black">{assignment.title}</h3>
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black ${statusInfo[assignment.status].className}`}>{statusInfo[assignment.status].label}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
                    {formatDateTime(assignment.reviewedAt || assignment.submittedAt || assignment.claimedAt, state.worker.timezone)} · {assignment.durationSeconds > 0 ? `计时 ${formatDuration(assignment.durationSeconds)}` : "未计时"}
                    {assignment.reviewTier === "excellent" ? ` · 优秀 ×${assignment.reviewMultiplier}` : ""}
                  </p>
                  {assignment.reviewNote && <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">审核：{assignment.reviewNote}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {assignment.status === "approved" ? (
                    <div className="text-sm text-purple-700"><TimeCoin seconds={Math.round(assignment.rewardSeconds * (assignment.reviewMultiplier || 1))} compact /></div>
                  ) : (
                    <p className="text-xs font-black text-red-600">未发放</p>
                  )}
                  <AwardedCouponMarks items={assignment.rewardItems} />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AwardedCouponMarks({ items }: { items: Assignment["rewardItems"] }) {
  const awarded = awardedTaskRewardItems(items);
  if (awarded.length === 0) return null;
  const total = awarded.reduce((sum, item) => sum + (item.awardedQuantity || 0), 0);
  return (
    <div className="mt-1 flex items-center justify-end gap-1" aria-label={`获得奖励券 ${total} 张`}>
      {awarded.slice(0, 2).map((item) => (
        <span className="relative" key={item.id} title={`${item.name} ×${item.awardedQuantity}`}>
          <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={25} />
          {(item.awardedQuantity || 0) > 1 && <span className="absolute -bottom-1 -right-1 rounded-full bg-purple-600 px-1 text-[8px] font-black leading-3 text-white">×{item.awardedQuantity}</span>}
        </span>
      ))}
      <span className="text-[10px] font-black text-purple-700">券×{total}</span>
    </div>
  );
}

function AvailableTasksDialog({
  tasks,
  busy,
  claim,
  onClose,
}: {
  tasks: Task[];
  busy: boolean;
  claim: (task: Task) => Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-2 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="page-enter max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[24px] bg-white p-4 shadow-2xl sm:p-5" role="dialog" aria-modal="true" aria-labelledby="available-tasks-title">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-black text-purple-600">参加任务</p><h2 id="available-tasks-title" className="mt-0.5 text-xl font-black">选一个任务</h2><p className="mt-0.5 text-xs font-semibold text-slate-500">先看重点，详情按需展开</p></div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="关闭任务选择" onClick={onClose}><XCircle size={19} /></button>
        </div>
        <div className="mt-3 space-y-2">
          {tasks.map((task) => <AvailableTaskCard key={task.id} task={task} busy={busy} claim={() => void claim(task)} />)}
        </div>
      </section>
    </div>
  );
}

function AvailableTaskCard({ task, busy, claim }: { task: Task; busy: boolean; claim: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const timingText = task.timingMode === "required"
    ? `至少计时 ${formatDuration(task.minimumDurationSeconds || 0, false)}`
    : task.timingMode === "optional" ? "计时可选" : "无需计时";
  const showHint = (text: string) => setHint((current) => current === text ? null : text);
  return (
    <article className="app-card p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate font-black">{task.title}</h3>
            {task.repeatable && <span className="shrink-0 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-black text-blue-700">可重复</span>}
            {task.bonusEnabled && <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800">优秀 ×{task.excellentMultiplier}</span>}
          </div>
        </div>
        <div className="shrink-0 text-sm text-purple-700"><TimeCoin seconds={task.rewardSeconds} compact /></div>
      </div>

      <p className="mt-1 truncate text-[11px] font-bold text-slate-500">
        {task.timingMode === "required" ? <span className="text-orange-700">！{timingText}</span> : timingText}
        {task.dueAt ? ` · ${formatDateTime(task.dueAt)} 截止` : " · 不限截止"}
      </p>

      <div className="mt-1.5 flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <TaskCouponIcons items={task.rewardBindings} activeHint={hint} onHint={showHint} />
        </div>
        <button type="button" className="flex h-9 shrink-0 items-center gap-0.5 rounded-xl bg-slate-100 px-1.5 text-xs font-black text-slate-600" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (!expanded) setHint(null); }}>
          详情{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button type="button" className="primary-button shrink-0 !h-9 !min-h-9 !rounded-xl !px-2.5 !py-0 shadow-sm shadow-purple-200" disabled={busy} onClick={claim}><Play className="mr-1 inline" size={16} />参加</button>
      </div>

      {hint && <p className="mt-2 rounded-xl bg-purple-50 px-3 py-2 text-xs font-bold leading-5 text-purple-800" aria-live="polite">{hint}</p>}

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
          {task.description && <p className="text-sm font-semibold leading-5 text-slate-600">{task.description}</p>}
          <div className={`grid gap-2 text-xs ${task.bonusEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="rounded-xl bg-blue-50 px-3 py-2"><p className="font-bold text-blue-600">正常完成</p><p className="mt-0.5 font-black text-purple-800">{formatDuration(task.rewardSeconds, false)}</p></div>
            {task.bonusEnabled && <div className="rounded-xl bg-amber-50 px-3 py-2"><p className="font-bold text-amber-700">优秀完成 ×{task.excellentMultiplier}</p><p className="mt-0.5 font-black text-amber-900">{formatDuration(Math.round(task.rewardSeconds * task.excellentMultiplier), false)}</p></div>}
          </div>
          {task.bonusCriteria && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800"><strong>优秀标准：</strong>{task.bonusCriteria}</p>}
          {task.rewardBindings.length > 0 && <p className="text-[11px] font-bold text-slate-500">券说明请点击上方图标；“？”审核后揭晓，“！”仅优秀完成参与。</p>}
        </div>
      )}
    </article>
  );
}

function TaskCouponIcons({ items, activeHint, onHint }: { items: Task["rewardBindings"]; activeHint: string | null; onHint: (text: string) => void }) {
  if (items.length === 0) return null;
  const visible = items.slice(0, 2);
  const hidden = items.slice(2);
  const hiddenHint = hidden.map(taskCouponHint).join(" ");
  return (
    <div className="flex items-center gap-0.5" aria-label={`包含 ${items.length} 种奖励券`}>
      {visible.map((item) => {
        const mystery = Boolean(item.isMystery) || item.probabilityPercent < 0;
        const hint = taskCouponHint(item);
        return (
          <button type="button" key={item.bindingId} className="relative grid h-8 w-8 shrink-0 place-items-center rounded-xl" aria-label={`查看奖励券说明：${mystery ? "神秘奖励券" : item.name}`} aria-pressed={activeHint === hint} title="点击查看券说明" onClick={() => onHint(hint)}>
            {mystery ? (
              <span className="grid h-[26px] w-[26px] place-items-center rounded-xl border-2 border-dashed border-purple-300 bg-purple-50 text-purple-700"><CircleHelp size={15} strokeWidth={2.7} /></span>
            ) : (
              <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={26} />
            )}
            {item.grantTier === "excellent_bonus" && <span className="absolute -left-1 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-amber-500 px-0.5 text-[8px] font-black leading-none text-white">!</span>}
            {item.quantity > 1 && <span className="absolute -bottom-1 -right-1 rounded-full bg-purple-600 px-1 text-[8px] font-black leading-3 text-white">×{item.quantity}</span>}
          </button>
        );
      })}
      {hidden.length > 0 && (
        <button type="button" className="grid h-8 min-w-8 place-items-center rounded-xl bg-slate-100 px-1 text-[10px] font-black text-slate-600" aria-label={`查看另外 ${hidden.length} 种奖励券`} aria-pressed={activeHint === hiddenHint} title="点击查看其余券说明" onClick={() => onHint(hiddenHint)}>+{hidden.length}</button>
      )}
    </div>
  );
}

export function taskCouponHint(item: Task["rewardBindings"][number]) {
  const tier = item.grantTier === "excellent_bonus" ? "优秀完成额外" : "完成";
  if (item.isMystery || item.probabilityPercent < 0) return `${tier}可能获得神秘奖励券，审核后揭晓。`;
  const chance = item.probabilityPercent === 100 ? "必得" : `${item.probabilityPercent}% 概率获得`;
  const value = item.kind === "random_time"
    ? `${item.randomMinSeconds! / MINUTE}～${item.randomMaxSeconds! / MINUTE} 分钟随机时间`
    : item.kind === "fixed_time" ? `${item.fixedSeconds! / MINUTE} 分钟固定时间` : item.physicalDescription || "实物奖励";
  return `${tier}${chance}“${item.name}”×${item.quantity}：${value}。`;
}

function AssignmentCard({
  assignment,
  activeTimer,
  mutate,
  busy,
  onOpenDetail,
}: {
  assignment: Assignment;
  activeTimer: WorkerState["activeTimer"];
  mutate: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
  onOpenDetail: () => void;
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
      <div className="blue-gradient-card p-3">
        <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black">{assignment.title}</h3><span className={`pill ${status.className}`}>{status.label}</span></div><p className="mt-1 text-sm font-semibold text-slate-500">{assignment.description || "认真完成后提交审核"}</p></div><TimeCoin seconds={assignment.rewardSeconds} compact /></div>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="pill bg-blue-100 text-blue-700"><Clock3 size={14} />累计计时 {formatDuration(totalDurationSeconds)}</span>
          {remainingRequirementSeconds !== null && (
            <span className={`pill ${remainingRequirementSeconds > 0 ? "bg-orange-100 text-orange-800" : "bg-emerald-100 text-emerald-700"}`}>
              {remainingRequirementSeconds > 0 ? `还需 ${formatDuration(remainingRequirementSeconds)}` : "已达到计时要求"}
            </span>
          )}
          {assignment.bonusEnabled && <span className="pill bg-amber-100 text-amber-800"><Sparkles size={14} />优秀 ×{assignment.excellentMultiplier} 可得 {formatDuration(Math.round(assignment.rewardSeconds * assignment.excellentMultiplier), false)}</span>}
        </div>
        <button type="button" className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left text-xs font-black text-purple-700" onClick={onOpenDetail}><span>任务说明 · 奖励类型 · 时间记录</span><span>查看详情</span></button>
        {assignment.dueAt && <p className="text-xs font-bold text-slate-500">截止：{formatDateTime(assignment.dueAt)}</p>}
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

function TaskDetailDialog({
  assignment,
  activeTimer,
  timezone,
  onClose,
}: {
  assignment: Assignment;
  activeTimer: WorkerState["activeTimer"];
  timezone: string;
  onClose: () => void;
}) {
  const isThisTimer = activeTimer?.assignmentId === assignment.id;
  const liveSeconds = useLiveSeconds(isThisTimer ? activeTimer?.startedAt : null);
  const totalDuration = assignment.durationSeconds + liveSeconds;
  const requiredRemaining = assignment.timingMode === "required"
    ? Math.max(0, (assignment.minimumDurationSeconds || 0) - totalDuration)
    : null;
  const isApproved = assignment.status === "approved";
  const isRejected = assignment.status === "rejected" || assignment.status === "cancelled";
  const creditedSeconds = isApproved
    ? Math.round(assignment.rewardSeconds * (assignment.reviewMultiplier || 1))
    : 0;
  const awardedItems = awardedTaskRewardItems(assignment.rewardItems);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-2 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="page-enter max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[24px] bg-white p-4 shadow-2xl sm:p-5" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="task-detail-title" className="text-xl font-black">{assignment.title}</h2>
              <span className={`pill ${statusInfo[assignment.status].className}`}>{statusInfo[assignment.status].label}</span>
            </div>
            {assignment.description && <p className="mt-1 text-sm font-semibold leading-5 text-slate-600">{assignment.description}</p>}
          </div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="关闭任务详情" onClick={onClose}><XCircle size={19} /></button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-blue-50 px-3 py-2">
            <p className="text-[11px] font-bold text-blue-600">累计计时</p>
            <p className="mt-0.5 text-sm font-black text-blue-900">{formatDuration(totalDuration)}</p>
            {isThisTimer && <p className="mt-0.5 text-[10px] font-black text-orange-700">正在计时 · 本次 {formatDuration(liveSeconds)}</p>}
          </div>
          <div className={`rounded-xl px-3 py-2 ${requiredRemaining !== null && requiredRemaining > 0 ? "bg-orange-50" : "bg-emerald-50"}`}>
            <p className={`text-[11px] font-bold ${requiredRemaining !== null && requiredRemaining > 0 ? "text-orange-600" : "text-emerald-600"}`}>计时要求</p>
            <p className={`mt-0.5 text-sm font-black ${requiredRemaining !== null && requiredRemaining > 0 ? "text-orange-900" : "text-emerald-800"}`}>
              {assignment.timingMode === "none" ? "无需计时" : assignment.timingMode === "optional" ? "自愿记录" : requiredRemaining! > 0 ? `还差 ${formatDuration(requiredRemaining!)}` : `已达到 ${formatDuration(assignment.minimumDurationSeconds || 0)}`}
            </p>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
          <p>参加：{formatDateTime(assignment.claimedAt, timezone)}</p>
          <p>截止：{assignment.dueAt ? formatDateTime(assignment.dueAt, timezone) : "不限"}</p>
          {assignment.submittedAt && <p>提交：{formatDateTime(assignment.submittedAt, timezone)}</p>}
          {assignment.reviewedAt && <p>审核：{formatDateTime(assignment.reviewedAt, timezone)}</p>}
        </div>

        {(assignment.submissionNote || assignment.bonusCriteria || assignment.reviewNote) && (
          <div className="mt-2 space-y-1.5 text-sm font-semibold leading-5">
            {assignment.submissionNote && <p className="rounded-xl bg-blue-50 px-3 py-2 text-blue-900"><strong>完成说明：</strong>{assignment.submissionNote}</p>}
            {assignment.bonusCriteria && <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900"><strong>优秀标准：</strong>{assignment.bonusCriteria}</p>}
            {assignment.reviewNote && <p className="rounded-xl bg-purple-50 px-3 py-2 text-purple-900"><strong>审核说明：</strong>{assignment.reviewNote}</p>}
          </div>
        )}

        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-black">{isApproved ? "本次奖励计提" : "任务奖励"}</h3>
            {isApproved && <span className="text-sm text-purple-700"><TimeCoin seconds={creditedSeconds} compact /></span>}
          </div>
          {isApproved ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-center">
                <div><p className="text-[10px] font-bold text-slate-500">基础时数</p><p className="text-xs font-black text-slate-800">{formatDuration(assignment.rewardSeconds, false)}</p></div>
                <div><p className="text-[10px] font-bold text-slate-500">审核系数</p><p className="text-xs font-black text-slate-800">× {assignment.reviewMultiplier || 1}</p></div>
                <div><p className="text-[10px] font-bold text-emerald-600">实际到账</p><p className="text-xs font-black text-emerald-800">{formatDuration(creditedSeconds, false)}</p></div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-black text-slate-600">获得的奖励类型</p>
                {awardedItems.length > 0 ? <TaskRewardList items={awardedItems} showOutcomes /> : <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">本次只有时间币，没有获得额外奖励券。</p>}
              </div>
            </div>
          ) : isRejected ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">本次计提为 0，没有发放时间币或奖励券。</p>
          ) : (
            <TaskRewardSummary baseRewardSeconds={assignment.rewardSeconds} excellentMultiplier={assignment.excellentMultiplier} bonusEnabled={assignment.bonusEnabled} items={assignment.rewardItems} workerPreview />
          )}
        </div>
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

type RewardGroup = { item: RewardItem; items: RewardItem[] };

export function groupAvailableRewards(items: RewardItem[]) {
  const groups = new Map<string, RewardGroup>();
  for (const item of items.filter((reward) => reward.status === "available")) {
    const key = item.definitionId
      ? `${item.definitionId}:${item.definitionVersion}`
      : JSON.stringify([
        item.kind,
        item.name,
        item.description,
        item.icon,
        item.theme,
        item.randomMinSeconds,
        item.randomMaxSeconds,
        item.fixedSeconds,
        item.physicalDescription,
        item.fulfillmentInstructions,
        item.imageUrl || "",
      ]);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { item, items: [item] });
  }
  return [...groups.values()];
}

function rewardStatusClass(status: RewardItem["status"]) {
  if (status === "available") return "bg-blue-100 text-blue-700";
  if (status === "cancelled" || status === "expired") return "bg-slate-100 text-slate-500";
  return "bg-emerald-100 text-emerald-700";
}

const rewardKindLabels: Record<RewardItem["kind"], string> = {
  random_time: "随机时间券",
  fixed_time: "固定时间券",
  physical: "实物券",
};

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
  const [rewardDetail, setRewardDetail] = useState<RewardGroup | null>(null);
  const availableGroups = useMemo(() => groupAvailableRewards(state.rewardItems), [state.rewardItems]);
  const history = useMemo(() => [...state.rewardItems]
    .sort((left, right) => Math.max(
      right.usedAt || 0,
      right.fulfilledAt || 0,
      right.cancelledAt || 0,
      right.grantedAt,
    ) - Math.max(left.usedAt || 0, left.fulfilledAt || 0, left.cancelledAt || 0, left.grantedAt))
    .slice(0, 30), [state.rewardItems]);
  const todayGrant = state.todayDailyCouponGrant;

  async function redeemReward(item: RewardItem) {
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
    return Boolean(next);
  }

  return (
    <div className="space-y-5">
      {!state.rewardSystemEnabled && (
        <section className="app-card border-amber-200 bg-amber-50 p-3 text-center">
          <p className="font-black text-amber-800">奖励系统暂时休息中</p>
          <p className="mt-0.5 text-xs font-semibold text-amber-700">已有券会保留，恢复后可以继续使用。</p>
        </section>
      )}

      {todayGrant && todayGrant.actualQuantity > 0 && (
        <section className="app-card flex items-center gap-3 bg-purple-50 p-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-purple-200 text-purple-700"><Gift size={21} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-purple-900">今日收到 {todayGrant.actualQuantity} 张随机券</p>
            <p className="mt-0.5 text-xs font-bold text-purple-600">每张 {todayGrant.randomMinSeconds / MINUTE}～{todayGrant.randomMaxSeconds / MINUTE} 分钟</p>
          </div>
          <span className="shrink-0 rounded-full bg-purple-600 px-2 py-1 text-xs font-black text-white">+{todayGrant.actualQuantity}</span>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">我的券</h2>
            <p className="mt-0.5 text-sm font-semibold text-slate-500">同类已合并，点开后操作</p>
          </div>
          {state.availableRewardCount > 0 && <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-black text-purple-700">共 {state.availableRewardCount} 张</span>}
        </div>
        {availableGroups.length === 0 ? (
          <EmptyState title="还没有可用券" text="每日派发、任务或管理员发放的券会出现在这里。" />
        ) : (
          <div className="app-card divide-y divide-purple-50 overflow-hidden">
            {availableGroups.map((group) => <RewardGroupRow key={`${group.item.id}:${group.items.length}`} group={group} onClick={() => setRewardDetail(group)} />)}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-xl font-black">最近奖励记录</h2>
          <p className="mt-0.5 text-sm font-semibold text-slate-500">点开查看来源、内容与使用结果</p>
        </div>
        {history.length === 0 ? (
          <div className="soft-card p-4 text-center text-sm font-bold text-slate-500">还没有奖励记录</div>
        ) : (
          <div className="app-card divide-y divide-purple-50 overflow-hidden">
            {history.map((item) => (
              <button type="button" className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-purple-50" key={item.id} onClick={() => setRewardDetail({ item, items: [item] })}>
                <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5"><p className="truncate text-sm font-black">{item.name}</p><span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black ${rewardStatusClass(item.status)}`}>{rewardStatusLabels[item.status]}</span></div>
                  <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{rewardSourceLabels[item.sourceType]} · {formatDateTime(item.usedAt || item.fulfilledAt || item.cancelledAt || item.grantedAt, state.worker.timezone)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-xs font-black ${item.resultSeconds ? "text-emerald-700" : "text-purple-700"}`}>{item.resultSeconds ? `+${formatDuration(item.resultSeconds, false)}` : rewardKindLabels[item.kind]}</p>
                  <p className="mt-0.5 text-[10px] font-bold text-slate-400">查看详情</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {rewardDetail && (
        <RewardDetailDialog
          group={rewardDetail}
          timezone={state.worker.timezone}
          busy={busy}
          enabled={state.rewardSystemEnabled}
          onClose={() => setRewardDetail(null)}
          onRedeem={async (item) => {
            const ok = await redeemReward(item);
            if (ok) setRewardDetail(null);
          }}
          onConfirmPhysical={(item) => {
            setRewardDetail(null);
            setConfirmPhysical(item);
          }}
        />
      )}

      {lastResult && <RewardRedeemResultDialog result={lastResult} onClose={() => setLastResult(null)} />}

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

function RewardGroupRow({ group, onClick }: { group: RewardGroup; onClick: () => void }) {
  const { item, items } = group;
  return (
    <button type="button" className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-purple-50" onClick={onClick}>
      <RewardCountVisual item={item} count={items.length} size={42} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-black">{item.name}</h3>
        <p className="mt-0.5 truncate text-xs font-black text-purple-700">{rewardValueText(item)}</p>
        <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{rewardKindLabels[item.kind]} · 永久有效</p>
      </div>
      <span className={`shrink-0 text-xs font-black ${item.kind === "physical" ? "text-emerald-700" : "text-purple-700"}`}>{item.kind === "physical" ? "查看" : "使用"}</span>
    </button>
  );
}

function RewardCountVisual({ item, count, size }: { item: RewardItem; count: number; size: number }) {
  return (
    <span className="relative shrink-0">
      <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={size} />
      {count > 1 && <span className="absolute -bottom-1 -right-1 min-w-5 rounded-full bg-purple-600 px-1 text-center text-[9px] font-black leading-4 text-white">×{count}</span>}
    </span>
  );
}

function RewardDetailDialog({
  group,
  timezone,
  busy,
  enabled,
  onClose,
  onRedeem,
  onConfirmPhysical,
}: {
  group: RewardGroup;
  timezone: string;
  busy: boolean;
  enabled: boolean;
  onClose: () => void;
  onRedeem: (item: RewardItem) => Promise<void>;
  onConfirmPhysical: (item: RewardItem) => void;
}) {
  const { item, items } = group;
  const availableItems = items.filter((candidate) => candidate.status === "available");
  const sources = [...new Set(items.map((candidate) => rewardSourceLabels[candidate.sourceType]))].join("、");
  const reasons = [...new Set(items.map((candidate) => candidate.grantReason).filter(Boolean))];
  const latestGrantedAt = Math.max(...items.map((candidate) => candidate.grantedAt));
  const average = item.kind === "random_time" ? (item.randomMinSeconds! + item.randomMaxSeconds!) / (2 * MINUTE) : null;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-2 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="page-enter max-h-[88vh] w-full max-w-md overflow-y-auto rounded-[24px] bg-white p-4 shadow-2xl sm:p-5" role="dialog" aria-modal="true" aria-labelledby="reward-detail-title">
        <div className="flex items-start gap-3">
          <RewardCountVisual item={item} count={items.length} size={58} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 id="reward-detail-title" className="text-xl font-black">{item.name}</h2>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${rewardStatusClass(item.status)}`}>{rewardStatusLabels[item.status]}</span>
            </div>
            <p className="mt-1 text-sm font-black text-purple-700">{rewardValueText(item)}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">{items.length > 1 ? `同类共 ${items.length} 张` : rewardKindLabels[item.kind]}</p>
          </div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="关闭奖励券详情" disabled={busy} onClick={onClose}><XCircle size={19} /></button>
        </div>

        {item.description && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold leading-5 text-slate-600">{item.description}</p>}

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-purple-50 px-3 py-2"><p className="font-bold text-purple-500">券类型</p><p className="mt-0.5 font-black text-purple-900">{rewardKindLabels[item.kind]}</p></div>
          <div className="rounded-xl bg-blue-50 px-3 py-2"><p className="font-bold text-blue-500">来源</p><p className="mt-0.5 truncate font-black text-blue-900">{sources}</p></div>
          <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="font-bold text-slate-500">{items.length > 1 ? "最近发放" : "发放时间"}</p><p className="mt-0.5 font-black text-slate-800">{formatDateTime(latestGrantedAt, timezone)}</p></div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2"><p className="font-bold text-emerald-600">有效期</p><p className="mt-0.5 font-black text-emerald-800">{item.expiresAt ? formatDateTime(item.expiresAt, timezone) : "永久有效"}</p></div>
        </div>

        {average !== null && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">随机范围内每个整数分钟机会相同，平均 {average} 分钟。</p>}
        {reasons.length > 0 && <p className="mt-2 text-xs font-semibold leading-5 text-slate-600"><strong>发放说明：</strong>{reasons.join("；")}</p>}
        {item.kind === "physical" && item.fulfillmentInstructions && <p className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold leading-5 text-blue-900"><strong>领取说明：</strong>{item.fulfillmentInstructions}</p>}

        {(item.resultSeconds || item.usedAt || item.fulfilledAt || item.cancellationReason) && (
          <div className="mt-3 space-y-1 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
            {item.resultSeconds && <p><strong>实际获得：</strong>{formatDuration(item.resultSeconds, false)}</p>}
            {item.usedAt && <p><strong>使用时间：</strong>{formatDateTime(item.usedAt, timezone)}</p>}
            {item.fulfilledAt && <p><strong>确认收到：</strong>{formatDateTime(item.fulfilledAt, timezone)}</p>}
            {item.cancelledAt && <p><strong>撤销时间：</strong>{formatDateTime(item.cancelledAt, timezone)}</p>}
            {item.cancellationReason && <p><strong>撤销原因：</strong>{item.cancellationReason}</p>}
          </div>
        )}

        {availableItems.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              className={`${item.kind === "physical" ? "success-button" : "primary-button"} w-full`}
              disabled={busy || !enabled}
              onClick={() => item.kind === "physical" ? onConfirmPhysical(availableItems[0]) : void onRedeem(availableItems[0])}
            >
              {item.kind === "random_time" ? <><Sparkles className="mr-1 inline" size={18} />打开 1 张</> : item.kind === "fixed_time" ? <><Clock3 className="mr-1 inline" size={18} />使用 1 张</> : <><CheckCircle2 className="mr-1 inline" size={18} />确认收到 1 件</>}
            </button>
            {availableItems.length > 1 && <p className="mt-2 text-center text-xs font-bold text-slate-500">本次操作 1 张，当前共有 {availableItems.length} 张</p>}
            {!enabled && <p className="mt-2 text-center text-xs font-bold text-amber-700">奖励系统恢复后可以操作</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function RewardRedeemResultDialog({ result, onClose }: { result: { name: string; seconds: number }; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="page-enter w-full max-w-sm rounded-[24px] bg-white p-5 text-center shadow-2xl" role="dialog" aria-modal="true" aria-label="奖励券使用结果">
        <Sparkles className="mx-auto text-emerald-600" size={34} />
        <p className="mt-2 text-sm font-black text-slate-700">{result.name}</p>
        <p className="mt-1 text-3xl font-black text-emerald-700">+{formatDuration(result.seconds, false)}</p>
        <button type="button" className="primary-button mt-4 w-full" onClick={onClose}>知道啦</button>
      </section>
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

function LedgerPanel({ state, onOpenTaskDetail }: { state: WorkerState; onOpenTaskDetail: (assignment: Assignment) => void }) {
  const [filter, setFilter] = useState<"all" | "income" | "spent" | "daily">("all");
  const rows = useMemo(() => state.transactions.filter((item) => filter === "all" || filter === "income" && item.amountSeconds > 0 || filter === "spent" && item.amountSeconds < 0 || filter === "daily" && item.type === "daily_reward"), [state.transactions, filter]);
  return (
    <div className="space-y-4">
      <section className="app-card grid grid-cols-3 gap-2 p-4 text-center"><div><p className="text-xs font-bold text-slate-500">当前余额</p><p className="mt-1 text-sm font-black text-purple-700">{formatDuration(state.worker.balanceSeconds, false)}</p></div><div><p className="text-xs font-bold text-slate-500">累计收入</p><p className="mt-1 text-sm font-black text-emerald-700">{formatDuration(state.transactions.filter((x) => x.amountSeconds > 0).reduce((a, b) => a + b.amountSeconds, 0), false)}</p></div><div><p className="text-xs font-bold text-slate-500">累计消耗</p><p className="mt-1 text-sm font-black text-orange-700">{formatDuration(Math.abs(state.transactions.filter((x) => x.amountSeconds < 0).reduce((a, b) => a + b.amountSeconds, 0)), false)}</p></div></section>
      <div className="flex gap-2 overflow-x-auto pb-1">{([['all','全部'],['income','收入'],['spent','消耗'],['daily','每日奖励']] as const).map(([id,label]) => <button key={id} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-black ${filter === id ? "bg-purple-600 text-white" : "bg-white text-slate-600 shadow-sm"}`} onClick={() => setFilter(id)}>{label}</button>)}</div>
      {rows.length === 0 ? <EmptyState title="还没有明细" text="奖励和消耗记录会出现在这里。" /> : (
        <div className="app-card divide-y divide-purple-50 overflow-hidden">
          {rows.map((item) => {
            const assignment = item.assignmentId
              ? state.assignments.find((candidate) => candidate.id === item.assignmentId) || null
              : null;
            const content = (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${item.amountSeconds > 0 ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>{item.amountSeconds > 0 ? <TrendingUp size={21} /> : <TrendingDown size={21} />}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5"><p className="truncate text-sm font-black">{item.title}</p>{item.isReversed && <span className="pill shrink-0 bg-slate-100 text-slate-500">已撤销</span>}</div>
                    <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-500">{formatDateTime(item.createdAt, state.worker.timezone)}{item.reason ? ` · ${item.reason}` : ""}</p>
                    {assignment && <p className="mt-0.5 text-[11px] font-black text-purple-700">点开查看完整任务计提</p>}
                  </div>
                </div>
                <div className={`shrink-0 text-right text-sm font-black ${item.amountSeconds > 0 ? "text-emerald-600" : "text-orange-600"}`}><p>{item.amountSeconds > 0 ? "+" : "−"}{formatDuration(Math.abs(item.amountSeconds), Math.abs(item.amountSeconds) < MINUTE)}</p><p className="mt-0.5 text-[10px] text-slate-400">余额 {formatDuration(item.balanceAfterSeconds, false)}</p></div>
              </>
            );
            return assignment ? (
              <button key={item.id} type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-purple-50" onClick={() => onOpenTaskDetail(assignment)}>{content}</button>
            ) : (
              <div className="flex items-center justify-between gap-3 p-3" key={item.id}>{content}</div>
            );
          })}
        </div>
      )}
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
