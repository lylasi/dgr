"use client";

import { Eye, EyeOff, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "@/components/api";
import { Avatar, PencilMascot } from "@/components/shared";
import type { BootstrapState, Identity, WorkerPublic } from "@/components/types";

type LoginTarget = { type: "admin" } | { type: "worker"; worker: WorkerPublic };

export function LoginScreen({
  bootstrap,
  onEntered,
}: {
  bootstrap: BootstrapState;
  onEntered: (identity: Identity) => void;
}) {
  const [target, setTarget] = useState<LoginTarget | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function selectAdmin() {
    if (bootstrap.adminAuthorized) {
      await switchIdentity({ type: "admin" });
    } else {
      setTarget({ type: "admin" });
      setPassword("");
      setError("");
    }
  }

  async function selectWorker(worker: WorkerPublic) {
    if (worker.authorized) {
      await switchIdentity({ type: "worker", workerId: worker.id });
    } else {
      setTarget({ type: "worker", worker });
      setPassword("");
      setError("");
    }
  }

  async function switchIdentity(identity: Identity) {
    setBusy(true);
    setError("");
    try {
      await api<{ activeIdentity: Identity }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "switch", identity }),
      });
      onEntered(identity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "切换失败，请重新登录。");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target || !password) return;
    setBusy(true);
    setError("");
    try {
      const body = target.type === "admin"
        ? { action: "admin_login", password }
        : { action: "worker_login", workerId: target.worker.id, password };
      const result = await api<{ activeIdentity: Identity }>("/api/auth", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onEntered(result.activeIdentity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请再试一次。");
    } finally {
      setBusy(false);
    }
  }

  if (target) {
    const worker = target.type === "worker" ? target.worker : null;
    return (
      <main className="grid min-h-screen place-items-center px-4 py-8">
        <form onSubmit={submit} className="app-card page-enter w-full max-w-md px-5 py-6 sm:px-8 sm:py-8">
          <button
            type="button"
            className="mb-5 min-h-11 rounded-xl px-2 text-sm font-black text-purple-700"
            onClick={() => setTarget(null)}
          >
            ← 返回选择角色
          </button>
          <div className="flex flex-col items-center text-center">
            {worker ? (
              <Avatar avatar={worker.avatar} theme={worker.theme} imageUrl={worker.avatarUrl} size={78} />
            ) : (
              <div className="grid h-[78px] w-[78px] place-items-center rounded-[28px] border-2 border-purple-300 bg-purple-100 text-purple-700">
                <ShieldCheck size={40} strokeWidth={2.7} />
              </div>
            )}
            <h1 className="mt-4 text-2xl font-black">{worker?.name || "管理员"}</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">
              {worker ? "输入你的小金库密码" : "输入配置文件中的管理员密码"}
            </p>
          </div>
          <label className="mt-6 block">
            <span className="label">密码或 PIN</span>
            <div className="relative">
              <input
                className="field !pr-12 text-lg tracking-wider"
                type={showPassword ? "text" : "password"}
                inputMode={worker ? "numeric" : "text"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-xl text-slate-500"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
              </button>
            </div>
          </label>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700">
            <LockKeyhole size={16} />
            登录后会记住这台设备，下次不用再输入
          </div>
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button className="primary-button mt-5 w-full" disabled={busy || !password}>
            {busy ? "正在打开…" : "打开我的空间"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center text-center">
          <PencilMascot />
          <div className="pill -mt-1 bg-amber-100 text-amber-800"><Sparkles size={15} /> 时间也能存进小金库</div>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">PEN子打工人</h1>
          <p className="mt-2 text-sm font-bold text-slate-500 sm:text-base">今天想用哪个角色开始？</p>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {bootstrap.workers.map((worker) => (
            <button
              type="button"
              key={worker.id}
              className="app-card flex min-h-40 flex-col items-center justify-center px-3 py-5 text-center transition hover:-translate-y-1"
              onClick={() => selectWorker(worker)}
              disabled={busy}
            >
              <Avatar avatar={worker.avatar} theme={worker.theme} imageUrl={worker.avatarUrl} size={66} />
              <strong className="mt-3 max-w-full truncate text-base">{worker.name}</strong>
              <span className={`pill mt-2 ${worker.authorized ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {worker.authorized ? "本机已登录" : "需要密码"}
              </span>
            </button>
          ))}

          <button
            type="button"
            className="app-card flex min-h-40 flex-col items-center justify-center px-3 py-5 text-center transition hover:-translate-y-1"
            onClick={selectAdmin}
            disabled={busy}
          >
            <div className="grid h-[66px] w-[66px] place-items-center rounded-[24px] border-2 border-purple-300 bg-purple-100 text-purple-700">
              <ShieldCheck size={34} strokeWidth={2.7} />
            </div>
            <strong className="mt-3 text-base">管理员</strong>
            <span className={`pill mt-2 ${bootstrap.adminAuthorized ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {bootstrap.adminAuthorized ? "本机已登录" : "管理入口"}
            </span>
          </button>
        </div>

        {bootstrap.workers.length === 0 && (
          <p className="mx-auto mt-5 max-w-md rounded-2xl bg-white/80 px-4 py-3 text-center text-sm font-bold text-slate-600 shadow-sm">
            还没有打工人，请先从管理员入口登录并创建第一个角色。
          </p>
        )}
        {error && <p className="mx-auto mt-4 max-w-md rounded-xl bg-red-50 px-3 py-2 text-center text-sm font-bold text-red-600">{error}</p>}
      </div>
    </main>
  );
}
