/**
 * Shared by every form whose lookup dropdowns are uncontrolled `<select>`s
 * seeded from a fetched record. See {@link withSaved} for why they need it.
 */

/** The least a value must carry to be matched and rendered as an `<option>`. */
export interface LookupOption {
  id: string;
}

/**
 * Returns the fetched lookup list with the record's own saved relations added
 * to the front when the list does not already hold them.
 *
 * react-hook-form writes a value straight onto an uncontrolled `<select>`, and
 * a browser silently discards a value with no matching `<option>` — nothing
 * re-applies it when the list finally arrives. On edit the lookup lists are
 * routinely still in flight at that moment, so without this the field comes up
 * blank; which list wins the race is pure timing, and the ones served from
 * cache hide the bug. Seeding the saved relation makes the value selectable on
 * the first paint whatever the order.
 *
 * It also keeps a lookup the list leaves out — deactivated, or past the page
 * limit — visible instead of quietly blanking the field.
 */
export function withSaved<T extends LookupOption, S extends LookupOption>(
  loaded: T[] | undefined,
  ...saved: Array<S | null | undefined>
): Array<T | S> {
  const options: Array<T | S> = loaded ?? [];
  const missing: S[] = [];
  for (const candidate of saved) {
    if (!candidate) continue;
    if (options.some((option) => option.id === candidate.id)) continue;
    if (missing.some((option) => option.id === candidate.id)) continue;
    missing.push(candidate);
  }
  return missing.length > 0 ? [...missing, ...options] : options;
}
