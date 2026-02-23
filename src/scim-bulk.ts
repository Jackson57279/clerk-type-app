import type { UserProvisioningStore } from "./user-provisioning.js";
import { provisionUser, deprovisionUser } from "./user-provisioning.js";
import type { GroupSyncStore } from "./group-sync.js";
import { syncGroup } from "./group-sync.js";

export const BULK_REQUEST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";
export const BULK_RESPONSE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:BulkResponse";

export type BulkMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface ScimBulkOperationRequest {
  method: BulkMethod;
  path: string;
  bulkId?: string;
  data?: ScimBulkUserData | ScimBulkGroupData;
}

export interface ScimBulkUserData {
  id?: string;
  externalId?: string;
  userName?: string;
  emails?: Array<{ value: string; primary?: boolean }>;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  active?: boolean;
}

export interface ScimBulkGroupMember {
  value: string;
  display?: string;
}

export interface ScimBulkGroupData {
  id?: string;
  externalId?: string;
  displayName?: string;
  members?: ScimBulkGroupMember[];
}

export interface ScimBulkRequest {
  schemas: string[];
  Operations: ScimBulkOperationRequest[];
  failOnErrors?: number;
}

export interface ScimBulkOperationResponse {
  bulkId?: string;
  method: BulkMethod;
  path: string;
  location?: string;
  response?: unknown;
  status: number;
}

export interface ScimBulkResponse {
  schemas: string[];
  Operations: ScimBulkOperationResponse[];
}

export interface ProcessBulkParams {
  request: ScimBulkRequest;
  userStore: UserProvisioningStore;
  groupStore: GroupSyncStore;
  organizationId: string;
  baseUrl?: string;
}

function normPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/^v2\//, "");
}

function parsePath(path: string): { resource: "Users" | "Groups"; id: string | null } {
  const p = normPath(path);
  if (p.startsWith("Users/")) {
    return { resource: "Users", id: p.slice(6) || null };
  }
  if (p === "Users") return { resource: "Users", id: null };
  if (p.startsWith("Groups/")) {
    return { resource: "Groups", id: p.slice(7) || null };
  }
  if (p === "Groups") return { resource: "Groups", id: null };
  throw new Error(`Unsupported bulk path: ${path}`);
}

function userDataToProvision(d: ScimBulkUserData): { email: string; externalId?: string; name?: string; firstName?: string; lastName?: string; active?: boolean } {
  const email = d.emails?.[0]?.value ?? d.userName ?? "";
  const name = d.name?.formatted ?? ([d.name?.givenName, d.name?.familyName].filter(Boolean).join(" ").trim() || undefined);
  return {
    email,
    externalId: d.externalId,
    name: name || undefined,
    firstName: d.name?.givenName,
    lastName: d.name?.familyName,
    active: d.active ?? true,
  };
}

