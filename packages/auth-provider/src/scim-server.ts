import type { UserProvisioningStore, ProvisionedUser, ProvisionUserData } from "./user-provisioning.js";
import { provisionUser, deprovisionUser } from "./user-provisioning.js";
import type { GroupSyncStore, SyncedGroup } from "./group-sync.js";
import { syncGroup, deprovisionGroup } from "./group-sync.js";
import { mapScimUserToProvisionData, type ScimUserAttributeMappingConfig } from "./attribute-mapping.js";
import { processBulkRequest, type ScimBulkRequest } from "./scim-bulk.js";
import type { DeliverWebhookOptions, WebhookSubscriptionStore } from "./realtime-webhook.js";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_RESPONSE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export interface ScimServerUserStore extends UserProvisioningStore {
  listUsers(organizationId: string): Promise<ProvisionedUser[]>;
}

export interface ScimRequestContext {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  userStore: ScimServerUserStore;
  groupStore: GroupSyncStore;
  organizationId: string;
  baseUrl?: string;
  scimUserAttributeMapping?: ScimUserAttributeMappingConfig;
  isAllowedEmail?: (email: string) => boolean;
  webhookStore?: WebhookSubscriptionStore;
  webhookDeliveryOptions?: DeliverWebhookOptions;
  bulkMaxOperations?: number;
}

export interface ScimResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/^scim\/v2\/?/, "").replace(/^v2\/?/, "").replace(/\/+$/, "") || "";
}

function parsePath(path: string): { resource: string; id: string | null } {
  const p = normalizePath(path);
  const parts = p.split("/");
  if (parts.length >= 2) {
    return { resource: parts[0]!, id: parts[1]! };
  }
  if (parts.length === 1 && parts[0]) {
    return { resource: parts[0], id: null };
  }
  return { resource: "", id: null };
}

function scimError(detail: string, status: number, scimType?: string): ScimResponse {
  return {
    status,
    body: {
      schemas: [ERROR_SCHEMA],
      detail,
      status: status,
      ...(scimType ? { scimType } : {}),
    },
  };
}

function userToScimResource(user: ProvisionedUser, baseUrl: string): Record<string, unknown> {
  const location = baseUrl ? `${baseUrl.replace(/\/$/, "")}/Users/${user.id}` : undefined;
  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    externalId: user.externalId ?? undefined,
    userName: user.email,
    name: {
      formatted: user.name ?? ([user.firstName, user.lastName].filter(Boolean).join(" ").trim() || undefined),
      givenName: user.firstName,
      familyName: user.lastName,
    },
    emails: user.email ? [{ value: user.email, primary: true }] : [],
    active: user.active,
    meta: {
      resourceType: "User",
      ...(location ? { location } : {}),
    },
  };
}

function groupToScimResource(
  group: SyncedGroup,
  memberIds: string[],
  baseUrl: string
): Record<string, unknown> {
  const location = baseUrl ? `${baseUrl.replace(/\/$/, "")}/Groups/${group.id}` : undefined;
  return {
    schemas: [GROUP_SCHEMA],
    id: group.id,
    externalId: group.externalId,
    displayName: group.displayName,
    members: memberIds.map((value) => ({ value })),
    meta: {
      resourceType: "Group",
      ...(location ? { location } : {}),
    },
  };
}

function scimUserBodyToProvisionData(body: Record<string, unknown>, mapping?: ScimUserAttributeMappingConfig) {
  const attrs = body as {
    userName?: string;
    emails?: Array<{ value: string; primary?: boolean }>;
    name?: { formatted?: string; givenName?: string; familyName?: string };
    externalId?: string;
    active?: boolean;
  };
  return mapScimUserToProvisionData(attrs, mapping ?? {});
}

