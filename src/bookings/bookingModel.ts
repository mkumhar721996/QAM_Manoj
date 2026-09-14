export interface Booking {
  id: string;
  slotId: string;
  customerId: string;
  customerName: string;
  providerId: string;
  providerName: string;
  date: string;
  time: string;
  status: "confirmed";
}
