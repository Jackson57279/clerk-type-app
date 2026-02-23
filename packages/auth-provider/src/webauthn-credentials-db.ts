import type { Pool } from "pg";
import type { PasskeyStore, StoredPasskey } from "./passkeys.js";

function credentialIdToBytes(credentialId: string): Buffer {
  return Buffer.from(credentialId, "base64url");
}

function bytesToCredentialId(buf: Buffer): string {
  return buf.toString("base64url");
}

interface WebauthnCredentialRow {
  user_id: string;
  credential_id: Buffer;
  public_key: Buffer;
  sign_count: number;
  device_type: string | null;
  friendly_name: string | null;
  is_synced: boolean;
  last_used_at: Date | null;
}

function rowToStoredPasskey(row: WebauthnCredentialRow): StoredPasskey {
  return {
    userId: row.user_id,
    credentialId: bytesToCredentialId(row.credential_id),
    publicKey: new Uint8Array(row.public_key),
    counter: row.sign_count,
    deviceType: (row.device_type as StoredPasskey["deviceType"]) ?? "singleDevice",
    backedUp: row.is_synced,
    webauthnUserID: row.user_id,
    friendlyName: row.friendly_name ?? undefined,
    deviceInfo: row.device_type ?? undefined,
    lastUsedAt: row.last_used_at?.toISOString(),
  };
}

export interface PostgresPasskeyStoreOptions {
  pool: Pool;
}

export function createPostgresPasskeyStore(
  options: PostgresPasskeyStoreOptions
): PasskeyStore {
  const { pool } = options;

  return {
    async listByUserId(userId: string): Promise<StoredPasskey[]> {
      const result = await pool.query(
        `SELECT user_id, credential_id, public_key, sign_count, device_type, friendly_name, is_synced, last_used_at
         FROM webauthn_credentials WHERE user_id = $1`,
        [userId]
      );
      return (result.rows as WebauthnCredentialRow[]).map(rowToStoredPasskey);
    },

    async findByCredentialId(
      userId: string,
      credentialId: string
    ): Promise<StoredPasskey | null> {
      const credBytes = credentialIdToBytes(credentialId);
      const result = await pool.query(
        `SELECT user_id, credential_id, public_key, sign_count, device_type, friendly_name, is_synced, last_used_at
         FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2`,
        [userId, credBytes]
      );
      const row = result.rows[0];
      return row ? rowToStoredPasskey(row as WebauthnCredentialRow) : null;
    },

    async findByCredentialIdGlobal(
      credentialId: string
    ): Promise<StoredPasskey | null> {
      const credBytes = credentialIdToBytes(credentialId);
      const result = await pool.query(
        `SELECT user_id, credential_id, public_key, sign_count, device_type, friendly_name, is_synced, last_used_at
         FROM webauthn_credentials WHERE credential_id = $1`,
        [credBytes]
      );
      const row = result.rows[0];
      return row ? rowToStoredPasskey(row as WebauthnCredentialRow) : null;
    },

    async save(credential: StoredPasskey): Promise<void> {
      const credBytes = credentialIdToBytes(credential.credentialId);
      const publicKeyBuf = Buffer.from(credential.publicKey);
      await pool.query(
        `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, sign_count, device_type, friendly_name, is_synced)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, credential_id) DO NOTHING`,
        [
          credential.userId,
          credBytes,
          publicKeyBuf,
          credential.counter,
          credential.deviceType,
          credential.friendlyName ?? null,
          credential.backedUp,
        ]
      );
    },

    async updateCounter(
      userId: string,
      credentialId: string,
      counter: number
    ): Promise<void> {
      const credBytes = credentialIdToBytes(credentialId);
      await pool.query(
        `UPDATE webauthn_credentials SET sign_count = $1 WHERE user_id = $2 AND credential_id = $3`,
        [counter, userId, credBytes]
      );
    },

    async updateLastUsed(userId: string, credentialId: string): Promise<void> {
      const credBytes = credentialIdToBytes(credentialId);
      await pool.query(
        `UPDATE webauthn_credentials SET last_used_at = NOW() WHERE user_id = $1 AND credential_id = $2`,
        [userId, credBytes]
      );
    },

    async delete(userId: string, credentialId: string): Promise<void> {
      const credBytes = credentialIdToBytes(credentialId);
      await pool.query(
        `DELETE FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2`,
        [userId, credBytes]
      );
    },
  };
}
