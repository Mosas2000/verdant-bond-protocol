import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MarketplaceController } from './marketplace.controller';
import { DexService } from './dex.service';
import { DexScheduler } from './dex.scheduler';
import { DexReconciliationService } from './dex.reconciliation.service';
import { DexReconciliationScheduler } from './dex.reconciliation.scheduler';
import { LiquidityService } from './liquidity.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [MarketplaceController],
  providers: [
    DexService,
    LiquidityService,
    DexScheduler,
    DexReconciliationService,
    DexReconciliationScheduler,
  ],
  exports: [DexService, LiquidityService, DexReconciliationService],
})
export class MarketplaceModule {}
