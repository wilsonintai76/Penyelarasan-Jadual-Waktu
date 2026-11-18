export const WEEK_DAYS = ["Isnin", "Selasa", "Rabu", "Khamis", "Jumaat"] as const;

export interface TimeSlot {
  start: string;
  end: string;
  label: string;
  isBreak?: boolean;
}

export const TIME_SLOTS: TimeSlot[] = [
  { start: "08:00", end: "09:00", label: "8.00 - 9.00" },
  { start: "09:00", end: "10:00", label: "9.00 - 10.00" },
  { start: "10:00", end: "11:00", label: "10.00 - 11.00" },
  { start: "11:00", end: "12:00", label: "11.00 - 12.00" },
  { start: "12:00", end: "13:00", label: "12.00 - 1.00", isBreak: true },
  { start: "13:00", end: "14:00", label: "1.00 - 2.00" },
  { start: "14:00", end: "15:00", label: "2.00 - 3.00" },
  { start: "15:00", end: "16:00", label: "3.00 - 4.00" },
  { start: "16:00", end: "17:00", label: "4.00 - 5.00" }
];
