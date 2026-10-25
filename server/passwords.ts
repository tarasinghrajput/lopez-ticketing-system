import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Credential, State } from '../shared/types.js';
import { demoAccounts } from '../shared/demo-accounts.js';

export function seedDemoCredentials(state: State) {
  for (const account of Object.values(demoAccounts)) {
    const user = state.users.find((u) => u.id === account.id);
    if (!user || state.credentials.some((c) => c.userId === user.id)) continue;
    const salt = randomBytes(16).toString('hex');
    state.credentials.push({
      id: user.id,
      userId: user.id,
      salt,
      passwordHash: scryptSync(account.password, salt, 64).toString('hex'),
    });
  }
}

export async function verifyPassword(password: string, credential?: Credential) {
  // Perform a password derivation for unknown users too, without exposing user existence.
  const salt = credential?.salt ?? 'unknown-account-constant-salt';
  const expected = Buffer.from(credential?.passwordHash ?? '00'.repeat(64), 'hex');
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, derived) => (error ? reject(error) : resolve(derived)));
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual) && !!credential;
}
