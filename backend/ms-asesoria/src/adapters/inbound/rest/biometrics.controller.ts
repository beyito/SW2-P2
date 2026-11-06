import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../../common/security/auth.decorators';
import {
  BIOMETRICS_USE_CASE,
  IBiometricsUseCase,
  SaveDiagnosisDto,
} from '../../../ports/inbound/biometrics.use-case.port';

/**
 * Datos biométricos del propio usuario (CU-13). El cliente siempre sale del token:
 * ni siquiera el personal del salón puede leer o borrar los de otra persona.
 */
@Controller('biometrics')
export class BiometricsController {
  constructor(
    @Inject(BIOMETRICS_USE_CASE)
    private readonly biometrics: IBiometricsUseCase,
  ) {}

  @Get('consent')
  getConsent(@CurrentUser() user: AuthenticatedUser) {
    return this.biometrics.getConsent(user.id);
  }

  @Post('consent')
  grantConsent(@Body() body: { policyVersion: string }, @CurrentUser() user: AuthenticatedUser) {
    return this.biometrics.grantConsent(user.id, body?.policyVersion);
  }

  @Delete('consent')
  revokeConsent(@CurrentUser() user: AuthenticatedUser) {
    return this.biometrics.revokeConsent(user.id);
  }

  @Post('diagnoses')
  saveDiagnosis(@Body() dto: SaveDiagnosisDto, @CurrentUser() user: AuthenticatedUser) {
    return this.biometrics.saveDiagnosis(user.id, dto ?? ({} as SaveDiagnosisDto));
  }

  @Get('diagnoses')
  listDiagnoses(@CurrentUser() user: AuthenticatedUser) {
    return this.biometrics.listDiagnoses(user.id);
  }

  @Delete('diagnoses')
  async deleteAll(@CurrentUser() user: AuthenticatedUser) {
    return { deletedDiagnoses: await this.biometrics.deleteAllDiagnoses(user.id) };
  }

  @Delete('diagnoses/:id')
  async deleteOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (!(await this.biometrics.deleteDiagnosis(user.id, id))) {
      throw new NotFoundException('Diagnóstico no encontrado.');
    }
    return { success: true };
  }
}
