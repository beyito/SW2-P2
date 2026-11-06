export interface InventoryItem {
  id: string;
  code: string;
  name: string;
  category: string;
  currentStock: number;
  minimumStock: number;
  reservedStock: number | null;
  unitPrice: number;
  isCriticalStock: boolean;
}

export interface StylistSchedule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

export interface Stylist {
  id: string;
  name: string;
  specialty: string | null;
  phone: string | null;
  active: boolean;
  rating: { average: number; count: number };
  schedules: StylistSchedule[];
}

export interface PanelAppointment {
  id: string;
  clientId: string;
  stylistName: string;
  serviceName: string;
  appointmentDate: string;
  durationMinutes: number;
  totalPrice: number;
  status: string;
}

export interface Client {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  loyaltyPoints: number;
}

export interface Notice {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string | null;
}

export interface CommunityPost {
  id: string;
  authorName: string;
  title: string;
  description: string;
  imageUrl: string;
  status: 'VISIBLE' | 'HIDDEN';
  moderationReason: string | null;
  reports?: { reason: string }[];
}
