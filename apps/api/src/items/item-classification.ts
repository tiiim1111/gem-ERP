import { BusinessCategory, TrackingMethod } from '@prisma/client';

/**
 * Allowed businessCategory → trackingMethod combinations and defaults
 * (spec §4). Pure data/functions shared by the items service and the CSV
 * import validators.
 */
export const TRACKING_RULES: Record<
  BusinessCategory,
  { allowed: TrackingMethod[]; default: TrackingMethod }
> = {
  [BusinessCategory.SERIALIZED_ASSET]: {
    allowed: [TrackingMethod.SERIAL],
    default: TrackingMethod.SERIAL,
  },
  [BusinessCategory.CONSUMABLE]: {
    allowed: [TrackingMethod.QUANTITY, TrackingMethod.LOT],
    default: TrackingMethod.QUANTITY,
  },
  [BusinessCategory.BULK_NON_CONSUMABLE]: {
    allowed: [TrackingMethod.QUANTITY, TrackingMethod.SERIAL],
    default: TrackingMethod.QUANTITY,
  },
};

export function defaultTrackingMethod(
  businessCategory: BusinessCategory,
): TrackingMethod {
  return TRACKING_RULES[businessCategory].default;
}

export function isAllowedCombo(
  businessCategory: BusinessCategory,
  trackingMethod: TrackingMethod,
): boolean {
  return TRACKING_RULES[businessCategory].allowed.includes(trackingMethod);
}
