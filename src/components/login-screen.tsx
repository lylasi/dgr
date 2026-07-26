"use client";

import {
  BriefcaseBusiness,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { api } from "@/components/api";
import { Avatar, PencilMascot } from "@/components/shared";
import type {
  BootstrapState,
  BossMembership,
  BossSessionSummary,
  Identity,
  WorkerPublic,
} from "@/components/types";

type LoginTarget =
  | { type: "system_admin" }
  | { type: "boss" }
  | { type: "worker"; worker: WorkerPublic };

type PendingBoss = {
  id: string;
  username: string;
  displayName: string;
  families: BossMembership[];
};

type BossLoginResponse = {
  activeIdentity: Identity | null;
  boss: { id: string; username: string; displayName: string };
  families: BossMembership[];
  familySelectionRequired: boolean;
};

export function LoginScreen({
  bootstrap,
  entryCode,
  onEntered,
}: {
  bootstrap: BootstrapState;
  entryCode?: string;
  onEntered: (identity: Identity) => void;
}) {
  const [target, setTarget] = useState<LoginTarget | null>(null);
  const [pendingBoss, setPendingBoss] = useState<PendingBoss | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const familyBosses = useMemo(
    () => bootstrap.bosses.filter((boss) => boss.families.some((family) => family.familyId === bootstrap.family.id)),
    [bootstrap.bosses, bootstrap.family.id],
  );
  const activeBoss = useMemo(() => {
    const active = bootstrap.activeIdentity;
    if (
      (active?.type !== "boss" && active?.type !== "boss_as_worker")
      || active.familyId !== bootstrap.family.id
    ) return null;
    return familyBosses.find((boss) => boss.id === active.bossId) || null;
  }, [bootstrap.activeIdentity, bootstrap.family.id, familyBosses]);

  function clearForm() {
    setTarget(null);
    setPendingBoss(null);
    setPassword("");
    setError("");
  }

  async function requestSwitch(identity: Identity) {
    return await api<{ activeIdentity: Identity }>("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "switch", identity }),
    });
  }

  async function switchIdentity(identity: Identity) {
    setBusy(true);
    setError("");
    try {
      const result = await requestSwitch(identity);
      onEntered(result.activeIdentity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "切换失败，请重新登录。");
    } finally {
      setBusy(false);
    }
  }

  async function enterAsBoss(boss: BossSessionSummary, worker: WorkerPublic) {
    setBusy(true);
    setError("");
    try {
      const active = bootstrap.activeIdentity;
      if (
        (active?.type !== "boss" && active?.type !== "boss_as_worker")
        || active.bossId !== boss.id
        || active.familyId !== bootstrap.family.id
      ) {
        await requestSwitch({ type: "boss", bossId: boss.id, familyId: bootstrap.family.id });
      }
      const result = await requestSwitch({
        type: "boss_as_worker",
        bossId: boss.id,
        workerId: worker.id,
        familyId: bootstrap.family.id,
      });
      onEntered(result.activeIdentity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "进入小朋友页面失败。");
    } finally {
      setBusy(false);
    }
  }

  async function selectSystemAdmin() {
    if (bootstrap.systemAdminAuthorized) {
      await switchIdentity({ type: "system_admin" });
      return;
    }
    setTarget({ type: "system_admin" });
    setPassword("");
    setError("");
  }

  async function selectWorker(worker: WorkerPublic) {
    if (activeBoss) {
      await enterAsBoss(activeBoss, worker);
      return;
    }
    if (worker.authorized) {
      await switchIdentity({ type: "worker", workerId: worker.id, familyId: worker.familyId });
      return;
    }
    setTarget({ type: "worker", worker });
    setPassword("");
    setError("");
  }

  async function openRememberedBoss(boss: BossSessionSummary) {
    const currentMembership = boss.families.find((family) => family.familyId === bootstrap.family.id);
    if (entryCode) {
      if (!currentMembership) {
        setError(`${boss.displayName}没有管理当前家庭的权限。`);
        return;
      }
      await switchIdentity({ type: "boss", bossId: boss.id, familyId: bootstrap.family.id });
      return;
    }
    if (boss.families.length === 1) {
      await switchIdentity({ type: "boss", bossId: boss.id, familyId: boss.families[0].familyId });
      return;
    }
    setPendingBoss({
      id: boss.id,
      username: boss.username,
      displayName: boss.displayName,
      families: boss.families,
    });
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target || !password) return;
    setBusy(true);
    setError("");
    try {
      if (target.type === "boss") {
        const result = await api<BossLoginResponse>("/api/auth", {
          method: "POST",
          body: JSON.stringify({
            action: "boss_login",
            username,
            password,
            ...(entryCode ? { familyId: bootstrap.family.id } : {}),
          }),
        });
        if (result.activeIdentity) {
          onEntered(result.activeIdentity);
        } else {
          setPendingBoss({ ...result.boss, families: result.families });
          setPassword("");
        }
      } else {
        const body = target.type === "system_admin"
          ? { action: "system_admin_login", password }
          : { action: "worker_login", workerId: target.worker.id, password };
        const result = await api<{ activeIdentity: Identity }>("/api/auth", {
          method: "POST",
          body: JSON.stringify(body),
        });
        onEntered(result.activeIdentity);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请再试一次。");
    } finally {
      setBusy(false);
    }
  }

  if (pendingBoss) {
    return (
      <CenteredCard onBack={clearForm}>
        <div className="flex flex-col items-center text-center">
          <div className="grid h-[78px] w-[78px] place-items-center rounded-[28px] border-2 border-purple-300 bg-purple-100 text-purple-700"><BriefcaseBusiness size={38} /></div>
          <h1 className="mt-4 text-2xl font-black">{pendingBoss.displayName}</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">请选择这次要管理的家庭</p>
        </div>
        <div className="mt-6 space-y-3">
          {pendingBoss.families.map((family) => (
            <button
              key={family.familyId}
              className="app-card flex min-h-16 w-full items-center justify-between px-4 text-left font-black"
              disabled={busy}
              onClick={() => void switchIdentity({ type: "boss", bossId: pendingBoss.id, familyId: family.familyId })}
            >
              <span className="min-w-0">
                <span className="block truncate">{family.familyName}</span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">在这里显示为：{family.displayName}</span>
              </span>
              <span className="shrink-0 text-purple-600">进入 →</span>
            </button>
          ))}
        </div>
        {error && <ErrorMessage message={error} />}
      </CenteredCard>
    );
  }

  if (target) {
    const worker = target.type === "worker" ? target.worker : null;
    const isBoss = target.type === "boss";
    return (
      <main className="grid min-h-screen place-items-center px-4 py-8">
        <form onSubmit={submit} className="app-card page-enter w-full max-w-md px-5 py-6 sm:px-8 sm:py-8">
          <button type="button" className="mb-5 min-h-11 rounded-xl px-2 text-sm font-black text-purple-700" onClick={clearForm}>← 返回角色选择</button>
          <div className="flex flex-col items-center text-center">
            {worker ? (
              <Avatar avatar={worker.avatar} theme={worker.theme} imageUrl={worker.avatarUrl} size={78} />
            ) : (
              <div className="grid h-[78px] w-[78px] place-items-center rounded-[28px] border-2 border-purple-300 bg-purple-100 text-purple-700">
                {isBoss ? <BriefcaseBusiness size={40} /> : <ShieldCheck size={40} strokeWidth={2.7} />}
              </div>
            )}
            <h1 className="mt-4 text-2xl font-black">{worker?.name || (isBoss ? "老板登录" : "系统管理员")}</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">
              {worker ? "输入你的小金库 PIN" : isBoss ? "使用系统管理员创建的老板账号" : "输入服务器环境变量中的系统管理员密码"}
            </p>
          </div>
          {isBoss && (
            <label className="mt-6 block">
              <span className="label">老板登录名</span>
              <input className="field" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required />
            </label>
          )}
          <label className={`${isBoss ? "mt-3" : "mt-6"} block`}>
            <span className="label">{worker ? "PIN" : "密码"}</span>
            <div className="relative">
              <input
                className="field !pr-12 text-lg tracking-wider"
                type={showPassword ? "text" : "password"}
                inputMode={worker ? "numeric" : "text"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus={!isBoss}
                required
              />
              <button type="button" className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-xl text-slate-500" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>
                {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
              </button>
            </div>
          </label>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700"><LockKeyhole size={16} />登录后会安全地记住这台设备</div>
          {error && <ErrorMessage message={error} />}
          <button className="primary-button mt-5 w-full" disabled={busy || !password || (isBoss && !username.trim())}>{busy ? "正在打开…" : "登录"}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center text-center">
          <PencilMascot />
          <div className="pill -mt-1 bg-amber-100 text-amber-800"><Sparkles size={15} />时间也能存进小金库</div>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">PEN子打工人</h1>
          <p className="mt-2 text-base font-black text-purple-800">{bootstrap.family.name}</p>
          <p className="mt-1 text-sm font-bold text-slate-500">今天想用哪个角色开始？</p>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {bootstrap.workers.map((worker) => {
            const proxyAvailable = Boolean(activeBoss);
            return (
              <button type="button" key={worker.id} className="app-card flex min-h-40 flex-col items-center justify-center px-3 py-5 text-center transition hover:-translate-y-1" onClick={() => void selectWorker(worker)} disabled={busy}>
                <Avatar avatar={worker.avatar} theme={worker.theme} imageUrl={worker.avatarUrl} size={66} />
                <strong className="mt-3 max-w-full truncate text-base">{worker.name}</strong>
                <span className={`pill mt-2 ${proxyAvailable || worker.authorized ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {proxyAvailable ? "老板可直接进入" : worker.authorized ? "本机已登录" : "需要 PIN"}
                </span>
              </button>
            );
          })}
        </div>

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 className="font-black">老板</h2><p className="text-xs font-semibold text-slate-500">管理任务、奖励和家庭设置</p></div>
            <button className="primary-button !min-h-10 text-sm" onClick={() => { setTarget({ type: "boss" }); setPassword(""); setError(""); }}>老板账号登录</button>
          </div>
          {bootstrap.bosses.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {bootstrap.bosses.map((boss) => {
                const currentMembership = boss.families.find((family) => family.familyId === bootstrap.family.id);
                return (
                  <button key={boss.id} className="app-card flex min-h-16 items-center gap-3 px-4 text-left" disabled={busy} onClick={() => void openRememberedBoss(boss)}>
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-purple-100 text-purple-700"><BriefcaseBusiness size={23} /></div>
                    <div className="min-w-0"><p className="truncate font-black">{currentMembership?.displayName || boss.displayName}</p><p className="truncate text-xs font-semibold text-emerald-700">本机已记住 · {boss.families.length} 个家庭</p></div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {bootstrap.workers.length === 0 && (
          <p className="mx-auto mt-5 max-w-md rounded-2xl bg-white/80 px-4 py-3 text-center text-sm font-bold text-slate-600 shadow-sm">这个家庭还没有小朋友角色，请由老板登录后创建。</p>
        )}
        {error && <ErrorMessage message={error} centered />}

        <div className="mt-10 border-t border-slate-200 pt-5 text-center">
          <button className="min-h-11 px-3 text-xs font-bold text-slate-400 hover:text-purple-700" onClick={() => void selectSystemAdmin()} disabled={busy}>
            <UsersRound className="mr-1 inline" size={14} />系统维护入口{bootstrap.systemAdminAuthorized ? "（本机已登录）" : ""}
          </button>
        </div>
      </div>
    </main>
  );
}

function CenteredCard({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <section className="app-card page-enter w-full max-w-md px-5 py-6 sm:px-8 sm:py-8">
        <button type="button" className="mb-5 min-h-11 rounded-xl px-2 text-sm font-black text-purple-700" onClick={onBack}>← 返回角色选择</button>
        {children}
      </section>
    </main>
  );
}

function ErrorMessage({ message, centered = false }: { message: string; centered?: boolean }) {
  return <p className={`mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600 ${centered ? "mx-auto max-w-md text-center" : ""}`}>{message}</p>;
}
