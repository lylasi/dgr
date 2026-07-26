import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { familyEntryPathFromInput, LoginScreen } from "@/components/login-screen";
import { FamilyEntryQr } from "@/components/family-entry-qr";
import type { BootstrapState, SystemBoss, SystemFamily } from "@/components/types";
import {
  bossMatchesQuery,
  BossCard,
  BossManagement,
  CreateBoss,
  CreateFamily,
  FamilyCard,
  PublicFamilyDirectorySetting,
  SystemOverview,
} from "@/components/system-admin-app";
import { BossActingBanner } from "@/components/worker-app";

const bootstrap: BootstrapState = {
  family: { id: "family-a", name: "星星家庭", timezone: "Asia/Shanghai" },
  publicFamilyDirectoryEnabled: false,
  publicFamilies: [],
  workers: [{
    id: "worker-a",
    familyId: "family-a",
    name: "小星",
    avatar: "star",
    theme: "purple",
    avatarUrl: null,
    authorized: false,
  }],
  bosses: [{
    id: "boss-a",
    username: "parent.a",
    displayName: "家长默认名称",
    authVersion: 1,
    families: [{
      familyId: "family-a",
      familyName: "星星家庭",
      familyStatus: "active",
      familyTimezone: "Asia/Shanghai",
      displayName: "星星爸爸",
      displayNameOverride: "星星爸爸",
    }],
  }],
  systemAdminAuthorized: false,
  adminAuthorized: false,
  activeIdentity: { type: "boss", bossId: "boss-a", familyId: "family-a" },
};

