'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore,
} from 'firebase/firestore';

// Module-level cache for Firebase services to ensure they are only initialized once.
let services: {
  firebaseApp: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
} | null = null;

const serviceCacheKey = '__spillwayFirebaseServices__';
type FirebaseGlobal = typeof globalThis & {
  __spillwayFirebaseServices__?: {
    firebaseApp: FirebaseApp;
    auth: Auth;
    firestore: Firestore;
  };
};

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  const globalServices = (globalThis as FirebaseGlobal)[serviceCacheKey];
  if (globalServices) {
    services = globalServices;
    return globalServices;
  }

  if (services) {
    return services;
  }

  const app = (() => {
    if (getApps().length) {
      return getApp();
    }
    // In a Firebase App Hosting environment, `initializeApp()` automatically picks up the config.
    try {
      return initializeApp();
    } catch (e) {
      // For local development, fall back to the provided config object.
      if (process.env.NODE_ENV === 'production') {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', e);
      }
      return initializeApp(firebaseConfig);
    }
  })();

  const auth = getAuth(app);

  // Offline-first cache. This MUST be configured at initialization time — it is
  // what lets an attendant keep recording washes when the network drops. Writes
  // are queued in IndexedDB and replayed automatically when connectivity returns.
  // persistentMultipleTabManager avoids the "failed-precondition" error that the
  // older enableIndexedDbPersistence() threw whenever a second tab was open.
  const firestore = (() => {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch (e) {
      // Already initialized (fast refresh), or the browser has no IndexedDB
      // (private mode on some browsers). Fall back to the in-memory instance.
      console.warn('Persistent Firestore cache unavailable; falling back to memory cache.', e);
      return getFirestore(app);
    }
  })();

  // Cache the services to prevent re-initialization.
  services = {
    firebaseApp: app,
    auth,
    firestore,
  };
  (globalThis as FirebaseGlobal)[serviceCacheKey] = services;
  
  return services;
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
