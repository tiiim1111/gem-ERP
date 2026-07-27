import * as argon2 from 'argon2';

/**
 * OWASP-recommended argon2id parameters — identical to the ones used by the
 * @gemerp/database seed so seeded and API-created credentials are uniform.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Static argon2id hash of a random throwaway value, verified against when the
 * email does not exist — keeps unknown-user and wrong-password timings
 * comparable (user-enumeration resistance).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$K1lWQkhZbUR3ZFd0c1RQVA$3n0PxCVoJmttSFhoIvIPBu3sMCLQtQwvE3hp2QQqCfE';

export async function burnTimingNoise(plain: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plain);
}
