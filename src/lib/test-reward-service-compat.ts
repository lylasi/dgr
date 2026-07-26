/** Test-only default-family facade; production callers use reward-service directly. */
import {
  systemAdminBusinessContext,
  type FamilyBusinessContext,
} from "@/lib/business-context";
import { DEFAULT_FAMILY_ID } from "@/lib/db";
import * as reward from "@/lib/reward-service";

function adminContext() {
  return systemAdminBusinessContext(DEFAULT_FAMILY_ID);
}

function workerContext(workerId: string): FamilyBusinessContext {
  return {
    familyId: DEFAULT_FAMILY_ID,
    actor: { type: "worker", workerId },
  };
}

export function isRewardSystemEnabled() {
  return reward.isRewardSystemEnabled(adminContext());
}

export function setRewardSystemEnabled(enabled: boolean, requestId?: string) {
  return reward.setRewardSystemEnabled(adminContext(), enabled, requestId);
}

export function createRewardDefinition(input: Parameters<typeof reward.createRewardDefinition>[1]) {
  return reward.createRewardDefinition(adminContext(), input);
}

export function updateRewardDefinition(input: Parameters<typeof reward.updateRewardDefinition>[1]) {
  return reward.updateRewardDefinition(adminContext(), input);
}

export function copyRewardDefinition(definitionId: string, requestId?: string) {
  return reward.copyRewardDefinition(adminContext(), definitionId, requestId);
}

export function setRewardDefinitionActive(definitionId: string, active: boolean, requestId?: string) {
  return reward.setRewardDefinitionActive(adminContext(), definitionId, active, requestId);
}

export function deleteRewardDefinition(definitionId: string, requestId?: string) {
  return reward.deleteRewardDefinition(adminContext(), definitionId, requestId);
}

export function setRewardDefinitionImage(input: Parameters<typeof reward.setRewardDefinitionImage>[1]) {
  return reward.setRewardDefinitionImage(adminContext(), input);
}

export function removeRewardDefinitionImage(definitionId: string, requestId?: string) {
  return reward.removeRewardDefinitionImage(adminContext(), definitionId, requestId);
}

export function getRewardDefinitionImage(imageId: string) {
  return reward.getRewardDefinitionImage(adminContext(), imageId);
}

export function updateDailyCouponSetting(input: Parameters<typeof reward.updateDailyCouponSetting>[1]) {
  return reward.updateDailyCouponSetting(adminContext(), input);
}

export function grantRewardDefinition(input: Parameters<typeof reward.grantRewardDefinition>[1]) {
  return reward.grantRewardDefinition(adminContext(), input);
}

export function cancelRewardItem(input: Parameters<typeof reward.cancelRewardItem>[1]) {
  return reward.cancelRewardItem(adminContext(), input);
}

export function redeemTimeReward(input: Parameters<typeof reward.redeemTimeReward>[1]) {
  return reward.redeemTimeReward(workerContext(input.workerId), input);
}

export function confirmPhysicalReward(input: Parameters<typeof reward.confirmPhysicalReward>[1]) {
  return reward.confirmPhysicalReward(workerContext(input.workerId), input);
}

export function getWorkerRewardState(workerId: string, now = Date.now()) {
  return reward.getWorkerRewardState(workerContext(workerId), workerId, now);
}

export function getAdminRewardState(now = Date.now()) {
  return reward.getAdminRewardState(adminContext(), now);
}
