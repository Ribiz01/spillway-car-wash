'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  disableNetwork,
  enableNetwork,
} from 'firebase/firestore';
import { useFirestore } from '@/firebase/provider';
import { useUser } from '@/firebase/auth/use-user';

export interface SyncStatus {
  /** Browser connectivity. Not a guarantee Firestore has reached the server. */
  isOnline: boolean;
  /**
   * Whether Firestore is actually talking to the backend, as opposed to serving
   * from cache. This is the honest signal: `navigator.onLine` reports only that
   * a network interface is up, so on a slow or captive link it happily says
   * "online" while Firestore has given up and gone into offline mode.
   */
  isServerReachable: boolean;
  /** Number of this attendant's recent washes still waiting to reach the server. */
  pendingWrites: number;
  /** True once the local cache has been read at least once. */
  isReady: boolean;
}

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Tracks whether the device is online and how many transactions are still sitting
 * in the local Firestore write queue.
 *
 * Firestore already retries queued writes for us; this hook exists so the UI can
 * tell the attendant that a wash has been recorded but not yet uploaded, rather
 * than leaving them guessing.
 */
export function useSyncStatus(): SyncStatus {
  const firestore = useFirestore();
  const { user } = useUser();

  const [isOnline, setIsOnline] = useState(true);
  // Starts optimistic so a healthy connection never flashes a scary badge on
  // first paint; the first snapshot corrects it either way.
  const [isServerReachable, setIsServerReachable] = useState(true);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // Browser connectivity.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Count documents this user wrote today that have not been acknowledged by the
  // server yet. includeMetadataChanges is what makes hasPendingWrites observable.
  useEffect(() => {
    if (!firestore || !user) {
      setPendingWrites(0);
      setIsServerReachable(true);
      setIsReady(false);
      return;
    }

    // Range on `timestamp` alone. Pairing it with where('userId','==') would make
    // this a composite-index query, and until that index exists the listen fails
    // outright — which is why this badge silently counted zero forever. The
    // per-user filter is applied client-side below instead, off the same
    // snapshot, so the indicator works against a stock database.
    const q = query(
      collection(firestore, 'transactions'),
      where('timestamp', '>=', startOfTodayIso())
    );

    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        const pending = snapshot.docs.filter(
          (d) => d.metadata.hasPendingWrites && d.data().userId === user.uid
        ).length;
        setPendingWrites(pending);
        // fromCache means the SDK could not reach the backend for this snapshot.
        setIsServerReachable(!snapshot.metadata.fromCache);
        setIsReady(true);
      },
      () => {
        // A listen failure (offline with a cold cache, or rules) shouldn't break
        // the indicator — just stop reporting a count.
        setPendingWrites(0);
        setIsServerReachable(false);
        setIsReady(true);
      }
    );

    return () => unsubscribe();
  }, [firestore, user]);

  return { isOnline, isServerReachable, pendingWrites, isReady };
}

/**
 * Manually force Firestore offline / online. Useful for testing the queue at the
 * wash bay without pulling the router, and for a future "work offline" toggle.
 */
export async function setFirestoreNetwork(firestore: Parameters<typeof enableNetwork>[0], online: boolean) {
  if (online) {
    await enableNetwork(firestore);
  } else {
    await disableNetwork(firestore);
  }
}
