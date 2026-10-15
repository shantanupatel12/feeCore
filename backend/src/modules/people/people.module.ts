import { Module } from '@nestjs/common';
import { PeopleService } from './people.service.js';
import { PeopleController } from './people.controller.js';
import { PersonStatementController } from './person-statement.controller.js';
import { CustomFieldsService } from './custom-fields.service.js';
import { CustomFieldsController } from './custom-fields.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [PeopleController, CustomFieldsController, PersonStatementController],
  providers: [PeopleService, CustomFieldsService],
  exports: [PeopleService, CustomFieldsService],
})
export class PeopleModule {}
