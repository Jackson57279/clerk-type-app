export interface DeprovisionOptions {
  hard?: boolean;
}

export interface SoftDeletableStore {
  findById(id: string): Promise<{ id: string } | null>;
  softDelete(id: string): Promise<void>;
  hardDelete(id: string): Promise<void>;
}

export async function deactivateEntity(
  store: SoftDeletableStore,
  id: string
): Promise<void> {
  const entity = await store.findById(id);
  if (!entity) return;
  await store.softDelete(id);
}

export async function deleteEntity(
  store: SoftDeletableStore,
  id: string
): Promise<void> {
  const entity = await store.findById(id);
  if (!entity) return;
  await store.hardDelete(id);
}

export async function deprovisionEntity(
  store: SoftDeletableStore,
  id: string,
  options: DeprovisionOptions = {}
): Promise<void> {
  const entity = await store.findById(id);
  if (!entity) return;
  if (options.hard) {
    await store.hardDelete(id);
  } else {
    await store.softDelete(id);
  }
}
