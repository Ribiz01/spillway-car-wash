import { User as FirebaseUser } from "firebase/auth";

export type UserRole = 'Admin' | 'Attendant';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AppUser extends FirebaseUser {
  profile: UserProfile;
}

export interface Vehicle {
  id?: string;
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

export type PaymentMethod = 'Cash' | 'Mobile Money' | 'Corporate Account';

export interface Payment {
  method: PaymentMethod;
  reference?: string;
  amount: number;
}

export interface Transaction {
  id: string;
  timestamp: string;
  licensePlate: string;
  services: { id: string; name: string; price: number; }[];
  totalAmount: number;
  payment: Payment;
  userId: string;
}
