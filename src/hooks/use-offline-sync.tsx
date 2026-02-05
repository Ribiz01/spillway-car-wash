"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Transaction } from '@/lib/types';
import { useToast } from './use-toast';

const OFFLINE_QUEUE_KEY = 'smartwash-offline-queue';

interface OfflineSyncContextType {
  pendingTransactions: Transaction[];
  addTransactionToQueue: (transaction: Transaction) => void;
  syncPendingTransactions: () => Promise<number>;
  isSyncing: boolean;
}

const OfflineSyncContext = createContext<OfflineSyncContextType | null>(null);

export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    try {
      const storedQueue = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (storedQueue) {
        setPendingTransactions(JSON.parse(storedQueue));
      }
    } catch (error) {
      console.error("Failed to parse offline queue from localStorage", error);
      localStorage.removeItem(OFFLINE_QUEUE_KEY);
    }
  }, []);

  const updateLocalStorage = (queue: Transaction[]) => {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  };

  const addTransactionToQueue = useCallback((transaction: Transaction) => {
    setPendingTransactions(prev => {
      const newQueue = [...prev, transaction];
      updateLocalStorage(newQueue);
      return newQueue;
    });
    toast({
      title: "Transaction Saved Offline",
      description: "It will be synced when internet is available.",
    });
  }, [toast]);

  const syncPendingTransactions = useCallback(async (): Promise<number> => {
    setIsSyncing(true);
    // In a real app, this would make API calls to a server.
    // Here we just simulate a delay and then clear the queue.
    return new Promise(resolve => {
      setTimeout(() => {
        const count = pendingTransactions.length;
        if (count > 0) {
          // Here you would add the pending transactions to your main data store.
          // For this demo, we'll just log them.
          console.log("Syncing transactions:", pendingTransactions);
          
          setPendingTransactions([]);
          updateLocalStorage([]);
          toast({
            title: "Sync Complete",
            description: `${count} transaction(s) have been synced.`,
            variant: "default",
          });
        }
        setIsSyncing(false);
        resolve(count);
      }, 1500);
    });
  }, [pendingTransactions, toast]);

  const value = {
    pendingTransactions,
    addTransactionToQueue,
    syncPendingTransactions,
    isSyncing,
  };

  return (
    <OfflineSyncContext.Provider value={value}>
      {children}
    </OfflineSyncContext.Provider>
  );
}

export const useOfflineSync = () => {
  const context = useContext(OfflineSyncContext);
  if (!context) {
    throw new Error('useOfflineSync must be used within an OfflineSyncProvider');
  }
  return context;
};
