import bcrypt from "bcrypt";

const DEFAULT_ROUNDS = 12;

export async function hashPassword(
  plain: string,
  rounds?: number,
): Promise<string> {
  return bcrypt.hash(plain, rounds ?? DEFAULT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
