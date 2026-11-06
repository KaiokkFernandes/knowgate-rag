import { hash } from '@node-rs/argon2';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id and the OWASP parameters, salted (PHC string)', async () => {
    const first = await service.hash('correct horse battery');
    const second = await service.hash('correct horse battery');

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second); // random salt per hash
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await service.hash('correct horse battery');

    await expect(service.verify(stored, 'correct horse battery')).resolves.toBe(true);
    await expect(service.verify(stored, 'wrong password')).resolves.toBe(false);
  });

  it('dummy verification always fails', async () => {
    await expect(service.verifyDummy('dummy-password-for-timing')).resolves.toBe(false);
  });

  it('flags hashes made with weaker parameters for rehash', async () => {
    const weak = await hash('pw', { memoryCost: 4096, timeCost: 1, parallelism: 1 });

    expect(service.needsRehash(weak)).toBe(true);
    expect(service.needsRehash(await service.hash('pw'))).toBe(false);
  });
});
