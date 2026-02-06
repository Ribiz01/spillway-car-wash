"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Transaction } from '@/lib/types';

const TRANSACTIONS_KEY = 'spillway-all-transactions';

interface TransactionsContextType {
  transactions: Transaction[];
  addTransaction: (transaction: Transaction) => void;
  isLoading: boolean;
}

const TransactionsContext = createContext<TransactionsContextType | null>(null);

export function TransactionsProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const storedTransactions = localStorage.getItem(TRANSACTIONS_KEY);
      if (storedTransactions) {
        setTransactions(JSON.parse(storedTransactions));
      } else {
        // If no transactions in storage, start with an empty array
        const initialTransactions: Transaction[] = [];
        setTransactions(initialTransactions);
        localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(initialTransactions));
      }
    } catch (error) {
      console.error("Failed to parse transactions from localStorage", error);
      // Fallback to empty array if storage is corrupt
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateLocalStorage = (transactions: Transaction[]) => {
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(transactions));
  };

  const addTransaction = useCallback((transaction: Transaction) => {
    setTransactions(prevTransactions => {
      const newTransactions = [transaction, ...prevTransactions];
      updateLocalStorage(newTransactions);
      return newTransactions;
    });
  }, []);
  
  const value = {
    transactions,
    addTransaction,
    isLoading,
  };

  return (
    <TransactionsContext.Provider value={value}>
      {children}
    </TransactionsContext.Provider>
  );
}

export const useTransactions = () => {
  const context = useContext(TransactionsContext);
  if (!context) {
    throw new Error('useTransactions must be used within a TransactionsProvider');
  }
  return context;
};
