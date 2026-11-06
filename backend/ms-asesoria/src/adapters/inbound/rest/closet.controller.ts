import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IClosetUseCase, CLOSET_USE_CASE, CreateClosetItemDto, UpdateClosetItemDto } from '../../../ports/inbound/closet.use-case.port';
import { ClosetItem } from '../../../domain/entities/closet-item.entity';
import { AuthenticatedUser, CurrentUser, isStaff } from '../../../common/security/auth.decorators';

@Controller('closet')
export class ClosetController {
  constructor(
    @Inject(CLOSET_USE_CASE)
    private readonly closetUseCase: IClosetUseCase,
  ) {}

  @Post()
  async create(@Body() dto: CreateClosetItemDto, @CurrentUser() user: AuthenticatedUser): Promise<ClosetItem> {
    // Un cliente solo puede agregar prendas a su propio clóset
    const clientId = isStaff(user) && dto.clientId ? dto.clientId : user.id;
    return this.closetUseCase.addItem({ ...dto, clientId });
  }

  @Get('client/:clientId')
  async getByClient(
    @Param('clientId') clientId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClosetItem[]> {
    this.assertAccess(clientId, user);
    return this.closetUseCase.getItemsByClient(clientId);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<ClosetItem> {
    return this.findOwned(id, user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateClosetItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClosetItem> {
    await this.findOwned(id, user);
    return this.closetUseCase.updateItem(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<{ success: boolean }> {
    await this.findOwned(id, user);
    const success = await this.closetUseCase.removeItem(id);
    return { success };
  }

  private async findOwned(id: string, user: AuthenticatedUser): Promise<ClosetItem> {
    const item = await this.closetUseCase.getItemById(id);
    if (!item) {
      throw new NotFoundException(`Prenda no encontrada con ID: ${id}`);
    }
    this.assertAccess(item.clientId, user);
    return item;
  }

  private assertAccess(clientId: string, user: AuthenticatedUser): void {
    if (!isStaff(user) && clientId !== user.id) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'No puede acceder al clóset de otro cliente.' });
    }
  }
}
