import {
  Controller, Get, Post, Body, Param, Req,
  HttpCode, HttpStatus, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { OracleService } from './oracle.service';
import { OracleMonitoringService } from './oracle.monitoring.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ProviderGuard } from '../common/guards/provider.guard';
import { SubmitReportDto } from './dto/submit-report.dto';
import { ChallengeDto } from './dto/challenge.dto';
import { RegisterProviderDto } from './dto/register-provider.dto';
import { ListOracleIncidentsDto } from './dto/list-oracle-incidents.dto';
import { ResolveOracleIncidentDto } from './dto/resolve-oracle-incident.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { IntentGuard } from '../common/guards/intent.guard';
import { RequireIntent } from '../common/decorators/require-intent.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import {
  ReportResponse,
  ChallengeResponse,
  ProviderResponse,
  ProviderStatsWithHistory,
  OracleStalenessReport,
} from './interfaces/oracle.interface';
import { OracleIncident } from './interfaces/oracle-incident.interface';
import { PaginatedResponse } from '../common/dto/pagination.dto';

@Controller('oracle')
export class OracleController {
  constructor(
    private readonly oracleService: OracleService,
    private readonly monitoringService: OracleMonitoringService,
    private readonly incidents: OracleIncidentRepository,
  ) {}

  @Post('reports')
  @UseGuards(JwtAuthGuard, ProviderGuard)
  @HttpCode(HttpStatus.CREATED)
  async submitReport(
    @Body() dto: SubmitReportDto,
    @Req() req: any,
  ): Promise<ReportResponse> {
    const providerAddress = req.user.walletAddress;
    return this.oracleService.submitReport(dto, providerAddress);
  }

  @Get('reports/:projectId')
  async getProjectReports(
    @Param('projectId') projectId: string,
  ): Promise<ReportResponse[]> {
    return this.oracleService.getProjectReports(projectId);
  }

  @Post('challenge/:reportId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async challengeReport(
    @Param('reportId', ParseIntPipe) reportId: number,
    @Body() dto: ChallengeDto,
    @Req() req: any,
  ): Promise<ChallengeResponse> {
    const challengerAddress = req.user.walletAddress;
    return this.oracleService.challengeReport(reportId, dto, challengerAddress);
  }

  @Post('providers')
  @UseGuards(JwtAuthGuard, AdminGuard, IntentGuard)
  @RequireIntent('register_provider', 'id', 'global')
  @RateLimit({ type: 'oracle' })
  @HttpCode(HttpStatus.CREATED)
  async registerProvider(@Body() dto: RegisterProviderDto): Promise<ProviderResponse> {
    return this.oracleService.registerProvider(dto);
  }

  @Get('providers')
  async listProviders(): Promise<ProviderResponse[]> {
    return this.oracleService.listProviders();
  }

  @Get('stats/:providerAddress')
  async getProviderStats(
    @Param('providerAddress') providerAddress: string,
  ): Promise<ProviderStatsWithHistory> {
    return this.oracleService.getProviderStats(providerAddress);
  }

  @Get('monitoring/staleness')
  async staleness(): Promise<OracleStalenessReport> {
    return this.monitoringService.computeStaleness();
  }

  /**
   * Operator-facing incident surface (issue #95). Admin-guarded like the
   * other privileged actions in this API (e.g. `BondsController`'s
   * `sweep-undistributed` and `admin.guard.ts`'s own doc comment): incident
   * acknowledgement/resolution is operational state, not public data.
   */
  @Get('incidents')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async listIncidents(
    @Query() query: ListOracleIncidentsDto,
  ): Promise<PaginatedResponse<OracleIncident>> {
    return this.incidents.findMany(query.page, query.limit, query.status);
  }

  @Post('incidents/:id/acknowledge')
  @UseGuards(JwtAuthGuard, AdminGuard, IntentGuard)
  @RequireIntent('acknowledge_incident', 'id')
  @HttpCode(HttpStatus.OK)
  async acknowledgeIncident(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<OracleIncident> {
    const acknowledgedBy = req.headers['x-wallet-address'] as string || '';
    return this.incidents.acknowledge(id, acknowledgedBy);
  }

  @Post('incidents/:id/resolve')
  @UseGuards(JwtAuthGuard, AdminGuard, IntentGuard)
  @RequireIntent('resolve_incident', 'id')
  @HttpCode(HttpStatus.OK)
  async resolveIncident(
    @Param('id') id: string,
    @Body() dto: ResolveOracleIncidentDto,
    @Req() req: any,
  ): Promise<OracleIncident> {
    const resolvedBy = req.headers['x-wallet-address'] as string || '';
    return this.incidents.resolve(id, resolvedBy, dto.resolutionNote);
  }
}