function applyPatchToUser(user: ProvisionedUser, operations: Array<{ op: string; path?: string; value?: unknown }>): Partial<ProvisionUserData> {
  const updates: Partial<ProvisionUserData> = {};
  for (const op of operations) {
    if (op.op !== "replace" && op.op !== "add") continue;
    const path = (op.path ?? "").replace(/^\/?/, "");
    if (path === "active" && op.value !== undefined) updates.active = Boolean(op.value);
    if (path === "userName" && typeof op.value === "string") updates.email = op.value;
    if (path === "emails" && Array.isArray(op.value)) {
      const primary = op.value.find((e: { primary?: boolean }) => e.primary);
      const first = op.value[0];
      const val = (primary ?? first)?.value;
      if (typeof val === "string") updates.email = val;
    }
    if (path === "name") {
      if (typeof op.value === "object" && op.value !== null) {
        const n = op.value as { formatted?: string; givenName?: string; familyName?: string };
        if (n.formatted !== undefined) updates.name = n.formatted;
        if (n.givenName !== undefined) updates.firstName = n.givenName;
        if (n.familyName !== undefined) updates.lastName = n.familyName;
      }
    }
    if (path === "name.formatted" && typeof op.value === "string") updates.name = op.value;
    if (path === "name.givenName" && typeof op.value === "string") updates.firstName = op.value;
    if (path === "name.familyName" && typeof op.value === "string") updates.lastName = op.value;
    if (path === "externalId") updates.externalId = op.value === null ? undefined : String(op.value);
  }
  return updates;
}

function applyPatchToGroup(
  group: SyncedGroup,
  memberIds: string[],
  operations: Array<{ op: string; path?: string; value?: unknown }>
): { displayName?: string; memberIds?: string[] } {
  let displayName: string | undefined = group.displayName;
  let newMemberIds: string[] = [...memberIds];
  for (const op of operations) {
    if (op.op !== "replace" && op.op !== "add") continue;
    const path = (op.path ?? "").replace(/^\/?/, "");
    if (path === "displayName" && typeof op.value === "string") displayName = op.value;
    if (path === "members" && Array.isArray(op.value)) {
      newMemberIds = op.value
        .map((m: { value?: string }) => (typeof m?.value === "string" ? m.value : null))
        .filter((id): id is string => id !== null);
    }
  }
  return { displayName, memberIds: newMemberIds };
}

const SERVICE_PROVIDER_CONFIG = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  documentationUri: undefined as string | undefined,
  patch: { supported: true },
  bulk: { supported: true, maxOperations: 1000, maxPayloadSize: 1048576 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    { type: "oauthbearertoken", name: "OAuth Bearer Token", primary: true, description: "Bearer token authentication." },
  ],
};

const RESOURCE_TYPES = [
  {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: "User",
    name: "User",
    endpoint: "/Users",
    description: "User account",
    schema: USER_SCHEMA,
    schemaExtensions: [],
    meta: { resourceType: "ResourceType", location: "/ResourceTypes/User" },
  },
  {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: "Group",
    name: "Group",
    endpoint: "/Groups",
    description: "Group",
    schema: GROUP_SCHEMA,
    schemaExtensions: [],
    meta: { resourceType: "ResourceType", location: "/ResourceTypes/Group" },
  },
];

const USER_SCHEMA_RESOURCE = {
  id: "urn:ietf:params:scim:schemas:core:2.0:User",
  name: "User",
  description: "User account",
  attributes: [
    { name: "userName", type: "string", required: true, mutability: "readWrite", returned: "default" },
    { name: "name", type: "complex", mutability: "readWrite", returned: "default", subAttributes: [
      { name: "formatted", type: "string", mutability: "readWrite", returned: "default" },
      { name: "givenName", type: "string", mutability: "readWrite", returned: "default" },
      { name: "familyName", type: "string", mutability: "readWrite", returned: "default" },
    ]},
    { name: "emails", type: "complex", multiValued: true, mutability: "readWrite", returned: "default", subAttributes: [
      { name: "value", type: "string", mutability: "readWrite", returned: "default" },
      { name: "primary", type: "boolean", mutability: "readWrite", returned: "default" },
    ]},
    { name: "externalId", type: "string", mutability: "readWrite", returned: "default" },
    { name: "active", type: "boolean", mutability: "readWrite", returned: "default" },
  ],
  meta: { resourceType: "Schema", location: "/Schemas/urn:ietf:params:scim:schemas:core:2.0:User" },
};

