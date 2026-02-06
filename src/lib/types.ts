export type UserRole = 'Admin' | 'Attendant';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string; // In a real app, this would be a hash
  role: UserRole;
  pin?: string; // For local PIN auth simulation
}

export interface Vehicle {
  licensePlate: string;
  type: 'Sedan' | 'SUV' | 'Truck' | 'Minibus';
  ownerName?: string;
  phoneNumber?: string;
  photoDataUri?: string;
}

export interface Service {
  id: string;
  name: string;
  price: number;
}

export type PaymentMethod = 'Cash' | 'Mobile Money';

export interface Payment {
  method: PaymentMethod;
  reference?: string;
  amount: number;
}

export interface Transaction {
  id: string;
  timestamp: string;
  licensePlate: string;
  services: Service[];
  totalAmount: number;
  payment: Payment;
  attendantId: string;
  attendantName: string;
}
