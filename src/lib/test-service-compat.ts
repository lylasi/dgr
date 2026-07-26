/**
 * Compatibility facade for the pre-family integration suite.
 *
 * Keeping this adapter in test imports makes the production service API stay
 * strict: every real caller must provide an explicit family and actor.
 */
import {
  systemAdminBusinessContext,
  type FamilyBusinessContext,
} from "@/lib/business-context";
import { DEFAULT_FAMILY_ID } from "@/lib/db";
import * as service from "@/lib/service";

type LegacyActor = "admin" | `worker:${string}`;

function adminContext() {
  return systemAdminBusinessContext(DEFAULT_FAMILY_ID);
}

function workerContext(workerId: string): FamilyBusinessContext {
  return {
    familyId: DEFAULT_FAMILY_ID,
    actor: { type: "worker", workerId },
  };
}

function contextForActor(actor: LegacyActor): FamilyBusinessContext {
  return actor === "admin"
    ? adminContext()
    : workerContext(actor.slice("worker:".length));
}

export function syncWorker(workerId: string, now = Date.now()) {
  return service.syncWorker(adminContext(), workerId, now);
}

export function setWorkerAvatarImage(input: Parameters<typeof service.setWorkerAvatarImage>[1]) {
  return service.setWorkerAvatarImage(adminContext(), input);
}

export function removeWorkerAvatarImage(workerId: string, requestId?: string) {
  return service.removeWorkerAvatarImage(adminContext(), workerId, requestId);
}

export function getWorkerAvatarImage(workerId: string) {
  return service.getWorkerAvatarImage(adminContext(), workerId);
}

export function createWorker(input: Parameters<typeof service.createWorker>[1]) {
  return service.createWorker(adminContext(), input);
}

export function updateWorker(input: Parameters<typeof service.updateWorker>[1]) {
  return service.updateWorker(adminContext(), input);
}

export function createTask(input: Parameters<typeof service.createTask>[1]) {
  return service.createTask(adminContext(), input);
}

export function submitRewardRequest(input: Parameters<typeof service.submitRewardRequest>[1]) {
  return service.submitRewardRequest(workerContext(input.workerId), input);
}

export function resubmitRewardRequest(input: Parameters<typeof service.resubmitRewardRequest>[1]) {
  return service.resubmitRewardRequest(workerContext(input.workerId), input);
}

export function cancelRewardRequest(input: Parameters<typeof service.cancelRewardRequest>[1]) {
  return service.cancelRewardRequest(workerContext(input.workerId), input);
}

export function reviewRewardRequest(input: Parameters<typeof service.reviewRewardRequest>[1]) {
  return service.reviewRewardRequest(adminContext(), input);
}

export function claimTask(workerId: string, taskId: string, requestId?: string) {
  return service.claimTask(workerContext(workerId), workerId, taskId, requestId);
}

export function startTimer(
  input: Parameters<typeof service.startTimer>[1] & { actor: LegacyActor },
) {
  const { actor, ...operation } = input;
  return service.startTimer(contextForActor(actor), operation);
}

export function stopTimer(workerId: string, actor: LegacyActor, requestId?: string) {
  return service.stopTimer(contextForActor(actor), workerId, requestId);
}

export function cancelConsumptionTimer(
  input: Parameters<typeof service.cancelConsumptionTimer>[1] & { actor: LegacyActor },
) {
  const { actor, ...operation } = input;
  return service.cancelConsumptionTimer(contextForActor(actor), operation);
}

export function reverseConsumptionTransaction(
  input: Parameters<typeof service.reverseConsumptionTransaction>[1],
) {
  return service.reverseConsumptionTransaction(adminContext(), input);
}

export function setAssignmentDuration(
  input: Parameters<typeof service.setAssignmentDuration>[1] & { actor: LegacyActor },
) {
  const { actor, ...operation } = input;
  return service.setAssignmentDuration(contextForActor(actor), operation);
}

export function cancelAssignment(
  input: Parameters<typeof service.cancelAssignment>[1] & { actor: LegacyActor },
) {
  const { actor, ...operation } = input;
  return service.cancelAssignment(contextForActor(actor), operation);
}

export function manualConsumption(
  input: Parameters<typeof service.manualConsumption>[1] & { actor: LegacyActor },
) {
  const { actor, ...operation } = input;
  return service.manualConsumption(contextForActor(actor), operation);
}

export function submitAssignment(
  input: Parameters<typeof service.submitAssignment>[1] & { actor: LegacyActor },
) {
  const { actor, ...operation } = input;
  return service.submitAssignment(contextForActor(actor), operation);
}

export function reviewAssignment(input: Parameters<typeof service.reviewAssignment>[1]) {
  return service.reviewAssignment(adminContext(), input);
}

export function grantQuickReward(input: Parameters<typeof service.grantQuickReward>[1]) {
  return service.grantQuickReward(adminContext(), input);
}

export function adjustBalance(input: Parameters<typeof service.adjustBalance>[1]) {
  return service.adjustBalance(adminContext(), input);
}

export function getWorkerState(workerId: string) {
  return service.getWorkerState(workerContext(workerId), workerId);
}

export function getAdminState() {
  return service.getAdminState(adminContext());
}
