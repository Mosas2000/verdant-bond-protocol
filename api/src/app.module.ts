import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { BondsModule } from './bonds/bonds.module';
import { ProjectsModule } from './projects/projects.module';
import { OracleModule } from './oracle/oracle.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { AuthModule } from './auth/auth.module';
import { StellarModule } from './stellar/stellar.module';
import { SeedModule } from './seed/seed.module';
import { ConfigModule } from './config/config.module';
import { Rfc7807ExceptionFilter } from './common/filters/rfc7807-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';

@Module({
  imports: [
    CommonModule,
    ConfigModule,
    BondsModule,
    ProjectsModule,
    OracleModule,
    MarketplaceModule,
    AuthModule,
    StellarModule,
    SeedModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: Rfc7807ExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
