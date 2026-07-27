import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { HealthService, ReadinessReport } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe.' })
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @ApiOperation({
    summary:
      'Readiness probe: Postgres is fatal; Redis/MinIO are informational in dev.',
  })
  async readiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessReport> {
    const { httpStatus, report } = await this.health.readiness();
    res.status(httpStatus);
    return report;
  }
}
