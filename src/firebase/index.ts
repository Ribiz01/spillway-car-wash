'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence, Firestore } from 'firebase/firestore';

// Module-level cache for Firebase services to ensure they are only initialized once.
let services: {
  firebaseApp: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
} | null = null;

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
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
  const firestore = getFirestore(app);

  // Enable persistence. This must be done before any other Firestore operation.
  // It's safe here because `initializeFirebase` now runs only once.
  enableIndexedDbPersistence(firestore).catch((err) => {
    if (err.code == 'failed-precondition') {
      // Multiple tabs open, persistence can only be enabled
      // in one tab at a time. This is a normal scenario.
    } else if (err.code == 'unimplemented') {
      // The current browser does not support all of the
      // features required to enable persistence
      console.warn("Firestore persistence not available in this browser.");
    }
  });

  // Cache the services to prevent re-initialization.
  services = {
    firebaseApp: app,
    auth,
    firestore,
  };
  
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
