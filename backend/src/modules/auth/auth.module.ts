import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

const isProduction = process.env.NODE_ENV === 'production';
const configuredJwtSecret = process.env.JWT_SECRET;

const DEV_DEFAULT_SECRETS = [
  'feecore-super-secret-key-change-in-prod-2026',
  'feecore-dev-secret-super-secure-key-32-chars-min',
];

if (isProduction && (!configuredJwtSecret || DEV_DEFAULT_SECRETS.includes(configuredJwtSecret) || configuredJwtSecret.length < 32)) {
  throw new Error('FATAL: In production, JWT_SECRET must be set via environment variable to a secure string with at least 32 characters.');
}

@Module({
  imports: [
    JwtModule.register({
      secret: configuredJwtSecret || 'feecore-super-secret-key-change-in-prod-2026',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    /*
     * Registered globally so authentication, tenant isolation and RBAC
     * cannot be bypassed by a controller that forgets @UseGuards().
     * Routes opt out explicitly with @Public() and restrict roles with
     * @Roles(). The per-controller @UseGuards() declarations are kept
     * and remain harmless duplicates.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
