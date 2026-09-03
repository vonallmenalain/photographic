import type { Doc } from '../db';

/**
 * Product catalogue (Sortiment) shared by the parent shop, the cart/order
 * logic and the admin tools.
 *
 * Every product has a coarse `type` that drives the fulfilment logic and a
 * finer `kind` that drives the presentation:
 *
 *  - type `digital`: the original file as a download. Bought at most once per
 *    photo, never shipped.
 *  - type `print`  : a physical product (photo print, sticker sheet, magnet
 *    set) that is produced and sent by post. Orders with such a product need a
 *    delivery address and land in status "Pendent" until they are shipped.
 *
 * Pricing is tiered per cart line (photo × product): the first unit costs
 * `price_cents`, every further unit of the SAME photo in the SAME product
 * costs `additional_price_cents` (falls back to the unit price when unset),
 * e.g. "13×18 cm: 15.-, jedes weitere +4.-".
 *
 * Photo prints include the digital file (`includes_digital`): paying for such
 * a print creates the same download grant a digital purchase would, and a
 * separate digital line for the same photo becomes redundant.
 *
 * `scope` restricts a product to certain photos: stickers and magnets are only
 * offered for individual portraits, not for group/class photos.
 */
export type ProductType = 'digital' | 'print';
export type ProductKind = 'digital' | 'photo' | 'sticker' | 'magnet';
export type ProductScope = 'all' | 'portrait' | 'group';

export const PRODUCT_KINDS: readonly ProductKind[] = ['digital', 'photo', 'sticker', 'magnet'];
export const PRODUCT_SCOPES: readonly ProductScope[] = ['all', 'portrait', 'group'];

