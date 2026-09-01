import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OracleService } from './oracle.service';
import { OracleMonitoringService } from './oracle.monitoring.service';
import { VerraProvider } from './providers/verra.provider';
import { SatelliteProvider } from './providers/satellite.provider';
import { BlueCarbonProvider } from './providers/blue-carbon.provider';

@Injectable()
export class OracleScheduler {
  private readonly logger = new Logger(OracleScheduler.name);

  constructor(
    private readonly oracleService: OracleService,
    private readonly monitoringService: OracleMonitoringService,
    private readonly verraProvider: VerraProvider,
    private readonly satelliteProvider: SatelliteProvider,
    private readonly blueCarbonProvider: BlueCarbonProvider,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollOracleData(): Promise<void> {
    this.logger.log('Oracle poll cycle started');

    try {
      const providers = [
        this.verraProvider,
        this.satelliteProvider,
        this.blueCarbonProvider,
      ];

      for (const provider of providers) {
        this.logger.log(`Polling provider: ${provider.name}`);
      }
    } catch (error) {
      this.logger.error(`Oracle poll cycle error: ${error.message}`);
    }

    this.logger.log('Oracle poll cycle completed');
  }

  @Cron('0 */6 * * *')
  async monitorProviderReliability(): Promise<void> {
    this.logger.log('Oracle reliability monitoring cycle started');

    try {
      const summary = await this.monitoringService.syncIncidents();
      this.logger.log(
        `Oracle reliability monitoring cycle completed: ${summary.created} incident(s) created, ` +
          `${summary.updated} updated, ${summary.escalated} escalated`,
      );

      const anomalyReport = await this.monitoringService.computeCrossSourceAnomalies();
      const flagged = anomalyReport.anomalies.filter(
        (a) => a.kind === 'outlier' || a.kind === 'conflicting_sources',
      );
      if (flagged.length > 0) {
        this.logger.warn(
          `Oracle cross-source anomalies detected (#158): ${flagged.length} project-period(s) ` +
            `flagged (${flagged.filter((a) => a.severity === 'critical').length} critical) for review.`,
        );
      }
    } catch (error) {
      this.logger.error(`Oracle reliability monitoring error: ${error.message}`);
    }
  }
}
