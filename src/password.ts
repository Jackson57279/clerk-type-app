import * as argon2 from "argon2";

const MEMORY_KB = 64 * 1024;
const ITERATIONS = 3;
const PARALLELISM = 4;

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, {
    type: argon2.argon2id,
    memoryCost: MEMORY_KB,
    timeCost: ITERATIONS,
    parallelism: PARALLELISM,
  });
}

export async function verifyPassword(
  hash: string,
  plainPassword: string
): Promise<boolean> {
  return argon2.verify(hash, plainPassword);
}
