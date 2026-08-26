import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MarketplaceController } from './marketplace.controller';
import { DexService } from './dex.service';
import { DexScheduler } from './dex.scheduler';
import { LiquidityService } from './liquidity.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [MarketplaceController],
  providers: [DexService, LiquidityService, DexScheduler],
  exports: [DexService, LiquidityService],
})
export class MarketplaceModule {}
