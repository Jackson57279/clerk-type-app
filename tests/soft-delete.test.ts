import { describe, it, expect } from "vitest";
import {
  deprovisionEntity,
  type DeprovisionOptions,
  type SoftDeletableStore,
} from "../src/soft-delete.js";

interface Entity {
  id: string;
  name: string;
  active: boolean;
}

function memoryStore(initial: Entity[] = []): SoftDeletableStore {
  const store = new Map<string, Entity>();
  for (const e of initial) store.set(e.id, e);
  return {
    async findById(id: string) {
      return store.get(id) ?? null;
    },
    async softDelete(id: string) {
      const e = store.get(id);
      if (e) store.set(id, { ...e, active: false });
    },
    async hardDelete(id: string) {
      store.delete(id);
    },
  };
}

describe("deprovisionEntity", () => {
  it("soft-deletes (deactivates) by default", async () => {
    const store = memoryStore([
      { id: "e1", name: "Entity 1", active: true },
    ]);
    await deprovisionEntity(store, "e1");
    const found = await store.findById("e1");
    expect(found).not.toBeNull();
    expect(found?.active).toBe(false);
  });

  it("hard-deletes when options.hard is true", async () => {
    const store = memoryStore([
      { id: "e1", name: "Entity 1", active: true },
    ]);
    await deprovisionEntity(store, "e1", { hard: true });
    const found = await store.findById("e1");
    expect(found).toBeNull();
  });

  it("is no-op when entity does not exist", async () => {
    const store = memoryStore();
    await expect(deprovisionEntity(store, "nonexistent")).resolves.toBeUndefined();
  });

  it("accepts DeprovisionOptions with hard: false for explicit soft delete", async () => {
    const store = memoryStore([
      { id: "e1", name: "Entity 1", active: true },
    ]);
    const options: DeprovisionOptions = { hard: false };
    await deprovisionEntity(store, "e1", options);
    const found = await store.findById("e1");
    expect(found).not.toBeNull();
    expect(found?.active).toBe(false);
  });
});
