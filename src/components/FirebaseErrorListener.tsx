'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * An invisible component that listens for globally emitted 'permission-error' events.
 * It throws any received error to be caught by Next.js's global-error.tsx.
 */
export function FirebaseErrorListener() {
  // Use the specific error type for the state for type safety.
  const [error, setError] = useState<FirestorePermissionError | null>(null);

  useEffect(() => {
    // The callback now expects a strongly-typed error, matching the event payload.
    const handleError = (error: FirestorePermissionError) => {
      // Set error in state to trigger a re-render.
      setError(error);
    };

    // The typed emitter will enforce that the callback for 'permission-error'
    // matches the expected payload type (FirestorePermissionError).
    errorEmitter.on('permission-error', handleError);

    // Unsubscribe on unmount to prevent memory leaks.
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, []);

  // Never throw. This used to crash the whole tree so the rule context landed in
  // the dev overlay, but a denied read on ONE screen is not a reason to destroy
  // the till — and the overlay actively obscured the diagnosis by hiding which
  // query failed behind a generic stack.
  //
  // The full rule-context payload still goes to the console, and every screen
  // that runs a query surfaces its own `error` in place, which is both louder
  // about *what* broke and survivable.
  if (error) {
    console.error(
      'Firestore denied a request. If this is unexpected, the security rules may ' +
        'not be deployed — run: firebase deploy --only firestore\n',
      error.message
    );
  }

  // This component renders nothing.
  return null;
}
