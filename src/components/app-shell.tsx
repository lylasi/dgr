"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminApp } from "@/components/admin-app";
import { api, ApiError } from "@/components/api";
import { LoginScreen } from "@/components/login-screen";
import { LoadingScreen } from "@/components/shared";
import { SystemAdminApp } from "@/components/system-admin-app";
import type { BootstrapState, Identity } from "@/components/types";
import { WorkerApp } from "@/components/worker-app";

export function AppShell({ entryCode }: { entryCode?: string }) {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [fatalError, setFatalError] = useState("");

  const loadBootstrap = useCallback(async (keepChooser = false) => {
    try {
      const query = entryCode ? `?entryCode=${encodeURIComponent(entryCode)}` : "";
      const data = await api<BootstrapState>(`/api/bootstrap${query}`);
      setBootstrap(data);
      if (!keepChooser) {
        setIdentity(data.activeIdentity);
        setChoosing(false);
      }
      setFatalError("");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "应用启动失败，请检查配置。");
    }
  }, [entryCode]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  async function entered(next: Identity) {
    setIdentity(next);
    setChoosing(false);
    await loadBootstrap(false);
  }

  function chooseRole() {
    setChoosing(true);
    void loadBootstrap(true);
  }

  function authorizationExpired(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      setIdentity(null);
      setChoosing(true);
      void loadBootstrap(true);
      return true;
    }
    return false;
  }

  async function switchIdentity(next: Identity) {
    const result = await api<{ activeIdentity: Identity }>("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "switch", identity: next }),
    });
    await entered(result.activeIdentity);
  }

  async function enterWorker(workerId: string) {
    if (identity?.type !== "boss") return;
    await switchIdentity({
      type: "boss_as_worker",
      bossId: identity.bossId,
      workerId,
      familyId: identity.familyId,
    });
  }

  async function returnToBoss() {
    if (identity?.type !== "boss_as_worker") return;
    await switchIdentity({
      type: "boss",
      bossId: identity.bossId,
      familyId: identity.familyId,
    });
  }

  async function switchBossFamily(familyId: string) {
    if (identity?.type !== "boss") return;
    const result = await api<{ activeIdentity: Identity }>("/api/auth", {
      method: "POST",
      body: JSON.stringify({
        action: "switch",
        identity: { type: "boss", bossId: identity.bossId, familyId },
      }),
    });
    if (entryCode) {
      window.location.assign("/");
      return;
    }
    await entered(result.activeIdentity);
  }

  if (fatalError) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="app-card max-w-lg p-7 text-center">
          <h1 className="text-xl font-black text-red-600">这个入口暂时无法打开</h1>
          <p className="mt-3 font-semibold leading-7 text-slate-600">{fatalError}</p>
          <button className="primary-button mt-5" onClick={() => void loadBootstrap()}>重新检查</button>
        </div>
      </main>
    );
  }

  if (!bootstrap) return <LoadingScreen />;
  if (choosing || !identity) {
    return <LoginScreen bootstrap={bootstrap} entryCode={entryCode} onEntered={entered} />;
  }
  if (identity.type === "system_admin") {
    return <SystemAdminApp onSwitch={chooseRole} onAuthorizationError={authorizationExpired} />;
  }
  if (identity.type === "boss") {
    return (
      <AdminApp
        onSwitch={chooseRole}
        onAuthorizationError={authorizationExpired}
        onEnterWorker={enterWorker}
        onSwitchFamily={switchBossFamily}
      />
    );
  }
  if (identity.type === "boss_as_worker") {
    const boss = bootstrap.bosses.find((candidate) => candidate.id === identity.bossId);
    const familyMembership = boss?.families.find((family) => family.familyId === identity.familyId);
    return (
      <WorkerApp
        onSwitch={chooseRole}
        onAuthorizationError={authorizationExpired}
        actingBoss={{
          displayName: familyMembership?.displayName || boss?.displayName || "老板",
          familyName: bootstrap.family.name,
        }}
        onReturnToBoss={returnToBoss}
      />
    );
  }
  return <WorkerApp onSwitch={chooseRole} onAuthorizationError={authorizationExpired} />;
}
