"use client";

import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Copy,
  Gift,
  ImagePlus,
  LockKeyhole,
  PauseCircle,
  Plus,
  Power,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { RewardVisual } from "@/components/shared";
import type {
  AdminRewardDefinition,
  AdminState,
  AdminWorker,
  RewardDefinition,
  RewardItem,
  RewardKind,
} from "@/components/types";
import { formatDateTime, formatDuration, MINUTE } from "@/lib/time";

type Mutate = (body: Record<string, unknown>, success: string) => Promise<boolean>;

const kindLabels: Record<RewardKind, string> = {
  random_time: "随机时间券",
  fixed_time: "固定时间券",
  physical: "实物券",
};

const sourceLabels: Record<RewardItem["sourceType"], string> = {
  daily: "每日派发",
  task: "任务发放",
  admin_direct: "管理员直发",
  achievement: "成就奖励",
  adjustment: "补发纠错",
};

const statusLabels: Record<RewardItem["status"], string> = {
  available: "可使用",
  redeemed: "已使用",
  fulfilled: "已收到",
  cancelled: "已撤销",
  expired: "已过期",
};

const iconOptions = [
  ["gift", "礼物"],
  ["sparkles", "惊喜"],
  ["clock", "时钟"],
  ["book", "图书"],
  ["toy", "玩具"],
  ["food", "食品"],
  ["trip", "出行"],
] as const;

const themeOptions = [
  ["purple", "葡萄紫"],
  ["blue", "天空蓝"],
  ["green", "薄荷绿"],
  ["orange", "珊瑚橙"],
  ["pink", "莓果粉"],
] as const;

async function prepareRewardImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("原图不能超过 8MB。");
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
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备不支持图片处理。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      512,
      512,
    );
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function RewardSectionTitle({ title, text }: { title: string; text?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-xl font-black">{title}</h2>
      {text && <p className="mt-0.5 text-sm font-semibold text-slate-500">{text}</p>}
    </div>
  );
}

function definitionValue(definition: RewardDefinition) {
  if (definition.kind === "random_time") {
    return `${definition.randomMinSeconds! / MINUTE}～${definition.randomMaxSeconds! / MINUTE} 分钟 · 平均 ${(definition.randomMinSeconds! + definition.randomMaxSeconds!) / (2 * MINUTE)} 分钟`;
  }
  if (definition.kind === "fixed_time") return `${definition.fixedSeconds! / MINUTE} 分钟`;
  return definition.physicalDescription;
}

