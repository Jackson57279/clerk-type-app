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
}

export interface ProvisionResult {
  user: ProvisionedUser;
  created: boolean;
}

import { deprovisionEntity, type DeprovisionOptions } from "./soft-delete.js";
export type { DeprovisionOptions } from "./soft-delete.js";

export async function provisionUser(
  store: UserProvisioningStore,
  data: ProvisionUserData,
  options: ProvisionOptions = {}
): Promise<ProvisionResult> {
  const { reactivateIfDeactivated = true } = options;

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

  const user = await store.create({
    ...data,
    active: data.active ?? true,
  });
  return { user, created: true };
}

export async function deprovisionUser(
  store: UserProvisioningStore,
  userId: string,
  options: DeprovisionOptions = {}
): Promise<void> {
  return deprovisionEntity(store, userId, options);
}
