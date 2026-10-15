import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';
import { PeopleModule } from '../people/people.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule, PeopleModule],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
