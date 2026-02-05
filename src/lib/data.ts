import type { User, Service, Vehicle, Transaction } from './types';

export const users: User[] = [
  { id: 'user-1', name: 'Admin User', email: 'admin@smartwash.com', password: 'password123', role: 'Admin' },
  { id: 'user-2', name: 'John Doe', email: 'attendant@smartwash.com', password: 'password123', role: 'Attendant' },
];

export const services: Service[] = [
  { id: 'svc-1', name: 'Exterior Wash', price: 50 },
  { id: 'svc-2', name: 'Interior Vacuum', price: 20 },
  { id: 'svc-3', name: 'Tire Shine', price: 15 },
  { id: 'svc-4', name: 'Wax & Polish', price: 80 },
  { id: 'svc-5', name: 'Engine Wash', price: 60 },
  { id: 'svc-6', name: 'Full Detail', price: 200 },
];

export const vehicles: Vehicle[] = [
  { licensePlate: 'ABC 1234', type: 'Sedan', ownerName: 'Alice', phoneNumber: '260977123456' },
  { licensePlate: 'XYZ 5678', type: 'SUV', ownerName: 'Bob', phoneNumber: '260966789012' },
];

export const transactions: Transaction[] = [
  {
    id: 'txn-1',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    licensePlate: 'ABC 1234',
    services: [services[0], services[1]],
    totalAmount: 70,
    payment: { method: 'Cash', amount: 70 },
    attendantId: 'user-2',
    attendantName: 'John Doe',
  },
  {
    id: 'txn-2',
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    licensePlate: 'XYZ 5678',
    services: [services[3], services[4]],
    totalAmount: 140,
    payment: { method: 'Mobile Money', reference: 'MM-54321', amount: 140 },
    attendantId: 'user-2',
    attendantName: 'John Doe',
  },
    {
    id: 'txn-3',
    timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    licensePlate: 'ABC 1234',
    services: [services[5]],
    totalAmount: 200,
    payment: { method: 'Cash', amount: 200 },
    attendantId: 'user-2',
    attendantName: 'John Doe',
  },
];
