import { BadRequestException } from '@nestjs/common';
import { registerRequestSchema } from '@knowgate/shared';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(registerRequestSchema);

  it('returns the parsed (transformed) value', () => {
    expect(pipe.transform({ email: ' Ana@Acme.COM ', password: '12345678', name: 'Ana' })).toEqual({
      email: 'ana@acme.com',
      password: '12345678',
      name: 'Ana',
    });
  });

  it('throws 400 with paths and messages, without echoing the submitted values', () => {
    const secret = 'short';
    let error: unknown;
    try {
      pipe.transform({ email: 'not-an-email', password: secret, name: 'Ana' });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse();
    expect(body).toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
        expect.objectContaining({ path: 'password' }),
      ]) as unknown,
    });
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
