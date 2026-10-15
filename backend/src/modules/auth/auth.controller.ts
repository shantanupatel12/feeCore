import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto, RegisterUserDto } from './dto/auth.dto.js';
import { Public } from './decorators/public.decorator.js';

@Controller('tenants/:tenantId/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Login for an existing user of the given tenant.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Param('tenantId') tenantId: string,
    @Body() dto: LoginDto,
  ) {
    return this.authService.login(tenantId, dto);
  }

  /**
   * Register the very first admin for a newly-created tenant.
   * Will reject if the tenant already has users.
   */
  @Public()
  @Post('register-first-admin')
  @HttpCode(HttpStatus.CREATED)
  async registerFirstAdmin(
    @Param('tenantId') tenantId: string,
    @Body() dto: RegisterUserDto,
  ) {
    return this.authService.registerFirstAdmin(tenantId, dto);
  }
}
