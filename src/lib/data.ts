import type { User, Service, Vehicle, Transaction } from './types';

export const users: User[] = [
  { id: 'user-1', name: 'Admin User', email: 'admin@spillway.com', password: 'password123', role: 'Admin' },
  { id: 'user-2', name: 'John Doe', email: 'attendant@spillway.com', password: 'password123', role: 'Attendant' },
];

export const services: Service[] = [
  { id: 'svc-1', name: 'Exterior Wash', price: 50 },
  { id: 'svc-2', name: 'Interior Vacuum', price: 20 },
  { id: 'svc-3', name: 'Tire Shine', price: 15 },
  { id: 'svc-4', name: 'Wax & Polish', price: 80 },
  { id: 'svc-5', name: 'Engine Wash', price: 60 },
  { id: 'svc-6', name: 'Full Detail', price: 200 },
];

export const vehicles: Vehicle[] = [];

export const transactions: Transaction[] = [];
