import { Injectable } from '@nestjs/common';
import { CatalogRepository } from './catalog.repository';
import type { CatalogResponse } from './catalog.types';

@Injectable()
export class CatalogService {
  constructor(private readonly catalogRepository: CatalogRepository) {}

  async list(): Promise<CatalogResponse> {
    return { items: await this.catalogRepository.list() };
  }
}
