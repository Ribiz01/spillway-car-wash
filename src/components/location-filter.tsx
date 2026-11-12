'use client';

import { collection } from 'firebase/firestore';
import { MapPin } from 'lucide-react';
import { useFirestore, useMemoFirebase } from '@/firebase';
import { useCollection } from '@/firebase/firestore/use-collection';
import type { Location } from '@/lib/types';
import { ALL_LOCATIONS } from '@/lib/locations';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Every branch, for pickers. Inactive ones are included so old records still resolve. */
export function useLocations() {
  const firestore = useFirestore();
  const locationsQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'locations') : null),
    [firestore]
  );
  const { data, isLoading } = useCollection<Location>(locationsQuery);
  return { locations: data ?? [], isLoading };
}

/**
 * Branch picker for admin screens. Renders nothing until at least one location
 * exists, so a single-site business never sees a control it has no use for.
 */
export function LocationFilter({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { locations } = useLocations();
  if (locations.length === 0) return null;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'w-[180px]'} aria-label="Location">
        <MapPin className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_LOCATIONS}>All locations</SelectItem>
        {locations.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
            {l.active ? '' : ' (inactive)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
