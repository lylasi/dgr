export type BusinessActor =
  | { type: "system_admin" }
  | { type: "boss"; bossId: string; displayName: string }
  | { type: "worker"; workerId: string; displayName?: string }
  | { type: "boss_as_worker"; bossId: string; displayName: string; workerId: string }
  | { type: "system" };

export type FamilyBusinessContext = {
  familyId: string;
  actor: BusinessActor;
};

export type ActorAuditFields = {
  key: string;
  type: BusinessActor["type"];
  id: string | null;
  name: string;
  actingForWorkerId: string | null;
};

export function actorAuditFields(actor: BusinessActor): ActorAuditFields {
  switch (actor.type) {
    case "system_admin":
      return {
        key: "system_admin",
        type: actor.type,
        id: null,
        name: "系统管理员",
        actingForWorkerId: null,
      };
    case "boss":
      return {
        key: `boss:${actor.bossId}`,
        type: actor.type,
        id: actor.bossId,
        name: actor.displayName,
        actingForWorkerId: null,
      };
    case "worker":
      return {
        key: `worker:${actor.workerId}`,
        type: actor.type,
        id: actor.workerId,
        name: actor.displayName || "打工人",
        actingForWorkerId: null,
      };
    case "boss_as_worker":
      return {
        key: `boss:${actor.bossId}`,
        type: actor.type,
        id: actor.bossId,
        name: actor.displayName,
        actingForWorkerId: actor.workerId,
      };
    case "system":
      return {
        key: "system",
        type: actor.type,
        id: null,
        name: "系统",
        actingForWorkerId: null,
      };
  }
}

export function systemAdminBusinessContext(familyId: string): FamilyBusinessContext {
  return { familyId, actor: { type: "system_admin" } };
}

export function systemBusinessContext(familyId: string): FamilyBusinessContext {
  return { familyId, actor: { type: "system" } };
}

export function isFamilyManager(context: FamilyBusinessContext): boolean {
  return context.actor.type === "boss" || context.actor.type === "system_admin";
}

export function actorCanOperateWorker(
  context: FamilyBusinessContext,
  workerId: string,
  allowFamilyManager = true,
): boolean {
  if (allowFamilyManager && isFamilyManager(context)) return true;
  if (context.actor.type === "worker") return context.actor.workerId === workerId;
  if (context.actor.type === "boss_as_worker") return context.actor.workerId === workerId;
  return false;
}
