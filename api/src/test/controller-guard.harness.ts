import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { KycGuard } from '../common/guards/kyc.guard';
import { ProviderGuard } from '../common/guards/provider.guard';
import { fakeJwtAuthGuard, fakeAdminGuard, fakeKycGuard, fakeProviderGuard } from './guard-role-mocks';

/**
 * Boots a single controller with all four auth guards replaced by header-driven
 * fakes so behavioural role tests can run without a database or passport. The
 * real guard wiring is still asserted by `route-authorization.matrix.spec.ts`.
 */
export async function buildControllerApp(
  controller: any,
  providers: any[],
): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [controller],
    providers,
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(fakeJwtAuthGuard)
    .overrideGuard(AdminGuard)
    .useValue(fakeAdminGuard)
    .overrideGuard(KycGuard)
    .useValue(fakeKycGuard)
    .overrideGuard(ProviderGuard)
    .useValue(fakeProviderGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}