const GROUP_SCHEMA_RESOURCE = {
  id: "urn:ietf:params:scim:schemas:core:2.0:Group",
  name: "Group",
  description: "Group",
  attributes: [
    { name: "displayName", type: "string", required: true, mutability: "readWrite", returned: "default" },
    { name: "members", type: "complex", multiValued: true, mutability: "readWrite", returned: "default", subAttributes: [
      { name: "value", type: "string", mutability: "readWrite", returned: "default" },
      { name: "display", type: "string", mutability: "readOnly", returned: "default" },
    ]},
    { name: "externalId", type: "string", mutability: "readWrite", returned: "default" },
  ],
  meta: { resourceType: "Schema", location: "/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group" },
};

function simpleFilterUsers(users: ProvisionedUser[], filter: string): ProvisionedUser[] {
  const eqMatch = /^(userName|externalId)\s+eq\s+"([^"]*)"$/i.exec(filter.trim());
  if (!eqMatch) return users;
  const [, attr, value] = eqMatch;
  if (attr?.toLowerCase() === "username") {
    return users.filter((u) => u.email === value);
  }
  if (attr?.toLowerCase() === "externalid") {
    return users.filter((u) => u.externalId === value);
  }
  return users;
}

export async function handleScimRequest(ctx: ScimRequestContext): Promise<ScimResponse> {
  const { method, path, query, body, userStore, groupStore, organizationId, baseUrl = "" } = ctx;
  const normalized = normalizePath(path);
  const { resource, id } = parsePath(path);
  const upperMethod = method.toUpperCase();

  if (resource === "ServiceProviderConfig") {
    if (upperMethod !== "GET") return scimError("Method not allowed", 405);
    return { status: 200, body: SERVICE_PROVIDER_CONFIG };
  }

  if (resource === "ResourceTypes") {
    if (upperMethod !== "GET") return scimError("Method not allowed", 405);
    if (id) {
      const found = RESOURCE_TYPES.find((r) => r.id === id);
      if (!found) return scimError("Resource type not found", 404);
      return { status: 200, body: found };
    }
    return { status: 200, body: { Resources: RESOURCE_TYPES, totalResults: RESOURCE_TYPES.length } };
  }

  if (resource === "Schemas") {
    if (upperMethod !== "GET") return scimError("Method not allowed", 405);
    const schemas = [USER_SCHEMA_RESOURCE, GROUP_SCHEMA_RESOURCE];
    if (id) {
      const decodedId = decodeURIComponent(id);
      const found = schemas.find((s) => s.id === decodedId);
      if (!found) return scimError("Schema not found", 404);
      return { status: 200, body: found };
    }
    return { status: 200, body: { Resources: schemas, totalResults: schemas.length } };
  }

  if (resource === "Users") {
    if (id) {
      const user = await userStore.findById(id) ?? await userStore.findByExternalId(id);
      if (!user) return scimError("User not found", 404);
      if (upperMethod === "GET") {
        return { status: 200, body: userToScimResource(user, baseUrl) };
      }
      if (upperMethod === "PUT") {
        const b = body as Record<string, unknown> | undefined;
        if (!b || !Array.isArray((b as { schemas?: string[] }).schemas)) {
          return scimError("Invalid request body", 400);
        }
        const provisionData = scimUserBodyToProvisionData(b as Record<string, unknown>, ctx.scimUserAttributeMapping);
        if (!provisionData.email) return scimError("userName or emails required", 400);
        const updated = await userStore.update(user.id, {
          email: provisionData.email,
          externalId: provisionData.externalId,
          name: provisionData.name,
          firstName: provisionData.firstName,
          lastName: provisionData.lastName,
          active: provisionData.active,
        });
        const location = baseUrl ? `${baseUrl.replace(/\/$/, "")}/Users/${updated.id}` : undefined;
        return {
          status: 200,
          headers: location ? { Location: location } : undefined,
          body: userToScimResource(updated, baseUrl),
        };
      }
      if (upperMethod === "PATCH") {
        const b = body as { Operations?: Array<{ op: string; path?: string; value?: unknown }> } | undefined;
        const ops = b?.Operations;
        if (!Array.isArray(ops)) return scimError("PATCH requires Operations array", 400);
        const updates = applyPatchToUser(user, ops);
        const updated = await userStore.update(user.id, updates);
        return { status: 200, body: userToScimResource(updated, baseUrl) };
      }
      if (upperMethod === "DELETE") {
        await deprovisionUser(userStore, user.id, {
          realtimeWebhook: ctx.webhookStore
            ? { organizationId: ctx.organizationId, webhookStore: ctx.webhookStore, webhookDeliveryOptions: ctx.webhookDeliveryOptions }
            : undefined,
        });
        return { status: 204 };
      }
      return scimError("Method not allowed", 405);
    }

    if (upperMethod === "GET") {
      const all = await userStore.listUsers(organizationId);
      const filter = query.filter;
      const filtered = filter ? simpleFilterUsers(all, filter) : all;
      const startIndex = Math.max(0, parseInt(query.startIndex ?? "1", 10) - 1);
      const count = parseInt(query.count ?? String(filtered.length), 10);
      const totalResults = filtered.length;
      const page = filtered.slice(startIndex, startIndex + (count || totalResults));
      const resources = page.map((u) => userToScimResource(u, baseUrl));
      return {
        status: 200,
        body: {
          schemas: [LIST_RESPONSE_SCHEMA],
          totalResults,
          startIndex: startIndex + 1,
          count: resources.length,
          Resources: resources,
        },
      };
    }

    if (upperMethod === "POST") {
      const b = body as Record<string, unknown> | undefined;
      if (!b || !Array.isArray((b as { schemas?: string[] }).schemas)) {
        return scimError("Invalid request body", 400);
      }
      const provisionData = scimUserBodyToProvisionData(b as Record<string, unknown>, ctx.scimUserAttributeMapping);
      if (!provisionData.email) return scimError("userName or emails required", 400);
      try {
        const result = await provisionUser(userStore, provisionData, {
          organizationId,
          isAllowedEmail: ctx.isAllowedEmail,
          realtimeWebhook: ctx.webhookStore
            ? { organizationId, webhookStore: ctx.webhookStore, webhookDeliveryOptions: ctx.webhookDeliveryOptions }
            : undefined,
        });
        const location = baseUrl ? `${baseUrl.replace(/\/$/, "")}/Users/${result.user.id}` : undefined;
        return {
          status: result.created ? 201 : 200,
          headers: location ? { Location: location } : undefined,
          body: userToScimResource(result.user, baseUrl),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("domain not allowed") || msg.includes("duplicate")) {
          return scimError(msg, 409, "uniqueness");
        }
        return scimError(msg, 400);
      }
    }

    return scimError("Method not allowed", 405);
  }

  if (resource === "Groups") {
    if (id) {
      const group = await groupStore.findGroupById(id) ?? await groupStore.findGroupByExternalId(organizationId, id);
      if (!group) return scimError("Group not found", 404);
      const memberIds = await groupStore.listGroupMemberIds(group.id);

      if (upperMethod === "GET") {
        return { status: 200, body: groupToScimResource(group, memberIds, baseUrl) };
      }
      if (upperMethod === "PUT") {
        const b = body as Record<string, unknown> | undefined;
        if (!b) return scimError("Invalid request body", 400);
        const displayName = (b.displayName as string) ?? group.displayName;
        const members = (b.members as Array<{ value: string }>) ?? [];
        const memberIdsToSet: string[] = [];
        for (const m of members) {
          if (typeof m?.value === "string") {
            const u = await userStore.findById(m.value) ?? await userStore.findByExternalId(m.value);
            if (u?.active) memberIdsToSet.push(u.id);
          }
        }
        await groupStore.updateGroup(group.id, { displayName });
        await groupStore.setGroupMembers(group.id, memberIdsToSet);
        const updated = await groupStore.findGroupById(group.id);
        const finalMemberIds = updated ? await groupStore.listGroupMemberIds(updated.id) : memberIdsToSet;
        return {
          status: 200,
          body: groupToScimResource(updated ?? group, finalMemberIds, baseUrl),
        };
      }
      if (upperMethod === "PATCH") {
        const b = body as { Operations?: Array<{ op: string; path?: string; value?: unknown }> } | undefined;
        const ops = b?.Operations;
        if (!Array.isArray(ops)) return scimError("PATCH requires Operations array", 400);
        const { displayName: dn, memberIds: mids } = applyPatchToGroup(group, memberIds, ops);
        if (dn !== undefined) await groupStore.updateGroup(group.id, { displayName: dn });
        if (mids !== undefined) await groupStore.setGroupMembers(group.id, mids);
        const updated = await groupStore.findGroupById(group.id);
        const finalMemberIds = updated ? await groupStore.listGroupMemberIds(updated.id) : (mids ?? memberIds);
        return { status: 200, body: groupToScimResource(updated ?? group, finalMemberIds, baseUrl) };
      }
      if (upperMethod === "DELETE") {
        await deprovisionGroup(groupStore, group.id, {
          realtimeWebhook: ctx.webhookStore
            ? { organizationId: ctx.organizationId, webhookStore: ctx.webhookStore, webhookDeliveryOptions: ctx.webhookDeliveryOptions }
            : undefined,
        });
        return { status: 204 };
      }
      return scimError("Method not allowed", 405);
    }

    if (upperMethod === "GET") {
      const all = await groupStore.listGroupsByOrganization(organizationId);
      const startIndex = Math.max(0, parseInt(query.startIndex ?? "1", 10) - 1);
      const count = parseInt(query.count ?? String(all.length), 10);
      const totalResults = all.length;
      const page = all.slice(startIndex, startIndex + (count || totalResults));
      const resources: Record<string, unknown>[] = [];
      for (const g of page) {
        const memberIds = await groupStore.listGroupMemberIds(g.id);
        resources.push(groupToScimResource(g, memberIds, baseUrl));
      }
      return {
        status: 200,
        body: {
          schemas: [LIST_RESPONSE_SCHEMA],
          totalResults,
          startIndex: startIndex + 1,
          count: resources.length,
          Resources: resources,
        },
      };
    }

    if (upperMethod === "POST") {
      const b = body as Record<string, unknown> | undefined;
      if (!b) return scimError("Invalid request body", 400);
      const displayName = (b.displayName as string) ?? "";
      const externalId = (b.externalId as string) ?? `grp_${Date.now()}`;
      const members = (b.members as Array<{ value: string }>) ?? [];
      const memberIds: string[] = [];
      for (const m of members) {
        if (typeof m?.value === "string") {
          const u = await userStore.findById(m.value) ?? await userStore.findByExternalId(m.value);
          if (u?.active) memberIds.push(u.id);
        }
      }
      const result = await syncGroup(
        groupStore,
        { externalId, displayName, memberIds },
        {
          organizationId,
          realtimeWebhook: ctx.webhookStore
            ? { organizationId, webhookStore: ctx.webhookStore, webhookDeliveryOptions: ctx.webhookDeliveryOptions }
            : undefined,
        }
      );
      const location = baseUrl ? `${baseUrl.replace(/\/$/, "")}/Groups/${result.group.id}` : undefined;
      const finalMemberIds = await groupStore.listGroupMemberIds(result.group.id);
      return {
        status: result.created ? 201 : 200,
        headers: location ? { Location: location } : undefined,
        body: groupToScimResource(result.group, finalMemberIds, baseUrl),
      };
    }

    return scimError("Method not allowed", 405);
  }

  if (resource === "Bulk" && upperMethod === "POST") {
    const b = body as ScimBulkRequest | undefined;
    if (!b || !Array.isArray(b.Operations)) return scimError("Bulk request requires Operations array", 400);
    const bulkResponse = await processBulkRequest({
      request: b,
      userStore,
      groupStore,
      organizationId,
      baseUrl,
      maxOperations: ctx.bulkMaxOperations,
      webhookStore: ctx.webhookStore,
      webhookDeliveryOptions: ctx.webhookDeliveryOptions,
      scimUserAttributeMapping: ctx.scimUserAttributeMapping,
      isAllowedEmail: ctx.isAllowedEmail,
    });
    return { status: 200, body: bulkResponse };
  }

  if (!resource || normalized === "") {
    return scimError("Not found", 404);
  }

  return scimError("Not found", 404);
}
