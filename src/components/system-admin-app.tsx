"use client";

import {
  Building2,
  Clipboard,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, copyText, mutationId } from "@/components/api";
import { FamilyEntryQr } from "@/components/family-entry-qr";
import { AppHeader, LoadingScreen, Toast } from "@/components/shared";
import type {
  SystemBoss,
  SystemFamily,
  SystemManagementState,
} from "@/components/types";
import { formatDateTime } from "@/lib/time";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请再试一次。";
}

type Mutate = (body: Record<string, unknown>, success: string) => Promise<boolean>;

export function SystemAdminApp({
  onSwitch,
  onAuthorizationError,
}: {
  onSwitch: () => void;
  onAuthorizationError: (error: unknown) => boolean;
}) {
  const [state, setState] = useState<SystemManagementState | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<SystemManagementState>("/api/system"));
    } catch (error) {
      if (!onAuthorizationError(error)) {
        setToast({ message: messageOf(error), tone: "error" });
      }
    }
  }, [onAuthorizationError]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function mutate(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const data = await api<SystemManagementState>("/api/system", {
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

  async function logout() {
    await api("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "logout_current" }),
    });
    onSwitch();
  }

  if (!state) return <LoadingScreen />;

  return (
    <div className="min-h-screen pb-12">
      {toast && <Toast {...toast} />}
      <AppHeader
        title="系统维护"
        subtitle="只管理家庭、老板账号和绑定关系"
        onSwitch={onSwitch}
        admin
      />
      <main className="page-enter mx-auto w-full max-w-4xl space-y-8 px-4 pb-8 sm:px-6">
        <SystemOverview state={state} />

        <section>
          <div className="flex items-start justify-between gap-3">
            <SectionTitle title="家庭" text="家庭使用系统统一时区；入口轮换后，旧链接和旧二维码立即失效。" />
            <CreateFamily busy={busy} mutate={mutate} />
          </div>
          <div className="mt-3 space-y-2">
            {state.families.map((family) => (
              <FamilyCard
                key={family.id}
                family={family}
                origin={origin}
                busy={busy}
                mutate={mutate}
                onNotice={(message, tone) => setToast({ message, tone })}
              />
            ))}
          </div>
        </section>

        <BossManagement
          bosses={state.bosses}
          families={state.families}
          busy={busy}
          mutate={mutate}
        />

        <section>
          <SectionTitle title="最近系统操作" text="这里只记录系统级账号和归属维护，不显示家庭内部业务详情。" />
          <div className="app-card divide-y divide-slate-100 overflow-hidden">
            {state.auditLogs.length === 0 ? (
              <p className="p-5 text-sm font-bold text-slate-500">还没有系统维护记录。</p>
            ) : state.auditLogs.slice(0, 30).map((log) => (
              <div key={log.id} className="px-4 py-3">
                <p className="text-sm font-black text-slate-800">{log.detail || log.action}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(log.createdAt)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="app-card p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 shrink-0 text-purple-600" />
            <p className="text-sm font-semibold leading-6 text-slate-600">
              系统管理员密码仍由服务器环境变量管理；家庭日常任务、奖励、账本和小朋友资料请由对应老板处理。
            </p>
          </div>
          <button className="danger-button mt-4 w-full" onClick={() => void logout()}>退出系统管理员</button>
        </section>
      </main>
    </div>
  );
}

export function SystemOverview({ state }: { state: SystemManagementState }) {
  const activeFamilies = state.families.filter((family) => family.status === "active").length;
  const activeBosses = state.bosses.filter((boss) => boss.isActive).length;
  const workers = state.families.reduce((sum, family) => sum + family.workerCount, 0);
  return (
    <section>
      <p className="mb-3 rounded-2xl bg-purple-50 px-4 py-3 text-sm font-bold leading-6 text-purple-800">
        系统管理员只管理家庭、老板账号和绑定关系，不进入家庭日常业务。
      </p>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <SummaryCard icon={Building2} value={activeFamilies} label="启用家庭" />
        <SummaryCard icon={UserCog} value={activeBosses} label="启用老板" />
        <SummaryCard icon={ShieldCheck} value={workers} label="小朋友总数" />
      </div>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Building2;
  value: number;
  label: string;
}) {
  return (
    <div className="app-card px-2 py-4 text-center">
      <Icon className="mx-auto text-purple-600" size={26} />
      <strong className="mt-2 block text-2xl">{value}</strong>
      <span className="text-xs font-bold text-slate-500">{label}</span>
    </div>
  );
}

function SectionTitle({ title, text }: { title: string; text: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">{text}</p>
    </div>
  );
}

export function CreateFamily({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "create_family", name }, "家庭已创建");
    if (ok) {
      setName("");
      setOpen(false);
    }
  }

  function close() {
    if (busy) return;
    setName("");
    setOpen(false);
  }

  return (
    <div>
      <button type="button" className="primary-button shrink-0 !min-h-10 !px-3 text-sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Plus className="mr-1 inline" size={16} />创建家庭
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <form
            className="page-enter w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-family-title"
            onSubmit={submit}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="create-family-title" className="text-xl font-black">创建家庭</h3>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">家庭将自动使用系统统一时区。</p>
              </div>
              <button type="button" className="icon-button shrink-0" aria-label="关闭创建家庭弹窗" disabled={busy} onClick={close}><X size={20} /></button>
            </div>
            <label className="mt-4 block">
              <span className="label">家庭名称</span>
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus required />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" className="secondary-button" disabled={busy} onClick={close}>取消</button>
              <button className="primary-button" disabled={busy || !name.trim()}>确认创建</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function FamilyCard({
  family,
  origin,
  busy,
  mutate,
  onNotice,
}: {
  family: SystemFamily;
  origin: string;
  busy: boolean;
  mutate: Mutate;
  onNotice: (message: string, tone: "success" | "error") => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(family.name);
  const entryUrl = `${origin}/family/${family.entryCode}`;

  useEffect(() => {
    setName(family.name);
  }, [family.name]);

  async function copyLink() {
    try {
      await copyText(entryUrl);
      onNotice("家庭入口链接已复制", "success");
    } catch (error) {
      onNotice(messageOf(error), "error");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "update_family", familyId: family.id, name }, "家庭资料已更新");
    if (ok) setOpen(false);
  }

  function openEditor() {
    setName(family.name);
    setOpen(true);
  }

  function closeEditor() {
    if (busy) return;
    setName(family.name);
    setOpen(false);
  }

  return (
    <>
      <article className={`app-card px-4 py-3 ${family.status === "inactive" ? "opacity-70" : ""}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-black sm:text-lg">{family.name}</h3>
              <span className={`pill ${family.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {family.status === "active" ? "使用中" : "已停用"}
              </span>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500">{family.bossCount} 位老板 · {family.workerCount} 位小朋友</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="secondary-button shrink-0 !min-h-10 !px-3 text-sm"
              aria-haspopup="dialog"
              onClick={openEditor}
            ><Pencil className="mr-1 inline" size={16} />编辑</button>
            <button
              type="button"
              className={`${family.status === "active" ? "danger-button" : "success-button"} shrink-0 !min-h-10 !px-3 text-sm`}
              disabled={busy}
              onClick={() => void mutate({ action: "update_family", familyId: family.id, status: family.status === "active" ? "inactive" : "active" }, family.status === "active" ? "家庭已停用" : "家庭已启用")}
            >{family.status === "active" ? "停用" : "启用"}</button>
          </div>
        </div>
      </article>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-2 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}
        >
          <form
            className="page-enter max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`edit-family-${family.id}`}
            onSubmit={save}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id={`edit-family-${family.id}`} className="text-xl font-black">编辑家庭</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">{family.bossCount} 位老板 · {family.workerCount} 位小朋友</p>
              </div>
              <button type="button" className="icon-button shrink-0" aria-label="关闭编辑家庭弹窗" disabled={busy} onClick={closeEditor}><X size={20} /></button>
            </div>

            <label className="mt-4 block">
              <span className="label">家庭名称</span>
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required />
            </label>
            <button className="primary-button mt-3 w-full" disabled={busy || !name.trim() || name.trim() === family.name}>保存家庭名称</button>

            <div className="mt-5 rounded-2xl bg-purple-50 p-3">
              <div className="flex items-center gap-2 font-black text-purple-800"><Link2 size={18} />家庭入口</div>
              <p className="mt-2 break-all text-xs font-semibold leading-5 text-purple-700">{entryUrl || `/family/${family.entryCode}`}</p>
              {origin && <FamilyEntryQr url={entryUrl} familyName={family.name} />}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="secondary-button !min-h-10 text-sm" disabled={!origin} onClick={() => void copyLink()}><Clipboard className="mr-1 inline" size={16} />复制链接</button>
                <button
                  type="button"
                  className="secondary-button !min-h-10 text-sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("轮换后，之前分享的家庭链接和二维码会立即失效。确定继续吗？")) {
                      void mutate({ action: "rotate_family_entry_code", familyId: family.id }, "家庭入口已轮换");
                    }
                  }}
                ><RefreshCw className="mr-1 inline" size={16} />轮换入口</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function bossMatchesQuery(boss: SystemBoss, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return [
    boss.displayName,
    boss.username,
    ...boss.families.map((family) => family.familyName),
    ...boss.families.map((family) => family.displayName),
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function BossManagement({
  bosses,
  families,
  busy,
  mutate,
}: {
  bosses: SystemBoss[];
  families: SystemFamily[];
  busy: boolean;
  mutate: Mutate;
}) {
  const [query, setQuery] = useState("");
  const visibleBosses = bosses.filter((boss) => bossMatchesQuery(boss, query));

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <SectionTitle title="老板账号" text="账号资料、家庭绑定和密码重置在编辑弹窗中管理。" />
        <CreateBoss busy={busy} mutate={mutate} />
      </div>
      <label className="relative mt-1 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          className="field !min-h-11 !pl-10"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索显示名、登录名或家庭"
          aria-label="搜索老板账号"
        />
      </label>
      <div className="mt-3 space-y-2">
        {visibleBosses.length === 0 ? (
          <div className="app-card p-5 text-center text-sm font-bold text-slate-500">
            {bosses.length === 0 ? "还没有老板账号。" : "没有找到匹配的老板账号。"}
          </div>
        ) : visibleBosses.map((boss) => (
          <BossCard
            key={boss.id}
            boss={boss}
            families={families}
            busy={busy}
            mutate={mutate}
          />
        ))}
      </div>
    </section>
  );
}

export function CreateBoss({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "create_boss", username, displayName, password }, "老板账号已创建");
    if (ok) {
      setUsername("");
      setDisplayName("");
      setPassword("");
      setOpen(false);
    }
  }

  function close() {
    if (busy) return;
    setUsername("");
    setDisplayName("");
    setPassword("");
    setOpen(false);
  }

  return (
    <div>
      <button type="button" className="primary-button shrink-0 !min-h-10 !px-3 text-sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Plus className="mr-1 inline" size={16} />创建老板
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <form
            className="page-enter max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-boss-title"
            onSubmit={submit}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="create-boss-title" className="text-xl font-black">创建老板账号</h3>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">创建后再从编辑弹窗绑定可管理的家庭。</p>
              </div>
              <button type="button" className="icon-button shrink-0" aria-label="关闭创建老板弹窗" disabled={busy} onClick={close}><X size={20} /></button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label><span className="label">登录名</span><input className="field" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={50} autoComplete="username" autoFocus required /></label>
              <label><span className="label">显示名称</span><input className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} placeholder="例如：爸爸" required /></label>
              <label className="sm:col-span-2"><span className="label">初始密码（至少 8 位）</span><input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={200} autoComplete="new-password" required /></label>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" className="secondary-button" disabled={busy} onClick={close}>取消</button>
              <button className="primary-button" disabled={busy || username.trim().length < 3 || !displayName.trim() || password.length < 8}>确认创建</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function BossCard({
  boss,
  families,
  busy,
  mutate,
}: {
  boss: SystemBoss;
  families: SystemFamily[];
  busy: boolean;
  mutate: Mutate;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(boss.username);
  const [displayName, setDisplayName] = useState(boss.displayName);
  const [password, setPassword] = useState("");
  const membershipIds = new Set(boss.families.map((family) => family.familyId));

  useEffect(() => {
    setUsername(boss.username);
    setDisplayName(boss.displayName);
  }, [boss.username, boss.displayName]);

  function openEditor() {
    setUsername(boss.username);
    setDisplayName(boss.displayName);
    setPassword("");
    setOpen(true);
  }

  function closeEditor() {
    if (busy) return;
    setUsername(boss.username);
    setDisplayName(boss.displayName);
    setPassword("");
    setOpen(false);
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    await mutate({ action: "update_boss", bossId: boss.id, username, displayName }, "老板资料已更新");
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "update_boss", bossId: boss.id, password }, "老板密码已重置，旧授权已失效");
    if (ok) setPassword("");
  }

  const familySummary = boss.families.length > 0
    ? boss.families.map((family) => {
      const alias = family.displayNameOverride ? `：${family.displayName}` : "";
      return `${family.familyName}${alias}${family.familyStatus === "inactive" ? "（已停用）" : ""}`;
    }).join("、")
    : "未绑定家庭";

  return (
    <>
      <article className={`app-card px-4 py-3 ${boss.isActive ? "" : "opacity-70"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-black sm:text-lg">{boss.displayName}</h3>
              <span className={`pill ${boss.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{boss.isActive ? "使用中" : "已停用"}</span>
            </div>
            <p className="mt-1 truncate text-xs font-bold text-slate-500">{boss.username} · {familySummary}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="secondary-button shrink-0 !min-h-10 !px-3 text-sm" aria-haspopup="dialog" onClick={openEditor}><Pencil className="mr-1 inline" size={16} />编辑</button>
            <button
              type="button"
              className={`${boss.isActive ? "danger-button" : "success-button"} shrink-0 !min-h-10 !px-3 text-sm`}
              disabled={busy}
              onClick={() => void mutate({ action: "update_boss", bossId: boss.id, isActive: !boss.isActive }, boss.isActive ? "老板账号已停用" : "老板账号已启用")}
            >{boss.isActive ? "停用" : "启用"}</button>
          </div>
        </div>
      </article>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-2 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}
        >
          <section
            className="page-enter max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`edit-boss-${boss.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id={`edit-boss-${boss.id}`} className="text-xl font-black">编辑老板账号</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">{boss.displayName} · {boss.isActive ? "使用中" : "已停用"}</p>
              </div>
              <button type="button" className="icon-button shrink-0" aria-label="关闭编辑老板弹窗" disabled={busy} onClick={closeEditor}><X size={20} /></button>
            </div>

            <form className="mt-4" onSubmit={saveAccount}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className="label">登录名</span><input className="field" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={50} autoComplete="username" required /></label>
                <label><span className="label">显示名称</span><input className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} required /></label>
              </div>
              <button
                className="primary-button mt-3 w-full"
                disabled={busy || username.trim().length < 3 || !displayName.trim() || (username.trim() === boss.username && displayName.trim() === boss.displayName)}
              >保存账号资料</button>
            </form>

            <div className="mt-5 rounded-2xl bg-slate-50 p-3">
              <p className="font-black">可管理的家庭</p>
              {families.length === 0 ? (
                <p className="mt-2 text-sm font-semibold text-slate-500">请先创建家庭。</p>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {families.map((family) => {
                    const attached = membershipIds.has(family.id);
                    const membership = boss.families.find((item) => item.familyId === family.id);
                    return (
                      <label key={family.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white px-3 text-sm font-bold">
                        <input
                          type="checkbox"
                          checked={attached}
                          disabled={busy}
                          onChange={(event) => void mutate({ action: "set_boss_family", bossId: boss.id, familyId: family.id, attached: event.target.checked }, event.target.checked ? "家庭已绑定" : "家庭绑定已解除")}
                        />
                        <span>
                          {family.name}{membership?.displayNameOverride ? `（显示为 ${membership.displayName}）` : ""}
                          {family.status === "inactive" ? "（已停用）" : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <form className="mt-5" onSubmit={resetPassword}>
              <span className="label">重置密码</span>
              <div className="flex gap-2">
                <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={200} placeholder="输入至少 8 位新密码" autoComplete="new-password" />
                <button className="secondary-button shrink-0 !px-3" disabled={busy || password.length < 8}><KeyRound className="mr-1 inline" size={17} />重置</button>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">重置后，该老板已有登录授权会立即失效。</p>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
