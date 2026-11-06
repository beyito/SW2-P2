import { Controller, Get } from '@nestjs/common';
import { Public } from '../../../common/security/auth.decorators';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'UP', service: 'ms-asesoria' };
  }
}
