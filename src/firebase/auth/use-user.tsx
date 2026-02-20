'use client';

import { useEffect, useState, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { doc, getDoc, Firestore } from 'firebase/firestore';
import { useAuth, useFirestore } from '@/firebase/provider';
import type { AppUser, UserProfile } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';

interface UserContextType {
    user: AppUser | null;
    isLoading: boolean;
    login: (email: string, pass: string) => Promise<AppUser | null>;
    logout: () => void;
}

export const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
    const userProviderValue = useUserProvider();
    return (
        <UserContext.Provider value={userProviderValue}>
            <FirebaseErrorListener />
            {children}
        </UserContext.Provider>
    );
};

export function useUser() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider from Firebase');
    }
    return context;
}

export const useUserProvider = (): UserContextType => {
    const [user, setUser] = useState<AppUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const auth = useAuth();
    const firestore = useFirestore();

    useEffect(() => {
        if (!auth || !firestore) {
            // Firebase might not be initialized yet, especially on first render.
            // The effect will re-run when auth/firestore become available.
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
            if (firebaseUser) {
                const userDocRef = doc(firestore as Firestore, 'users', firebaseUser.uid);
                const userDoc = await getDoc(userDocRef);

                if (userDoc.exists()) {
                    const userProfile = userDoc.data() as UserProfile;
                    setUser({ ...firebaseUser, profile: userProfile });
                } else {
                    // Handle case where user exists in Auth but not Firestore
                    console.warn(`User with UID ${firebaseUser.uid} exists in Firebase Auth but not in Firestore 'users' collection. Logging out.`);
                    await signOut(auth);
                    setUser(null);
                }
            } else {
                setUser(null);
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [auth, firestore, router]);

    const login = async (email: string, pass: string): Promise<AppUser | null> => {
        if (!auth || !firestore) throw new Error("Firebase not initialized");
        const userCredential = await signInWithEmailAndPassword(auth, email, pass);
        const firebaseUser = userCredential.user;
        
        const userDocRef = doc(firestore, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
            const userProfile = userDoc.data() as UserProfile;
            const appUser = { ...firebaseUser, profile: userProfile };
            setUser(appUser);
            return appUser;
        }
        
        // Log out user if no profile found
        await signOut(auth);
        return null;
    };

    const logout = async () => {
        if (!auth) return;
        await signOut(auth);
        router.push('/login');
    };

    return { user, isLoading, login, logout };
};
