import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Module({
  imports: [
    // Login rate limiting (per-IP). The ThrottlerGuard is bound only on the
    // login route — account lockout covers per-account brute force.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