function definitionUsageText(definition: AdminRewardDefinition) {
  const parts = [
    definition.usage.taskBindingCount > 0 ? `${definition.usage.taskBindingCount} 个任务绑定` : null,
    definition.usage.assignmentSnapshotCount > 0 ? `${definition.usage.assignmentSnapshotCount} 条任务快照` : null,
    definition.usage.issuedRewardCount > 0 ? `${definition.usage.issuedRewardCount} 张已发奖励券` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "已有历史记录关联";
}

export function RewardSettingsPanel({
  state,
  mutate,
  busy,
}: {
  state: AdminState;
  mutate: Mutate;
  busy: boolean;
}) {
  const [showLibrary, setShowLibrary] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RewardDefinition | null>(null);
  const [returnToLibraryAfterForm, setReturnToLibraryAfterForm] = useState(false);
  const activeDefinitionCount = state.rewardDefinitions.filter((definition) => definition.isActive).length;
  const definitionCounts = {
    random_time: state.rewardDefinitions.filter((definition) => definition.kind === "random_time").length,
    fixed_time: state.rewardDefinitions.filter((definition) => definition.kind === "fixed_time").length,
    physical: state.rewardDefinitions.filter((definition) => definition.kind === "physical").length,
  };

  function openCreateForm(returnToLibrary = false) {
    setShowLibrary(false);
    setEditing(null);
    setReturnToLibraryAfterForm(returnToLibrary);
    setShowForm(true);
  }

  function openEditForm(definition: RewardDefinition) {
    setShowLibrary(false);
    setEditing(definition);
    setReturnToLibraryAfterForm(true);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    if (returnToLibraryAfterForm) setShowLibrary(true);
    setReturnToLibraryAfterForm(false);
  }

  return (
    <div className="space-y-6">
      <section className={`app-card p-5 ${state.rewardSystemEnabled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {state.rewardSystemEnabled ? <Power className="text-emerald-600" size={22} /> : <PauseCircle className="text-amber-600" size={22} />}
              <h2 className="text-lg font-black">奖励系统{state.rewardSystemEnabled ? "已启用" : "已暂停"}</h2>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {state.rewardSystemEnabled
                ? "每日派发、管理员直发和打工人使用均正常开放。"
                : "暂停期间不会新发券，也不能使用；已有奖励券和历史记录会完整保留。"}
            </p>
          </div>
          <button
            className={state.rewardSystemEnabled ? "danger-button shrink-0 !px-3" : "success-button shrink-0 !px-3"}
            disabled={busy}
            onClick={() => void mutate(
              { action: "set_reward_system_enabled", enabled: !state.rewardSystemEnabled },
              state.rewardSystemEnabled ? "奖励系统已暂停" : "奖励系统已启用",
            )}
          >{state.rewardSystemEnabled ? "暂停" : "启用"}</button>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-3">
          <RewardSectionTitle title="奖励券模板" text="修改模板只影响以后发放的券，已发券使用自己的快照" />
          <button type="button" className="primary-button mb-3 shrink-0 !min-h-11 !px-3" aria-label="创建奖励券模板" onClick={() => openCreateForm()}><Plus size={19} /></button>
        </div>
        <button
          type="button"
          className="app-card flex w-full items-center gap-3 p-4 text-left transition hover:border-purple-200 hover:bg-purple-50/40"
          onClick={() => setShowLibrary(true)}
        >
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-purple-100 text-purple-700">
            <Gift size={25} strokeWidth={2.7} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="font-black">{state.rewardDefinitions.length > 0 ? `${state.rewardDefinitions.length} 个模板` : "还没有模板"}</p>
              {state.rewardDefinitions.length > 0 && <span className="pill bg-emerald-100 text-emerald-700">启用 {activeDefinitionCount}</span>}
            </div>
            {state.rewardDefinitions.length > 0 ? (
              <p className="mt-1 truncate text-xs font-bold text-slate-500">
                随机 {definitionCounts.random_time} · 固定 {definitionCounts.fixed_time} · 实物 {definitionCounts.physical}
              </p>
            ) : (
              <p className="mt-1 text-xs font-bold text-slate-500">创建后可在这里搜索和管理</p>
            )}
          </div>
          <span className="shrink-0 text-sm font-black text-purple-700">{state.rewardDefinitions.length > 0 ? "查看全部" : "打开模板库"}</span>
          <ChevronRight className="shrink-0 text-purple-500" size={19} />
        </button>
      </section>

      {showLibrary && (
        <RewardTemplateLibraryDialog
          definitions={state.rewardDefinitions}
          mutate={mutate}
          busy={busy}
          onCreate={() => openCreateForm(true)}
          onEdit={openEditForm}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {showForm && (
        <RewardDefinitionDialog
          definition={editing}
          busy={busy}
          mutate={mutate}
          onClose={closeForm}
        />
      )}
    </div>
  );
}

function RewardTemplateLibraryDialog({
  definitions,
  mutate,
  busy,
  onCreate,
  onEdit,
  onClose,
}: {
  definitions: AdminRewardDefinition[];
  mutate: Mutate;
  busy: boolean;
  onCreate: () => void;
  onEdit: (definition: RewardDefinition) => void;
  onClose: () => void;
}) {
  const [kindFilter, setKindFilter] = useState<"all" | RewardKind>("all");
  const [query, setQuery] = useState("");
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const selectedDefinition = selectedDefinitionId
    ? definitions.find((definition) => definition.id === selectedDefinitionId) || null
    : null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = definitions
    .filter((definition) => kindFilter === "all" || definition.kind === kindFilter)
    .filter((definition) => {
      if (!normalizedQuery) return true;
      return [
        definition.name,
        definition.description,
        definitionValue(definition),
        definition.physicalDescription,
        definition.fulfillmentInstructions,
      ].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => Number(right.isActive) - Number(left.isActive) || right.updatedAt - left.updatedAt);
  const filterOptions = ([
    ["all", "全部", definitions.length],
    ["random_time", "随机", definitions.filter((definition) => definition.kind === "random_time").length],
    ["fixed_time", "固定", definitions.filter((definition) => definition.kind === "fixed_time").length],
    ["physical", "实物", definitions.filter((definition) => definition.kind === "physical").length],
  ] as const);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (selectedDefinitionId) setSelectedDefinitionId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, selectedDefinitionId]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-0 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="page-enter flex h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-slate-50 shadow-2xl sm:h-[86vh] sm:max-h-[760px] sm:rounded-[28px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-template-library-title"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-purple-100 bg-white p-4 sm:p-5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-purple-100 text-purple-700">
            <Gift size={23} strokeWidth={2.7} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="reward-template-library-title" className="text-xl font-black">奖励券模板</h2>
            <p className="mt-0.5 text-xs font-bold text-slate-500">{definitions.length} 个模板 · {definitions.filter((definition) => definition.isActive).length} 个启用</p>
          </div>
          <button type="button" className="primary-button grid h-10 w-10 shrink-0 place-items-center !min-h-10 !rounded-xl !p-0 leading-none" aria-label="创建奖励券模板" disabled={busy} onClick={onCreate}><Plus size={21} strokeWidth={2.6} /></button>
          <button type="button" className="secondary-button grid h-10 w-10 shrink-0 place-items-center !min-h-10 !rounded-xl !p-0 leading-none" aria-label="关闭模板库" disabled={busy} onClick={onClose}><X size={20} strokeWidth={2.6} /></button>
        </header>

        {selectedDefinition ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <button type="button" className="mb-3 flex min-h-10 items-center gap-1 rounded-xl px-2 text-sm font-black text-purple-700 hover:bg-purple-100" onClick={() => setSelectedDefinitionId(null)}>
              <ArrowLeft size={18} />返回模板列表
            </button>
            <RewardDefinitionDetail
              definition={selectedDefinition}
              mutate={mutate}
              busy={busy}
              onEdit={() => onEdit(selectedDefinition)}
            />
          </div>
        ) : (
          <>
            <div className="shrink-0 bg-white px-4 pb-3 pt-3 sm:px-5">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  className="field !min-h-11 !pl-10"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、说明或奖励内容"
                  aria-label="搜索奖励券模板"
                />
              </label>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {filterOptions.map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-black ${kindFilter === value ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-600"}`}
                    aria-pressed={kindFilter === value}
                    onClick={() => setKindFilter(value)}
                  >
                    {label} {count}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-0 sm:p-4 sm:pt-0">
              {filtered.length === 0 ? (
                <div className="rounded-3xl bg-white px-5 py-10 text-center shadow-sm">
                  <Search className="mx-auto text-slate-300" size={32} />
                  <p className="mt-3 font-black text-slate-700">没有找到模板</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">换个关键词或类型试试。</p>
                  {(query || kindFilter !== "all") && (
                    <button type="button" className="secondary-button mt-4 !min-h-10 text-sm" onClick={() => { setQuery(""); setKindFilter("all"); }}>清除筛选</button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-purple-50 overflow-hidden rounded-3xl border border-purple-100 bg-white shadow-sm">
                  {filtered.map((definition) => (
                    <button
                      key={definition.id}
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-purple-50 sm:px-4"
                      onClick={() => setSelectedDefinitionId(definition.id)}
                    >
                      <RewardVisual icon={definition.icon} imageUrl={definition.imageUrl} theme={definition.theme} size={46} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="truncate text-sm font-black">{definition.name}</h3>
                          {!definition.isActive && <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">停用</span>}
                        </div>
                        <p className="mt-0.5 truncate text-xs font-bold text-purple-700">{definitionValue(definition)}</p>
                        <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{kindLabels[definition.kind]} · 版本 {definition.version}</p>
                      </div>
                      <ChevronRight className="shrink-0 text-slate-400" size={19} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function RewardDefinitionDetail({
  definition,
  mutate,
  busy,
  onEdit,
}: {
  definition: AdminRewardDefinition;
  mutate: Mutate;
  busy: boolean;
  onEdit: () => void;
}) {
  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imageDataUrl = await prepareRewardImage(file);
      await mutate(
        { action: "upload_reward_definition_image", definitionId: definition.id, imageDataUrl },
        "实物券图片已更新",
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "图片处理失败");
    } finally {
      input.value = "";
    }
  }

  return (
    <article className="rounded-3xl border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-4">
        <RewardVisual icon={definition.icon} imageUrl={definition.imageUrl} theme={definition.theme} size={68} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black">{definition.name}</h3>
            <span className="pill bg-purple-100 text-purple-700">{kindLabels[definition.kind]}</span>
            {!definition.isActive && <span className="pill bg-slate-100 text-slate-500">已停用</span>}
          </div>
          <p className="mt-1 text-sm font-black text-purple-700">{definitionValue(definition)}</p>
          <p className="mt-1 text-xs font-bold text-slate-500">版本 {definition.version} · 有效期：永久</p>
        </div>
      </div>
      <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
        <p className="text-xs font-black text-slate-500">公共说明</p>
        <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{definition.description || "未填写公共说明"}</p>
      </div>
      {definition.kind === "physical" && (
        <div className="mt-3 space-y-2 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900">
          <p><strong>实物说明：</strong>{definition.physicalDescription}</p>
          <p><strong>交付说明：</strong>{definition.fulfillmentInstructions}</p>
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button className="secondary-button !min-h-11 !px-2 text-sm" disabled={busy} onClick={onEdit}>编辑</button>
        <button className="secondary-button !min-h-11 !px-2 text-sm" disabled={busy} onClick={() => void mutate({ action: "copy_reward_definition", definitionId: definition.id }, "模板副本已创建")}><Copy className="mr-1 inline" size={16} />复制</button>
        <button
          className={`${definition.isActive ? "danger-button" : "success-button"} !min-h-11 !px-2 text-sm`}
          disabled={busy}
          onClick={() => void mutate(
            { action: "set_reward_definition_active", definitionId: definition.id, active: !definition.isActive },
            definition.isActive ? "模板已停用" : "模板已启用",
          )}
        >{definition.isActive ? "停用" : "启用"}</button>
      </div>
      {definition.kind === "physical" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className={`secondary-button cursor-pointer text-center ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <ImagePlus className="mr-1 inline" size={17} />{definition.imageUrl ? "更换图片" : "上传图片"}
            <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => void uploadImage(event)} />
          </label>
          <button
            className="secondary-button"
            disabled={busy || !definition.imageUrl}
            onClick={() => {
              if (window.confirm("确定删除自定义图片并恢复默认图标吗？已发券仍保留原图片快照。")) {
                void mutate({ action: "remove_reward_definition_image", definitionId: definition.id }, "已恢复默认图标");
              }
            }}
          >恢复图标</button>
        </div>
      )}
      {definition.canDelete ? (
        <div className="mt-4 border-t border-red-100 pt-4">
          <p className="mb-2 text-xs font-bold leading-5 text-slate-500">当前没有任务绑定、任务快照或已发券记录，可以安全删除。</p>
          <button
            type="button"
            className="danger-button w-full"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`确定永久删除“${definition.name}”吗？此操作无法恢复。`)) {
                void mutate(
                  { action: "delete_reward_definition", definitionId: definition.id },
                  `未使用模板“${definition.name}”已删除`,
                );
              }
            }}
          >
            <Trash2 className="mr-1 inline" size={17} />永久删除未使用模板
          </button>
        </div>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs font-bold leading-5 text-slate-600">
          <LockKeyhole className="mt-0.5 shrink-0" size={16} />
          <span>{definitionUsageText(definition)}，为保留历史记录，该模板只能停用，不能删除。</span>
        </p>
      )}
    </article>
  );
}

function RewardDefinitionDialog({
  definition,
  mutate,
  busy,
  onClose,
}: {
  definition: RewardDefinition | null;
  mutate: Mutate;
  busy: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(definition?.name || "");
  const [description, setDescription] = useState(definition?.description || "");
  const [kind, setKind] = useState<RewardKind>(definition?.kind || "random_time");
  const [icon, setIcon] = useState(definition?.icon || "sparkles");
  const [theme, setTheme] = useState(definition?.theme || "purple");
  const [minimumMinutes, setMinimumMinutes] = useState(String((definition?.randomMinSeconds || 5 * MINUTE) / MINUTE));
  const [maximumMinutes, setMaximumMinutes] = useState(String((definition?.randomMaxSeconds || 15 * MINUTE) / MINUTE));
  const [fixedMinutes, setFixedMinutes] = useState(String((definition?.fixedSeconds || 30 * MINUTE) / MINUTE));
  const [physicalDescription, setPhysicalDescription] = useState(definition?.physicalDescription || "");
  const [fulfillmentInstructions, setFulfillmentInstructions] = useState(definition?.fulfillmentInstructions || "");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const minimum = Number(minimumMinutes);
    const maximum = Number(maximumMinutes);
    const fixed = Number(fixedMinutes);
    if (kind === "random_time" && (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 1 || maximum > 1440 || minimum > maximum)) {
      setFormError("随机范围必须是 1～1440 的整数分钟，且最小值不能大于最大值。");
      return;
    }
    if (kind === "fixed_time" && (!Number.isInteger(fixed) || fixed < 1 || fixed > 1440)) {
      setFormError("固定时长必须是 1～1440 的整数分钟。");
      return;
    }
    if (kind === "physical" && (!physicalDescription.trim() || !fulfillmentInstructions.trim())) {
      setFormError("实物券需要填写实物说明和交付说明。");
      return;
    }
    setFormError("");
    const ok = await mutate({
      action: definition ? "update_reward_definition" : "create_reward_definition",
      ...(definition ? { definitionId: definition.id } : {}),
      name,
      description,
      kind,
      icon,
      theme,
      randomMinSeconds: kind === "random_time" ? minimum * MINUTE : null,
      randomMaxSeconds: kind === "random_time" ? maximum * MINUTE : null,
      fixedSeconds: kind === "fixed_time" ? fixed * MINUTE : null,
      physicalDescription: kind === "physical" ? physicalDescription : null,
      fulfillmentInstructions: kind === "physical" ? fulfillmentInstructions : null,
    }, definition ? "模板已更新，新设置只影响以后发放" : "奖励券模板已创建");
    if (ok) onClose();
  }

  const minimum = Number(minimumMinutes);
  const maximum = Number(maximumMinutes);
  const average = Number.isFinite(minimum) && Number.isFinite(maximum) ? (minimum + maximum) / 2 : 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="page-enter max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="reward-definition-title" onSubmit={submit}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="reward-definition-title" className="text-xl font-black">{definition ? "编辑奖励券模板" : "创建奖励券模板"}</h2><p className="mt-1 text-sm font-semibold text-slate-500">第一阶段所有奖励券永久有效</p></div>
          <button type="button" className="secondary-button !min-h-10 !px-3" disabled={busy} onClick={onClose}><XCircle size={18} /></button>
        </div>

        <label className="mt-4 block"><span className="label">模板名称</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} placeholder="例如：周末惊喜券" /></label>
        <label className="mt-3 block"><span className="label">公共说明</span><textarea className="field min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={600} placeholder="打工人能看到的简短说明" /></label>
        <label className="mt-3 block"><span className="label">奖励类型</span><select className="field" value={kind} onChange={(event) => setKind(event.target.value as RewardKind)}><option value="random_time">随机时间券</option><option value="fixed_time">固定时间券</option><option value="physical">实物券</option></select></label>

        {kind === "random_time" && (
          <div className="mt-3 rounded-2xl bg-purple-50 p-3">
            <div className="grid grid-cols-2 gap-2"><label><span className="label">最小分钟</span><input className="field" type="number" inputMode="numeric" min={1} max={1440} step={1} value={minimumMinutes} onChange={(event) => setMinimumMinutes(event.target.value)} /></label><label><span className="label">最大分钟</span><input className="field" type="number" inputMode="numeric" min={1} max={1440} step={1} value={maximumMinutes} onChange={(event) => setMaximumMinutes(event.target.value)} /></label></div>
            <p className="mt-2 text-sm font-black text-purple-800">单张平均 {average} 分钟</p>
            {minimum === maximum && <p className="mt-1 text-xs font-bold text-amber-700">最小值和最大值相同，建议改用固定时间券。</p>}
          </div>
        )}
        {kind === "fixed_time" && <label className="mt-3 block"><span className="label">固定时长（分钟）</span><input className="field" type="number" inputMode="numeric" min={1} max={1440} step={1} value={fixedMinutes} onChange={(event) => setFixedMinutes(event.target.value)} /></label>}
        {kind === "physical" && (
          <div className="mt-3 space-y-3 rounded-2xl bg-blue-50 p-3">
            <label><span className="label">实物名称与说明</span><textarea className="field min-h-20" value={physicalDescription} onChange={(event) => setPhysicalDescription(event.target.value)} maxLength={600} placeholder="例如：一本 30 元以内的新图书" /></label>
            <label><span className="label">交付说明</span><textarea className="field min-h-20" value={fulfillmentInstructions} onChange={(event) => setFulfillmentInstructions(event.target.value)} maxLength={600} placeholder="例如：周末一起去书店购买" /></label>
            <p className="text-xs font-semibold text-blue-800">模板创建后可在卡片上上传 512×512 自定义图片；图片失败时始终回退到默认图标。</p>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label><span className="label">默认图标</span><select className="field" value={icon} onChange={(event) => setIcon(event.target.value)}>{iconOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span className="label">主题色</span><select className="field" value={theme} onChange={(event) => setTheme(event.target.value)}>{themeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800">有效期：永久</div>
        {formError && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{formError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !name.trim()}>{busy ? "正在保存…" : definition ? "保存修改" : "创建模板"}</button></div>
      </form>
    </div>
  );
}

function rewardStatusClass(status: RewardItem["status"]) {
  if (status === "available") return "bg-blue-100 text-blue-700";
  if (status === "cancelled" || status === "expired") return "bg-slate-100 text-slate-500";
  return "bg-emerald-100 text-emerald-700";
}

function rewardValueText(item: RewardItem) {
  if (item.resultSeconds) return `实际入账 ${formatDuration(item.resultSeconds, false)}`;
  if (item.kind === "random_time") {
    return `${formatDuration(item.randomMinSeconds || 0, false)}～${formatDuration(item.randomMaxSeconds || 0, false)}`;
  }
  if (item.kind === "fixed_time") return formatDuration(item.fixedSeconds || 0, false);
  return item.physicalDescription || "实物奖励";
}

function rewardEventAt(item: RewardItem) {
  return item.usedAt || item.fulfilledAt || item.cancelledAt || item.redeemedAt || item.grantedAt;
}

export function AdminRewardHistoryPanel({ state, mutate, busy }: { state: AdminState; mutate: Mutate; busy: boolean }) {
  const [workerFilter, setWorkerFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<"all" | RewardKind>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | RewardItem["sourceType"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RewardItem["status"]>("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItem = selectedItemId ? state.rewardItems.find((item) => item.id === selectedItemId) || null : null;
  const rows = useMemo(() => state.rewardItems
    .filter((item) =>
      (workerFilter === "all" || item.workerId === workerFilter)
      && (kindFilter === "all" || item.kind === kindFilter)
      && (sourceFilter === "all" || item.sourceType === sourceFilter)
      && (statusFilter === "all" || item.status === statusFilter))
    .sort((left, right) => rewardEventAt(right) - rewardEventAt(left))
    .slice(0, 100), [state.rewardItems, workerFilter, kindFilter, sourceFilter, statusFilter]);

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">奖励历史</h2>
          <p className="mt-0.5 text-sm font-semibold text-slate-500">点开查看发放、使用与撤销详情</p>
        </div>
        <span className="shrink-0 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-black text-purple-700">{rows.length} 条</span>
      </div>
      <div className="app-card overflow-hidden">
        <div className="grid grid-cols-2 gap-2 border-b border-purple-100 p-3 sm:grid-cols-4">
          <select aria-label="按打工人筛选奖励历史" className="field !min-h-10 !py-2 text-sm" value={workerFilter} onChange={(event) => setWorkerFilter(event.target.value)}><option value="all">全部打工人</option>{state.workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select>
          <select aria-label="按类型筛选奖励历史" className="field !min-h-10 !py-2 text-sm" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">全部类型</option><option value="random_time">随机券</option><option value="fixed_time">固定券</option><option value="physical">实物券</option></select>
          <select aria-label="按来源筛选奖励历史" className="field !min-h-10 !py-2 text-sm" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}><option value="all">全部来源</option><option value="daily">每日派发</option><option value="task">任务发放</option><option value="admin_direct">管理员直发</option><option value="achievement">成就奖励</option><option value="adjustment">补发纠错</option></select>
          <select aria-label="按状态筛选奖励历史" className="field !min-h-10 !py-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">全部状态</option><option value="available">可使用</option><option value="redeemed">已使用</option><option value="fulfilled">已收到</option><option value="cancelled">已撤销</option><option value="expired">已过期</option></select>
        </div>
        <div className="divide-y divide-purple-50">
          {rows.length === 0 ? <p className="p-4 text-center text-sm font-bold text-slate-500">没有符合条件的记录</p> : rows.map((item) => (
            <button type="button" className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-purple-50" key={item.id} onClick={() => setSelectedItemId(item.id)}>
              <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5"><p className="truncate text-sm font-black">{item.workerName || "打工人"} · {item.name}</p><span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black ${rewardStatusClass(item.status)}`}>{statusLabels[item.status]}</span></div>
                <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{sourceLabels[item.sourceType]} · {formatDateTime(rewardEventAt(item))}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`max-w-28 truncate text-xs font-black ${item.resultSeconds ? "text-emerald-700" : "text-purple-700"}`}>{rewardValueText(item)}</p>
                <p className="mt-0.5 text-[10px] font-bold text-slate-400">查看详情</p>
              </div>
            </button>
          ))}
        </div>
      </div>
      {selectedItem && (
        <AdminRewardDetailDialog
          item={selectedItem}
          busy={busy}
          onClose={() => setSelectedItemId(null)}
          onCancel={async () => {
            const reason = window.prompt(`请输入撤销“${selectedItem.name}”的原因：`)?.trim();
            if (!reason) return;
            const ok = await mutate({ action: "cancel_reward_item", rewardItemId: selectedItem.id, reason }, "未使用奖励券已撤销");
            if (ok) setSelectedItemId(null);
          }}
        />
      )}
    </section>
  );
}

function AdminRewardDetailDialog({
  item,
  busy,
  onClose,
  onCancel,
}: {
  item: RewardItem;
  busy: boolean;
  onClose: () => void;
  onCancel: () => Promise<void>;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-2 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="page-enter max-h-[88vh] w-full max-w-md overflow-y-auto rounded-[24px] bg-white p-4 shadow-2xl sm:p-5" role="dialog" aria-modal="true" aria-labelledby="admin-reward-detail-title">
        <div className="flex items-start gap-3">
          <RewardVisual icon={item.icon} imageUrl={item.imageUrl} theme={item.theme} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 id="admin-reward-detail-title" className="text-xl font-black">{item.name}</h2>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${rewardStatusClass(item.status)}`}>{statusLabels[item.status]}</span>
            </div>
            <p className="mt-0.5 text-sm font-black text-purple-700">{item.workerName || "打工人"}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">{kindLabels[item.kind]} · 永久有效</p>
          </div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="关闭奖励历史详情" disabled={busy} onClick={onClose}><XCircle size={19} /></button>
        </div>

        {item.description && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold leading-5 text-slate-600">{item.description}</p>}

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-purple-50 px-3 py-2"><p className="font-bold text-purple-500">奖励内容</p><p className="mt-0.5 font-black text-purple-900">{rewardValueText(item)}</p></div>
          <div className="rounded-xl bg-blue-50 px-3 py-2"><p className="font-bold text-blue-500">来源</p><p className="mt-0.5 font-black text-blue-900">{sourceLabels[item.sourceType]}</p></div>
          <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="font-bold text-slate-500">发放时间</p><p className="mt-0.5 font-black text-slate-800">{formatDateTime(item.grantedAt)}</p></div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2"><p className="font-bold text-emerald-600">当前状态</p><p className="mt-0.5 font-black text-emerald-800">{statusLabels[item.status]}</p></div>
        </div>

        <div className="mt-2 space-y-1 rounded-xl bg-purple-50 px-3 py-2 text-xs font-semibold leading-5 text-purple-900">
          <p><strong>发放原因：</strong>{item.grantReason || "未填写"}</p>
          {item.grantedBy && <p><strong>发放人：</strong>{item.grantedBy === "admin" ? "管理员" : item.grantedBy}</p>}
        </div>

        {item.kind === "physical" && (item.physicalDescription || item.fulfillmentInstructions) && (
          <div className="mt-2 space-y-1 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold leading-5 text-blue-900">
            {item.physicalDescription && <p><strong>实物内容：</strong>{item.physicalDescription}</p>}
            {item.fulfillmentInstructions && <p><strong>领取说明：</strong>{item.fulfillmentInstructions}</p>}
          </div>
        )}

        {(item.resultSeconds || item.redeemedAt || item.usedAt || item.fulfilledAt || item.cancelledAt || item.cancellationReason) && (
          <div className="mt-2 space-y-1 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-900">
            {item.resultSeconds && <p><strong>实际入账：</strong>{formatDuration(item.resultSeconds, false)}</p>}
            {(item.usedAt || item.redeemedAt) && <p><strong>使用时间：</strong>{formatDateTime(item.usedAt || item.redeemedAt!)}</p>}
            {item.fulfilledAt && <p><strong>确认收到：</strong>{formatDateTime(item.fulfilledAt)}</p>}
            {item.cancelledAt && <p><strong>撤销时间：</strong>{formatDateTime(item.cancelledAt)}</p>}
            {item.cancellationReason && <p><strong>撤销原因：</strong>{item.cancellationReason}</p>}
          </div>
        )}

        {item.status === "available" && <button type="button" className="danger-button mt-4 w-full" disabled={busy} onClick={() => void onCancel()}><XCircle className="mr-1 inline" size={18} />撤销这张奖励券</button>}
      </section>
    </div>
  );
}

export function DirectRewardDialog({
  state,
  initialWorkerId,
  mutate,
  busy,
  onClose,
}: {
  state: AdminState;
  initialWorkerId: string;
  mutate: Mutate;
  busy: boolean;
  onClose: () => void;
}) {
  const activeWorkers = state.workers.filter((worker) => worker.isActive);
  const activeDefinitions = state.rewardDefinitions.filter((definition) => definition.isActive);
  const [workerId, setWorkerId] = useState(initialWorkerId || activeWorkers[0]?.id || "");
  const [definitionId, setDefinitionId] = useState(activeDefinitions[0]?.id || "");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const selectedWorker = activeWorkers.find((worker) => worker.id === workerId);
  const selectedDefinition = activeDefinitions.find((definition) => definition.id === definitionId);
  const quantityNumber = Number(quantity);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedWorker || !selectedDefinition || !Number.isSafeInteger(quantityNumber) || quantityNumber < 1 || !reason.trim()) return;
    const ok = await mutate({
      action: "grant_reward_items",
      workerId,
      definitionId,
      quantity: quantityNumber,
      reason,
    }, `已给 ${selectedWorker.name} 发放 ${quantityNumber} 张${selectedDefinition.name}`);
    if (ok) onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="page-enter w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="direct-reward-title" onSubmit={submit}>
        <div className="flex items-start justify-between gap-3"><div><h2 id="direct-reward-title" className="text-xl font-black">直接发奖励券</h2><p className="mt-1 text-sm font-semibold text-slate-500">不创建虚假任务，发放原因会永久留痕</p></div><button type="button" className="secondary-button !min-h-10 !px-3" disabled={busy} onClick={onClose}><XCircle size={18} /></button></div>
        {!state.rewardSystemEnabled && <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">奖励系统已暂停，恢复后才能发放。</p>}
        <label className="mt-4 block"><span className="label">发给哪位打工人</span><select className="field" value={workerId} onChange={(event) => setWorkerId(event.target.value)}><option value="">请选择一个打工人</option>{activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
        <label className="mt-3 block"><span className="label">奖励券模板</span><select className="field" value={definitionId} onChange={(event) => setDefinitionId(event.target.value)}><option value="">请选择已启用模板</option>{activeDefinitions.map((definition) => <option key={definition.id} value={definition.id}>{definition.name}（{kindLabels[definition.kind]}）</option>)}</select></label>
        {selectedDefinition && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-purple-50 p-3"><RewardVisual icon={selectedDefinition.icon} imageUrl={selectedDefinition.imageUrl} theme={selectedDefinition.theme} size={52} /><div><p className="font-black">{selectedDefinition.name}</p><p className="mt-1 text-xs font-bold text-purple-700">{definitionValue(selectedDefinition)} · 永久</p></div></div>
        )}
        <label className="mt-3 block"><span className="label">发放张数</span><input className="field" type="number" inputMode="numeric" min={1} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
        <label className="mt-3 block"><span className="label">发放原因</span><textarea className="field min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required placeholder="例如：主动帮忙整理客厅" /></label>
        {selectedWorker && selectedDefinition && Number.isSafeInteger(quantityNumber) && quantityNumber > 0 && (
          <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black leading-6 text-emerald-800">确认后将给 {selectedWorker.name} 发放 {quantityNumber} 张“{selectedDefinition.name}”。</p>
        )}
        {activeDefinitions.length === 0 && <p className="mt-3 text-sm font-bold text-amber-700">请先在奖励设置中创建并启用模板。</p>}
        <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !state.rewardSystemEnabled || !selectedWorker || !selectedDefinition || !Number.isSafeInteger(quantityNumber) || quantityNumber < 1 || !reason.trim()}><Gift className="mr-1 inline" size={18} />确认发放</button></div>
      </form>
    </div>
  );
}

export function DailyCouponControls({
  worker,
  mutate,
  busy,
}: {
  worker: AdminWorker;
  mutate: Mutate;
  busy: boolean;
}) {
  const [enabled, setEnabled] = useState(worker.dailyCouponSetting.isEnabled);
  const [quantity, setQuantity] = useState(String(worker.dailyCouponSetting.dailyQuantity || 1));
  const [minimumMinutes, setMinimumMinutes] = useState(String(worker.dailyCouponSetting.randomMinSeconds / MINUTE));
  const [maximumMinutes, setMaximumMinutes] = useState(String(worker.dailyCouponSetting.randomMaxSeconds / MINUTE));
  const quantityNumber = Number(quantity);
  const minimum = Number(minimumMinutes);
  const maximum = Number(maximumMinutes);
  const valid = (!enabled || Number.isSafeInteger(quantityNumber) && quantityNumber > 0)
    && Number.isInteger(minimum)
    && Number.isInteger(maximum)
    && minimum >= 1
    && maximum <= 1_440
    && minimum <= maximum;
  const average = valid ? (minimum + maximum) / 2 : 0;
  const dailyExpected = enabled && valid ? quantityNumber * average : 0;

  return (
    <div className="rounded-2xl bg-emerald-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-black text-emerald-900"><Sparkles className="mr-1 inline" size={17} />每日免费派券</p><p className="mt-1 text-xs font-semibold leading-5 text-emerald-800">按 {worker.timezone} 的自然日，当天只处理一次</p></div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-white px-3 text-sm font-black text-emerald-800 shadow-sm"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => { setEnabled(event.target.checked); if (event.target.checked && quantityNumber < 1) setQuantity("1"); }} />{enabled ? "已开启" : "已关闭"}</label>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <label><span className="label">每天张数</span><input className="field !min-h-11" type="number" inputMode="numeric" min={1} step={1} value={quantity} disabled={!enabled || busy} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label><span className="label">最小分钟</span><input className="field !min-h-11" type="number" inputMode="numeric" min={1} max={1440} step={1} value={minimumMinutes} disabled={busy} onChange={(event) => setMinimumMinutes(event.target.value)} /></label>
        <label><span className="label">最大分钟</span><input className="field !min-h-11" type="number" inputMode="numeric" min={1} max={1440} step={1} value={maximumMinutes} disabled={busy} onChange={(event) => setMaximumMinutes(event.target.value)} /></label>
      </div>
      {valid && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
          <div className="rounded-xl bg-white p-2"><p className="text-slate-500">单张平均</p><p className="mt-1 font-black text-emerald-800">{average} 分钟</p></div>
          <div className="rounded-xl bg-white p-2"><p className="text-slate-500">每日预计</p><p className="mt-1 font-black text-emerald-800">{dailyExpected} 分钟</p></div>
          <div className="rounded-xl bg-white p-2"><p className="text-slate-500">每周预计</p><p className="mt-1 font-black text-emerald-800">{dailyExpected * 7} 分钟</p></div>
        </div>
      )}
      {worker.todayDailyCouponGrant && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
          今天已按 {worker.todayDailyCouponGrant.enabledSnapshot ? `${worker.todayDailyCouponGrant.quantitySnapshot} 张、${worker.todayDailyCouponGrant.randomMinSeconds / MINUTE}～${worker.todayDailyCouponGrant.randomMaxSeconds / MINUTE} 分钟` : "关闭"} 的设置处理；本次修改明天生效。
        </p>
      )}
      {!valid && <p className="mt-2 text-xs font-black text-red-700">请填写有效的整数张数和 1～1440 分钟范围。</p>}
      <button
        className="success-button mt-3 w-full"
        disabled={busy || !valid}
        onClick={() => void mutate({
          action: "update_daily_coupon_setting",
          workerId: worker.id,
          isEnabled: enabled,
          dailyQuantity: enabled ? quantityNumber : 0,
          randomMinSeconds: minimum * MINUTE,
          randomMaxSeconds: maximum * MINUTE,
        }, enabled ? "每日派券设置已保存，新设置按规则生效" : "每日派券已关闭")}
      ><CheckCircle2 className="mr-1 inline" size={17} />保存每日派券设置</button>
    </div>
  );
}
