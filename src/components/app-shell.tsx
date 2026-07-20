"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminApp } from "@/components/admin-app";
import { api, ApiError } from "@/components/api";
import { LoginScreen } from "@/components/login-screen";
import { LoadingScreen } from "@/components/shared";
import type { BootstrapState, Identity } from "@/components/types";
import { WorkerApp } from "@/components/worker-app";

export function AppShell() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [fatalError, setFatalError] = useState("");

  const loadBootstrap = useCallback(async (keepChooser = false) => {
    try {
      const data = await api<BootstrapState>("/api/bootstrap");
      setBootstrap(data);
      if (!keepChooser) {
        setIdentity(data.activeIdentity);
        setChoosing(false);
      }
      setFatalError("");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "应用启动失败，请检查配置。");
    }
  }, []);

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

  if (fatalError) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="app-card max-w-lg p-7 text-center">
          <h1 className="text-xl font-black text-red-600">应用还没有准备好</h1>
          <p className="mt-3 font-semibold leading-7 text-slate-600">{fatalError}</p>
          <button className="primary-button mt-5" onClick={() => loadBootstrap()}>重新检查</button>
        </div>
      </main>
    );
  }

  if (!bootstrap) return <LoadingScreen />;
  if (choosing || !identity) return <LoginScreen bootstrap={bootstrap} onEntered={entered} />;
  if (identity.type === "admin") {
    return <AdminApp onSwitch={chooseRole} onAuthorizationError={authorizationExpired} />;
  }
  return <WorkerApp onSwitch={chooseRole} onAuthorizationError={authorizationExpired} />;
}
