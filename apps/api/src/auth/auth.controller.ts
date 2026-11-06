import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  type AuthResponse,
  type LoginRequest,
  loginRequestSchema,
  type RegisterRequest,
  registerRequestSchema,
} from '@knowgate/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './decorators';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
  ): Promise<AuthResponse> {
    const { tokens } = await this.auth.register(body);
    return tokens;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
  ): Promise<AuthResponse> {
    const { tokens } = await this.auth.login(body);
    return tokens;
  }
}