/** Raw Firestore document (older documents lack the newer optional fields). */
export interface ProductDoc {
  code?: string;
  name: string;
  description?: string;
  type: string;
  kind?: string;
  price_cents: number;
  additional_price_cents?: number | null;
  includes_digital?: number;
  scope?: string;
  currency?: string;
  active: number;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

/** Normalised view with every field filled in (legacy documents get defaults). */
export interface ProductView {
  id: string;
  code: string;
  name: string;
  description: string;
  type: ProductType;
  kind: ProductKind;
  price_cents: number;
  additional_price_cents: number | null;
  includes_digital: boolean;
  scope: ProductScope;
  currency: string;
  active: boolean;
  sort_order: number;
}

export function productView(doc: Doc<ProductDoc>): ProductView {
  const type: ProductType = doc.type === 'print' ? 'print' : 'digital';
  const rawKind = String(doc.kind ?? '');
  const kind: ProductKind = (PRODUCT_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as ProductKind)
    : type === 'digital'
      ? 'digital'
      : 'photo';
  const rawScope = String(doc.scope ?? '');
  const scope: ProductScope = (PRODUCT_SCOPES as readonly string[]).includes(rawScope)
    ? (rawScope as ProductScope)
    : 'all';
  const additional =
    typeof doc.additional_price_cents === 'number' && Number.isFinite(doc.additional_price_cents)
      ? Math.max(0, Math.round(doc.additional_price_cents))
      : null;
  return {
    id: doc.id,
    code: doc.code ?? '',
    name: doc.name,
    description: doc.description ?? '',
    type,
    kind: type === 'digital' ? 'digital' : kind === 'digital' ? 'photo' : kind,
    price_cents: Math.max(0, Math.round(Number(doc.price_cents) || 0)),
    additional_price_cents: additional,
    includes_digital: type === 'print' && Number(doc.includes_digital) === 1,
    scope,
    currency: (doc.currency ?? 'chf').toLowerCase(),
    active: Number(doc.active) === 1,
    sort_order: Number(doc.sort_order) || 0,
  };
}

/**
 * Total of one cart/order line with tiered pricing: first unit at the unit
 * price, every further unit at the additional price (or the unit price when no
 * separate additional price is defined).
 */
export function lineTotalCents(
  unitPriceCents: number,
  additionalPriceCents: number | null | undefined,
  qty: number,
): number {
  const q = Math.max(0, Math.floor(qty));
  if (q === 0) return 0;
  const additional =
    typeof additionalPriceCents === 'number' && Number.isFinite(additionalPriceCents)
      ? additionalPriceCents
      : unitPriceCents;
  return unitPriceCents + (q - 1) * additional;
}

/** Whether a product may be ordered for a given photo (portrait vs. group photo). */
export function productAllowedForPhoto(product: ProductView, isClassPhoto: boolean): boolean {
  if (product.scope === 'portrait') return !isClassPhoto;
  if (product.scope === 'group') return isClassPhoto;
  return true;
}

/**
 * Version of the seeded catalogue. Bumping it (together with the entries
 * below) re-applies the catalogue once on the next start; see
 * `ensureProductCatalog` in db/migrate.ts.
 */
export const PRODUCT_CATALOG_VERSION = 2;

export interface CatalogEntry {
  code: string;
  name: string;
  description: string;
  type: ProductType;
  kind: ProductKind;
  price_cents: number;
  additional_price_cents: number | null;
  includes_digital: boolean;
  scope: ProductScope;
  sort_order: number;
  /** Names of earlier product documents that this entry replaces/updates. */
  legacy_names: string[];
}

/**
 * The current price list:
 *
 *  Einzelfotos (Portraits)                       Gruppenfotos
 *   - Druck 13×18 cm  15.- (jedes weitere +4.-)   - Druck 13×18 cm  15.- (+4.-)
 *   - Druck 20×30 cm  17.- (jedes weitere +7.-)   - Druck 20×30 cm  17.- (+7.-)
 *   - Nur digital     13.-                        - Nur digital     13.-
 *   - Sticker-Bogen   11.- (16 Sticker 3×4 cm)
 *   - Magnete-Set     13.- (3 Stück 5×5 cm)
 *
 *  Bei jedem Druck (13×18 / 20×30) ist die digitale Datei inbegriffen.
 */
export const PRODUCT_CATALOG: CatalogEntry[] = [
  {
    code: 'print_13x18',
    name: 'Druck 13×18 cm',
    description:
      'Gedrucktes Foto auf Fotopapier im Format 13×18 cm. Die digitale Datei in voller Auflösung ist inbegriffen.',
    type: 'print',
    kind: 'photo',
    price_cents: 1500,
    additional_price_cents: 400,
    includes_digital: true,
    scope: 'all',
    sort_order: 0,
    legacy_names: ['Druck 13×18 cm', 'Druck 13x18 cm'],
  },
  {
    code: 'print_20x30',
    name: 'Druck 20×30 cm',
    description:
      'Gedrucktes Foto auf Fotopapier im Format 20×30 cm. Die digitale Datei in voller Auflösung ist inbegriffen.',
    type: 'print',
    kind: 'photo',
    price_cents: 1700,
    additional_price_cents: 700,
    includes_digital: true,
    scope: 'all',
    sort_order: 1,
    legacy_names: ['Druck 20×30 cm', 'Druck 20x30 cm'],
  },
  {
    code: 'digital',
    name: 'Nur digital (Download)',
    description: 'Originalfoto in voller Auflösung, ohne Wasserzeichen, als Download.',
    type: 'digital',
    kind: 'digital',
    price_cents: 1300,
    additional_price_cents: null,
    includes_digital: false,
    scope: 'all',
    sort_order: 2,
    legacy_names: ['Digitaler Download (hohe Auflösung)', 'Digitaler Download'],
  },
  {
    code: 'sticker_16',
    name: 'Sticker-Bogen (16 Stück, 3×4 cm)',
    description:
      'Ein Bogen mit 16 rechteckigen Foto-Stickern à 3×4 cm. Nur für Einzelfotos erhältlich.',
    type: 'print',
    kind: 'sticker',
    price_cents: 1100,
    additional_price_cents: 1100,
    includes_digital: false,
    scope: 'portrait',
    sort_order: 3,
    legacy_names: [],
  },
  {
    code: 'magnet_3',
    name: 'Magnete-Set (3 Stück, 5×5 cm)',
    description: 'Set mit 3 Foto-Magneten à 5×5 cm. Nur für Einzelfotos erhältlich.',
    type: 'print',
    kind: 'magnet',
    price_cents: 1300,
    additional_price_cents: 1300,
    includes_digital: false,
    scope: 'portrait',
    sort_order: 4,
    legacy_names: [],
  },
];

/** Products of earlier versions that are no longer offered (deactivated on migration). */
export const RETIRED_PRODUCT_NAMES = ['Druck 16×21 cm', 'Druck 16x21 cm'];
