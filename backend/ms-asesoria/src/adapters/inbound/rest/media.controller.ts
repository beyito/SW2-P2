import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Public } from '../../../common/security/auth.decorators';
import { MAX_IMAGE_BYTES, MediaService } from '../services/media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async upload(@UploadedFile() file?: { buffer: Buffer }): Promise<{ id: string; url: string }> {
    return this.media.upload(file?.buffer);
  }

  // Público para poder usarse en <img>; el identificador aleatorio de 128 bits no se puede adivinar
  @Public()
  @Get(':id')
  async get(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const image = await this.media.get(id);
    response
      .set({
        'Content-Type': image.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      })
      .send(image.data);
  }
}
