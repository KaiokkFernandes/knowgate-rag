import { Injectable } from '@nestjs/common';
import { hash, parseOptions, verify } from '@node-rs/argon2';

/**
 * Argon2id with the OWASP minimum parameters (19 MiB memory, 2 iterations, 1 lane).
 * The library defaults to Argon2id; the algorithm enum is a `const enum` that cannot be
 * imported with isolatedModules, so the tests assert the `$argon2id$` prefix instead.
 * Hashes are PHC strings: algorithm, parameters and salt travel with the hash.
 */
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Precomputed hash used to spend the same time when the e-mail does not exist. */
  private readonly dummyHash: Promise<string> = this.hash('dummy-password-for-timing');

  hash(password: string): Promise<string> {
    return hash(password, PARAMS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }

  /** Runs a verification that always fails, so "unknown e-mail" costs as much as "wrong password". */
  async verifyDummy(password: string): Promise<false> {
    await verify(await this.dummyHash, password);
    return false;
  }

  /** True when the stored hash was made with weaker parameters than the current ones. */
  needsRehash(passwordHash: string): boolean {
    const options = parseOptions(passwordHash);
    return (
      options.memoryCost < PARAMS.memoryCost ||
      options.timeCost < PARAMS.timeCost ||
      options.parallelism !== PARAMS.parallelism
    );
  }
}
