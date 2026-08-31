import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IntentService } from '../services/intent.service';
import { REQUIRE_INTENT_KEY, RequireIntentMeta } from '../decorators/require-intent.decorator';

/**
 * Enforces signed admin step-up intents on endpoints decorated with
 * @RequireIntent (#115). Runs after AdminGuard, so the caller is already a
 * confirmed admin; this guard additionally proves a fresh, deliberate,
 * single-use authorisation for the specific action + target.
 */
@Injectable()
export class IntentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly intentService: IntentService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequireIntentMeta | undefined>(REQUIRE_INTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequireIntent on this route: not protected by step-up verification.
    if (!meta) return true;

    const request = context.switchToHttp().getRequest();
    const raw = this.extractIntent(request);

    const target = meta.fixedTarget ?? String(request.params?.[meta.targetKey ?? 'id'] ?? request.body?.[meta.targetKey ?? 'id'] ?? 'global');

    await this.intentService.verify(raw, meta.action, target);
    return true;
  }

  private extractIntent(request: any): any {
    const header = request.headers?.['x-admin-intent'];
    if (header) {
      try {
        return typeof header === 'string' ? JSON.parse(header) : header;
      } catch {
        throw new UnauthorizedException('Admin intent header is not valid JSON');
      }
    }
    if (request.body?.adminIntent) {
      return request.body.adminIntent;
    }
    return undefined;
  }
}
