import type { UserProfile } from '@/lib/types';

/** Sentinel for "no branch filter" in location pickers. Never a real document id. */
export const ALL_LOCATIONS = '__all__';

type Located = { locationId?: string };

/**
 * Whether a record belongs on this person's screen.
 *
 * Someone with no assigned branch sees everything. Records with no branch are
 * shown to everyone too: they pre-date locations (or were made by an unassigned
 * admin), and hiding them would strand cars on the forecourt with nobody able
 * to take payment.
 */
export function inUserLocation(record: Located, profile: UserProfile | undefined | null): boolean {
  if (!profile?.locationId) return true;
  if (!record.locationId) return true;
  return record.locationId === profile.locationId;
}

/** Whether a record matches an admin's chosen filter. Unlike the above, a specific filter is strict. */
export function matchesLocationFilter(record: Located, filter: string): boolean {
  return filter === ALL_LOCATIONS || record.locationId === filter;
}

/** Fields to stamp onto a new record so it is tied to the creator's branch. Empty when they have none. */
export function locationStamp(profile: UserProfile | undefined | null): {
  locationId?: string;
  locationName?: string;
} {
  if (!profile?.locationId) return {};
  return { locationId: profile.locationId, locationName: profile.locationName ?? '' };
}