describe("多家庭角色界面", () => {
  it("显示当前家庭、老板快速进入和低调的系统维护入口", () => {
    const markup = renderToStaticMarkup(createElement(LoginScreen, {
      bootstrap,
      entryCode: "entry-code-for-family-a",
      onEntered: vi.fn(),
    }));

    expect(markup).toContain("星星家庭");
    expect(markup).toContain("老板可直接进入");
    expect(markup).toContain("老板账号登录");
    expect(markup).toContain("星星爸爸");
    expect(markup).not.toContain("家长默认名称</p>");
    expect(markup).toContain("系统维护入口");
  });

  it("老板代操作横幅持续说明真实老板、家庭、目标小朋友和返回路径", () => {
    const markup = renderToStaticMarkup(createElement(BossActingBanner, {
      bossDisplayName: "爸爸",
      familyName: "星星家庭",
      workerName: "小星",
      onReturn: vi.fn(),
    }));

    expect(markup).toContain("星星家庭的爸爸正在代 小星 操作");
    expect(markup).toContain("返回老板后台");
    expect(markup).toContain('role="status"');
  });

  it("系统后台概况只呈现系统管理边界和汇总数量", () => {
    const markup = renderToStaticMarkup(createElement(SystemOverview, {
      state: {
        settings: { publicFamilyDirectoryEnabled: true },
        families: [{
          id: "family-a",
          name: "星星家庭",
          timezone: "Asia/Shanghai",
          status: "active",
          entryCode: "entry-code-for-family-a",
          bossCount: 1,
          workerCount: 2,
          createdAt: 1,
          updatedAt: 1,
        }],
        bosses: [],
        auditLogs: [],
      },
    }));

    expect(markup).toContain("只管理家庭、老板账号和绑定关系");
    expect(markup).toContain("启用家庭");
    expect(markup).toContain("小朋友总数");
    expect(markup).not.toContain("发布任务");
    expect(markup).not.toContain("余额明细");
  });

  it("根首页公开家庭目录时只显示家庭选择，不提前显示小朋友", () => {
    const markup = renderToStaticMarkup(createElement(LoginScreen, {
      bootstrap: {
        ...bootstrap,
        family: null,
        workers: [],
        activeIdentity: null,
        publicFamilyDirectoryEnabled: true,
        publicFamilies: [
          { id: "family-a", name: "星星家庭", entryCode: "entry-code-for-family-a" },
          { id: "family-b", name: "月亮家庭", entryCode: "entry-code-for-family-b" },
        ],
      },
      onEntered: vi.fn(),
    }));

    expect(markup).toContain("请选择要进入的家庭");
    expect(markup).toContain("星星家庭");
    expect(markup).toContain("月亮家庭");
    expect(markup).toContain("/family/entry-code-for-family-a");
    expect(markup).toContain("已有家庭入口");
    expect(markup).toContain("家庭链接或入口码");
    expect(markup).toContain("直接进入");
    expect(markup).not.toContain("小星");
  });

  it("关闭家庭目录后根首页只提示使用专属入口", () => {
    const markup = renderToStaticMarkup(createElement(LoginScreen, {
      bootstrap: {
        ...bootstrap,
        family: null,
        workers: [],
        activeIdentity: null,
        publicFamilyDirectoryEnabled: false,
        publicFamilies: [],
      },
      onEntered: vi.fn(),
    }));
    const settingMarkup = renderToStaticMarkup(createElement(PublicFamilyDirectorySetting, {
      enabled: false,
      busy: false,
      mutate: vi.fn(async () => true),
    }));

    expect(markup).toContain("家庭列表暂未公开");
    expect(markup).toContain("请使用家庭专属入口");
    expect(markup).toContain("已有家庭入口");
    expect(markup).toContain("直接进入");
    expect(markup).toContain("系统维护入口");
    expect(markup).not.toContain("星星家庭");
    expect(settingMarkup).toContain("开启首页展示");
    expect(settingMarkup).toContain("只能使用家庭专属入口");
  });

  it("家庭地址输入只提取入口码并始终跳转到当前系统", () => {
    const entryCode = "entry-code-for-family-a";
    expect(familyEntryPathFromInput(entryCode)).toBe(`/family/${entryCode}`);
    expect(familyEntryPathFromInput(`/family/${entryCode}`)).toBe(`/family/${entryCode}`);
    expect(familyEntryPathFromInput(`http://192.168.1.8:3000/family/${entryCode}?from=qr`))
      .toBe(`/family/${entryCode}`);
    expect(familyEntryPathFromInput(`example.com/family/${entryCode}`)).toBe(`/family/${entryCode}`);
    expect(familyEntryPathFromInput(`https://another.example/family/${entryCode}`))
      .toBe(`/family/${entryCode}`);
    expect(familyEntryPathFromInput("https://another.example/not-a-family")).toBeNull();
    expect(familyEntryPathFromInput("short-code")).toBeNull();
  });

  it("系统家庭管理默认使用紧凑列表，并通过弹窗创建和编辑", () => {
    const mutate = vi.fn(async () => true);
    const createMarkup = renderToStaticMarkup(createElement(CreateFamily, {
      busy: false,
      mutate,
    }));
    const familyMarkup = renderToStaticMarkup(createElement(FamilyCard, {
      family: {
        id: "family-a",
        name: "星星家庭",
        timezone: "Asia/Shanghai",
        status: "active",
        entryCode: "entry-code-for-family-a",
        bossCount: 1,
        workerCount: 2,
        createdAt: 1,
        updatedAt: 1,
      },
      origin: "https://family.example",
      busy: false,
      mutate,
      onNotice: vi.fn(),
    }));

    expect(createMarkup).toContain("创建家庭");
    expect(createMarkup).toContain('aria-haspopup="dialog"');
    expect(createMarkup).not.toContain("家庭名称</span><input");
    expect(familyMarkup).toContain("星星家庭");
    expect(familyMarkup).toContain("1 位老板 · 2 位小朋友");
    expect(familyMarkup).toContain("编辑");
    expect(familyMarkup).toContain("停用");
    expect(familyMarkup).not.toContain("家庭入口");
    expect(familyMarkup).not.toContain("entry-code-for-family-a");
    expect(familyMarkup).not.toContain("时区");
    expect(familyMarkup).not.toContain("入口二维码");
    expect(familyMarkup).not.toContain("扫码打开");
  });

  it("老板账号使用可搜索的紧凑列表，并通过弹窗创建和编辑", () => {
    const mutate = vi.fn(async () => true);
    const families: SystemFamily[] = [{
      id: "family-a",
      name: "星星家庭",
      timezone: "Asia/Shanghai",
      status: "active",
      entryCode: "entry-code-for-family-a",
      bossCount: 1,
      workerCount: 2,
      createdAt: 1,
      updatedAt: 1,
    }];
    const boss: SystemBoss = {
      id: "boss-a",
      username: "parent.star",
      displayName: "星星爸爸",
      authVersion: 1,
      isActive: true,
      families: [{
        familyId: "family-a",
        familyName: "星星家庭",
        familyStatus: "active",
        familyTimezone: "Asia/Shanghai",
        displayName: "家庭教练",
        displayNameOverride: "家庭教练",
      }],
      createdAt: 1,
      updatedAt: 1,
    };
    const createMarkup = renderToStaticMarkup(createElement(CreateBoss, { busy: false, mutate }));
    const bossMarkup = renderToStaticMarkup(createElement(BossCard, {
      boss,
      families,
      busy: false,
      mutate,
    }));
    const managementMarkup = renderToStaticMarkup(createElement(BossManagement, {
      bosses: [boss],
      families,
      busy: false,
      mutate,
    }));

    expect(createMarkup).toContain("创建老板");
    expect(createMarkup).toContain('aria-haspopup="dialog"');
    expect(createMarkup).not.toContain("初始密码");
    expect(bossMarkup).toContain("星星爸爸");
    expect(bossMarkup).toContain("parent.star · 星星家庭：家庭教练");
    expect(bossMarkup).toContain("编辑");
    expect(bossMarkup).toContain("停用");
    expect(bossMarkup).not.toContain("可管理的家庭");
    expect(bossMarkup).not.toContain("重置密码");
    expect(managementMarkup).toContain("搜索显示名、登录名或家庭");
    expect(bossMatchesQuery(boss, "星星爸爸")).toBe(true);
    expect(bossMatchesQuery(boss, "PARENT.STAR")).toBe(true);
    expect(bossMatchesQuery(boss, "星星家庭")).toBe(true);
    expect(bossMatchesQuery(boss, "家庭教练")).toBe(true);
    expect(bossMatchesQuery(boss, "不存在")).toBe(false);
  });

  it("家庭入口生成可扫码的 SVG 二维码，并说明仍需角色认证", () => {
    const markup = renderToStaticMarkup(createElement(FamilyEntryQr, {
      url: "https://family.example/family/random-entry-code",
      familyName: "星星家庭",
    }));

    expect(markup).toContain("<svg");
    expect(markup).toContain("星星家庭入口二维码");
    expect(markup).toContain("扫码打开 星星家庭");
    expect(markup).toContain("仍需 PIN 或老板账号");
  });
});
