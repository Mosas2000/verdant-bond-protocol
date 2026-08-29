import { Module } from '@nestjs/common';
import { BondsController } from './bonds.controller';
import { BondsService } from './bonds.service';
import { OracleModule } from '../oracle/oracle.module';

@Module({
  imports: [OracleModule],
  controllers: [BondsController],
  providers: [BondsService],
})
export class BondsModule {}
