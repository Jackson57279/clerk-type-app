export interface ProvisionUserData {
  email: string;
  externalId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
}

export interface ProvisionedUser {
  id: string;
  email: string;
  externalId: string | undefined;
  name: string | undefined;
  firstName: string | undefined;
  lastName: string | undefined;
  active: boolean;
}

export interface UserProvisioningStore {
  findById(id: string): Promise<ProvisionedUser | null>;
  findByEmail(email: string): Promise<ProvisionedUser | null>;
  findByExternalId(externalId: string): Promise<ProvisionedUser | null>;
  create(data: ProvisionUserData): Promise<ProvisionedUser>;
  update(id: string, data: Partial<ProvisionUserData>): Promise<ProvisionedUser>;
  softDelete(id: string): Promise<void>;
  hardDelete(id: string): Promise<void>;
}

export interface ProvisionOptions {
  organizationId?: string;
  reactivateIfDeactivated?: boolean;
  isAllowedEmail?: (email: string) => boolean;
}

export interface ProvisionResult {
  user: ProvisionedUser;
  created: boolean;
}

import { createDefaultEmailDomainChecker } from "./email-domain-restriction.js";
import {
  deactivateEntity,
  deleteEntity,
  deprovisionEntity,
  type DeprovisionOptions,
} from "./soft-delete.js";
export type { DeprovisionOptions } from "./soft-delete.js";

export async function provisionUser(
  store: UserProvisioningStore,
  data: ProvisionUserData,
  options: ProvisionOptions = {}
): Promise<ProvisionResult> {
  const { reactivateIfDeactivated = true, isAllowedEmail: isAllowedEmailOpt } = options;

  if (data.externalId) {
    const byExternal = await store.findByExternalId(data.externalId);
    if (byExternal) {
      if (!byExternal.active && reactivateIfDeactivated) {
        const updated = await store.update(byExternal.id, {
          ...data,
          active: data.active ?? true,
        });
        return { user: updated, created: false };
      }
      if (byExternal.active) {
        const updated = await store.update(byExternal.id, data);
        return { user: updated, created: false };
      }
    }
  }

  const byEmail = await store.findByEmail(data.email);
  if (byEmail) {
    if (!byEmail.active && reactivateIfDeactivated) {
      const updated = await store.update(byEmail.id, {
        ...data,
        active: data.active ?? true,
      });
      return { user: updated, created: false };
    }
    if (byEmail.active) {
      const updated = await store.update(byEmail.id, data);
      return { user: updated, created: false };
    }
  }

  const isAllowed = isAllowedEmailOpt ?? createDefaultEmailDomainChecker();
  if (!isAllowed(data.email)) {
    throw new Error("Email domain not allowed");
  }

  const user = await store.create({
    ...data,
    active: data.active ?? true,
  });
  return { user, created: true };
}

export async function deactivateUser(
  store: UserProvisioningStore,
  userId: string
): Promise<void> {
  return deactivateEntity(store, userId);
}

export async function deleteUser(
  store: UserProvisioningStore,
  userId: string
): Promise<void> {
  return deleteEntity(store, userId);
}

export async function deprovisionUser(
  store: UserProvisioningStore,
  userId: string,
  options: DeprovisionOptions = {}
): Promise<void> {
  return deprovisionEntity(store, userId, options);
}
