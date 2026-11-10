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
  /** Hora en que la recepción registró la llegada; null si el cliente aún no llegó. */
  checkedInAt: string | null;
}

export interface SalonService {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
}

export interface TimeSlot {
  start: string;
  end: string;
}

/** Avance de una reserva del mostrador, tal como lo informa el orquestador SAGA. */
/** Datos para iniciar una reserva en el mostrador. */
export interface CounterBookingInput {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  serviceId: string;
  stylistId: string;
  appointmentDate: string;
  paymentMethod: string;
}

export interface CounterBooking {
  sagaId: string;
  status: string;
  appointmentId: string | null;
  serviceName: string | null;
  amountToPayCents: number | null;
  failureReason: string | null;
  clientId: string;
  paymentMethod: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: number | null;
  appointmentId: string;
  totalAmount: number;
  paymentMethod: string;
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
