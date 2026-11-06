/**
 * Entidad de Dominio: Prenda del Clóset Virtual (CU-15)
 */
export class ClosetItem {
  id: string;
  clientId: string;
  name: string;
  category: 'TOP' | 'BOTTOM' | 'SHOES' | 'ACCESSORY' | 'OUTERWEAR';
  color: string;
  season: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER' | 'ALL_SEASON';
  imageUrl: string;
  tags: string[];
  createdAt: Date;

  constructor(partial: Partial<ClosetItem>) {
    Object.assign(this, partial);
    this.createdAt = partial.createdAt || new Date();
  }
}
