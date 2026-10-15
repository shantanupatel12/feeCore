import { IsOptional, IsDateString } from 'class-validator';

export class DashboardQueryDto {
  /**
   * Anchors the "today" KPIs so the figures are reproducible in a
   * test or an audit replay. Defaults to the server's current date.
   */
  @IsOptional()
  @IsDateString()
  asOf?: string;
}