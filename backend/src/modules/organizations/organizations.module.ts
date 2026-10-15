import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import { TerminologyController } from './terminology.controller.js';
import { TerminologyService } from './terminology.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController, TerminologyController],
  providers: [OrganizationsService, TerminologyService],
  exports: [OrganizationsService, TerminologyService],
})
export class OrganizationsModule {}