export async function processBulkRequest(params: ProcessBulkParams): Promise<ScimBulkResponse> {
  const { request, userStore, groupStore, organizationId, baseUrl = "" } = params;
  const failOnErrors = request.failOnErrors ?? 0;
  const results: ScimBulkOperationResponse[] = [];
  let errorCount = 0;

  for (const op of request.Operations) {
    if (failOnErrors > 0 && errorCount >= failOnErrors) {
      results.push({
        bulkId: op.bulkId,
        method: op.method,
        path: op.path,
        status: 0,
        response: { detail: "Bulk request stopped: failOnErrors limit reached." },
      });
      continue;
    }

    try {
      const { resource, id } = parsePath(op.path);

      if (resource === "Users") {
        if (op.method === "POST" && !id) {
          const data = op.data as ScimBulkUserData | undefined;
          if (!data) {
            results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 400, response: { detail: "Missing data for User create" } });
            errorCount++;
            continue;
          }
          const provisionData = userDataToProvision(data);
          if (!provisionData.email) {
            results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 400, response: { detail: "User email or userName required" } });
            errorCount++;
            continue;
          }
          const result = await provisionUser(userStore, provisionData, { organizationId, reactivateIfDeactivated: true });
          const location = baseUrl ? `${baseUrl.replace(/\/$/, "")}/Users/${result.user.id}` : undefined;
          results.push({
            bulkId: op.bulkId,
            method: op.method,
            path: op.path,
            status: result.created ? 201 : 200,
            location,
            response: { id: result.user.id, externalId: result.user.externalId, active: result.user.active },
          });
          continue;
        }

        if ((op.method === "PUT" || op.method === "PATCH") && id) {
          const data = op.data as ScimBulkUserData | undefined;
          if (!data) {
            results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 400, response: { detail: "Missing data for User update" } });
            errorCount++;
            continue;
          }
          const user = await userStore.findById(id) ?? await userStore.findByExternalId(id);
          if (!user) {
            results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 404, response: { detail: "User not found" } });
            errorCount++;
            continue;
          }
          const provisionData = userDataToProvision(data);
          const updated = await userStore.update(user.id, {
            email: provisionData.email || user.email,
            externalId: provisionData.externalId ?? user.externalId,
            name: provisionData.name,
            firstName: provisionData.firstName,
            lastName: provisionData.lastName,
            active: provisionData.active,
          });
          results.push({
            bulkId: op.bulkId,
            method: op.method,
            path: op.path,
            status: 200,
            response: { id: updated.id, externalId: updated.externalId, active: updated.active },
          });
          continue;
        }

        if (op.method === "DELETE" && id) {
          const user = await userStore.findById(id) ?? await userStore.findByExternalId(id);
          if (!user) {
            results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 204 });
            continue;
          }
          await deprovisionUser(userStore, user.id, { hard: false });
          results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 204 });
          continue;
        }
      }

      if (resource === "Groups") {
        if (op.method === "POST" && !id) {
          const data = op.data as ScimBulkGroupData | undefined;
          if (!data || (data.externalId === undefined && data.displayName === undefined)) {
            results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 400, response: { detail: "Group externalId or displayName required" } });
            errorCount++;
            continue;
          }
          const memberIds: string[] = [];
          if (data.members?.length) {
            for (const m of data.members) {
              const u = await userStore.findByExternalId(m.value) ?? await userStore.findById(m.value);
              if (u?.active) memberIds.push(u.id);
            }
          }
          const result = await syncGroup(
            groupStore,
            { externalId: data.externalId ?? `bulk_${op.bulkId ?? "g"}`, displayName: data.displayName ?? "Group", memberIds },
            { organizationId }
          );
          const location = baseUrl ? `${baseUrl.replace(/\/$/, "")}/Groups/${result.group.id}` : undefined;
          results.push({
            bulkId: op.bulkId,
            method: op.method,
            path: op.path,
            status: result.created ? 201 : 200,
            location,
            response: { id: result.group.id, externalId: result.group.externalId, displayName: result.group.displayName },
          });
          continue;
        }

        if ((op.method === "PUT" || op.method === "PATCH") && id) {
          const data = op.data as ScimBulkGroupData | undefined;
          const group = await groupStore.findGroupById(id) ?? await groupStore.findGroupByExternalId(organizationId, id);
          if (!group) {
            results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 404, response: { detail: "Group not found" } });
            errorCount++;
            continue;
          }
          const memberIds: string[] = [];
          if (data?.members?.length) {
            for (const m of data.members) {
              const u = await userStore.findByExternalId(m.value) ?? await userStore.findById(m.value);
              if (u?.active) memberIds.push(u.id);
            }
          } else {
            const existing = await groupStore.listGroupMemberIds(group.id);
            memberIds.push(...existing);
          }
          await syncGroup(
            groupStore,
            { externalId: group.externalId, displayName: data?.displayName ?? group.displayName, memberIds },
            { organizationId }
          );
          results.push({
            bulkId: op.bulkId,
            method: op.method,
            path: op.path,
            status: 200,
            response: { id: group.id, externalId: group.externalId, displayName: data?.displayName ?? group.displayName },
          });
          continue;
        }

        if (op.method === "DELETE" && id) {
          const group = await groupStore.findGroupById(id) ?? await groupStore.findGroupByExternalId(organizationId, id);
          if (!group) {
            results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 204 });
            continue;
          }
          await groupStore.softDeleteGroup(group.id);
          results.push({ bulkId: op.bulkId, method: op.method, path: op.path, status: 204 });
          continue;
        }
      }

      results.push({
        bulkId: op.bulkId,
        method: op.method,
        path: op.path,
        status: 400,
        response: { detail: `Unsupported bulk operation: ${op.method} ${op.path}` },
      });
      errorCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        bulkId: op.bulkId,
        method: op.method,
        path: op.path,
        status: 500,
        response: { detail: message },
      });
      errorCount++;
    }
  }

  return {
    schemas: [BULK_RESPONSE_SCHEMA],
    Operations: results,
  };
}
