import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  createBossAccount,
  createFamily,
  getSystemManagementState,
  rotateFamilyEntryCode,
  setPublicFamilyDirectory,
  setBossFamilyMembership,
  updateBossAccount,
  updateFamily,
} from "@/lib/account-service";
import { AppError, jsonError, jsonOk } from "@/lib/http";
import { getRequestSession, isSystemAdminAuthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestId = z.string().trim().min(8).max(100).optional();
const familyId = z.string().uuid();
const bossId = z.string().uuid();

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_public_family_directory"),
    enabled: z.boolean(),
    requestId,
  }),
  z.object({
    action: z.literal("create_family"),
    name: z.string().trim().min(1).max(60),
    requestId,
  }),
  z.object({
    action: z.literal("update_family"),
    familyId,
    name: z.string().trim().min(1).max(60).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    requestId,
  }),
  z.object({
    action: z.literal("rotate_family_entry_code"),
    familyId,
    requestId,
  }),
  z.object({
    action: z.literal("create_boss"),
    username: z.string().trim().min(3).max(50),
    displayName: z.string().trim().min(1).max(60),
    password: z.string().min(8).max(200),
    requestId,
  }),
  z.object({
    action: z.literal("update_boss"),
    bossId,
    username: z.string().trim().min(3).max(50).optional(),
    displayName: z.string().trim().min(1).max(60).optional(),
    password: z.string().min(8).max(200).optional(),
    isActive: z.boolean().optional(),
    requestId,
  }),
  z.object({
    action: z.literal("set_boss_family"),
    bossId,
    familyId,
    attached: z.boolean(),
    requestId,
  }),
]);

function requireSystemAdmin(request: NextRequest) {
  const session = getRequestSession(request);
  if (session.active?.type !== "system_admin" || !isSystemAdminAuthorized(session)) {
    throw new AppError("请先使用系统管理员密码登录。", 401, "SYSTEM_ADMIN_LOGIN_REQUIRED");
  }
}

export async function GET(request: NextRequest) {
  try {
    requireSystemAdmin(request);
    return jsonOk(getSystemManagementState());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSystemAdmin(request);
    const input = mutationSchema.parse(await request.json());
    switch (input.action) {
      case "set_public_family_directory":
        setPublicFamilyDirectory(input);
        break;
      case "create_family":
        createFamily(input);
        break;
      case "update_family":
        updateFamily(input);
        break;
      case "rotate_family_entry_code":
        rotateFamilyEntryCode(input);
        break;
      case "create_boss":
        await createBossAccount(input);
        break;
      case "update_boss":
        await updateBossAccount(input);
        break;
      case "set_boss_family":
        setBossFamilyMembership(input);
        break;
    }
    return jsonOk(getSystemManagementState());
  } catch (error) {
    return jsonError(error);
  }
}
