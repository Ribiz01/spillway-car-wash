"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Vehicle } from '@/lib/types';

const VEHICLES_KEY = 'spillway-vehicles';

interface VehiclesContextType {
  vehicles: Vehicle[];
  addVehicle: (vehicle: Vehicle) => void;
  isLoading: boolean;
}

const VehiclesContext = createContext<VehiclesContextType | null>(null);

export function VehiclesProvider({ children }: { children: React.ReactNode }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const storedVehicles = localStorage.getItem(VEHICLES_KEY);
      if (storedVehicles) {
        setVehicles(JSON.parse(storedVehicles));
      } else {
        // If no vehicles in storage, start with an empty array
        const initialVehicles: Vehicle[] = [];
        setVehicles(initialVehicles);
        localStorage.setItem(VEHICLES_KEY, JSON.stringify(initialVehicles));
      }
    } catch (error) {
      console.error("Failed to parse vehicles from localStorage", error);
      // Fallback to empty array if storage is corrupt
      setVehicles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateLocalStorage = (vehicles: Vehicle[]) => {
    localStorage.setItem(VEHICLES_KEY, JSON.stringify(vehicles));
  };

  const addVehicle = useCallback((vehicle: Vehicle) => {
    setVehicles(prevVehicles => {
      // Avoid adding duplicates
      if (prevVehicles.some(v => v.licensePlate === vehicle.licensePlate)) {
        return prevVehicles;
      }
      const newVehicles = [...prevVehicles, vehicle];
      updateLocalStorage(newVehicles);
      return newVehicles;
    });
  }, []);
  
  const value = {
    vehicles,
    addVehicle,
    isLoading,
  };

  return (
    <VehiclesContext.Provider value={value}>
      {children}
    </VehiclesContext.Provider>
  );
}

export const useVehicles = () => {
  const context = useContext(VehiclesContext);
  if (!context) {
    throw new Error('useVehicles must be used within a VehiclesProvider');
  }
  return context;
};
