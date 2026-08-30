import { SetMetadata } from '@nestjs/common';

export const REQUIRE_INTENT_KEY = 'requireIntent';

export interface RequireIntentMeta {
  action: string;
  /** Route param (or body) key that identifies the action's target. */
  targetKey?: string;
  /** Fixed target value when there is no per-request target (e.g. global). */
  fixedTarget?: string;
}

/**
 * Marks an admin endpoint as requiring a signed step-up intent (#115).
 *
 * @param action   the intent action name (e.g. 'issue_bond', 'distribute_coupon').
 * @param targetKey route param key whose value becomes the intent target (default 'id').
 * @param fixedTarget when set, the target is this constant (e.g. 'global').
 */
export const RequireIntent = (action: string, targetKey = 'id', fixedTarget?: string): MethodDecorator => {
  return SetMetadata(REQUIRE_INTENT_KEY, { action, targetKey, fixedTarget } as RequireIntentMeta);
};
