/**
 * Database functions for bookings (resource allocations)
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export type BookingType = Doc<"bookings">["type"];

export async function insertBooking(
  db: DatabaseWriter,
  booking: Omit<Doc<"bookings">, "_id" | "_creationTime">
): Promise<Id<"bookings">> {
  return await db.insert("bookings", booking);
}

export async function getBooking(
  db: DatabaseReader,
  bookingId: Id<"bookings">
): Promise<Doc<"bookings"> | null> {
  return await db.get(bookingId);
}

export async function updateBooking(
  db: DatabaseWriter,
  bookingId: Id<"bookings">,
  updates: Partial<Omit<Doc<"bookings">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const booking = await db.get(bookingId);
  if (!booking) {
    throw new EntityNotFoundError("Booking", { bookingId });
  }
  await db.patch(bookingId, updates);
}

export async function updateBookingType(
  db: DatabaseWriter,
  bookingId: Id<"bookings">,
  type: BookingType
): Promise<void> {
  await updateBooking(db, bookingId, { type });
}

export async function deleteBooking(
  db: DatabaseWriter,
  bookingId: Id<"bookings">
): Promise<void> {
  await db.delete(bookingId);
}

export async function listBookingsByUser(
  db: DatabaseReader,
  userId: Id<"users">,
  limit = 100
): Promise<Array<Doc<"bookings">>> {
  return await db
    .query("bookings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(limit);
}

export async function listBookingsByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 100
): Promise<Array<Doc<"bookings">>> {
  return await db
    .query("bookings")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .take(limit);
}

export async function listBookingsInDateRange(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  startDate: number,
  endDate: number,
  limit = 500
): Promise<Array<Doc<"bookings">>> {
  // Note: This is a range query that may need optimization for large datasets
  const bookings = await db
    .query("bookings")
    .withIndex("by_date_range", (q) =>
      q.eq("organizationId", organizationId).gte("startDate", startDate)
    )
    .take(limit);
  return bookings.filter((b) => b.startDate <= endDate);
}

export async function listUserBookingsInDateRange(
  db: DatabaseReader,
  userId: Id<"users">,
  startDate: number,
  endDate: number
): Promise<Array<Doc<"bookings">>> {
  const bookings = await listBookingsByUser(db, userId);
  return bookings.filter(
    (b) => b.endDate >= startDate && b.startDate <= endDate
  );
}

export async function listTentativeBookingsByProject(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"bookings">>> {
  const bookings = await listBookingsByProject(db, projectId);
  return bookings.filter((b) => b.type === "Tentative");
}

export async function confirmAllTentativeBookings(
  db: DatabaseWriter,
  projectId: Id<"projects">
): Promise<number> {
  const tentative = await listTentativeBookingsByProject(db, projectId);
  for (const booking of tentative) {
    await updateBookingType(db, booking._id, "Confirmed");
  }
  return tentative.length;
}

/**
 * Calculate total hours booked for a user in a date range
 */
export async function calculateUserBookedHours(
  db: DatabaseReader,
  userId: Id<"users">,
  startDate: number,
  endDate: number
): Promise<number> {
  const bookings = await listUserBookingsInDateRange(
    db,
    userId,
    startDate,
    endDate
  );

  let totalHours = 0;
  for (const booking of bookings) {
    // Calculate overlap between booking and date range
    const overlapStart = Math.max(booking.startDate, startDate);
    const overlapEnd = Math.min(booking.endDate, endDate);
    const days = Math.ceil((overlapEnd - overlapStart) / (24 * 60 * 60 * 1000)) + 1;
    totalHours += days * booking.hoursPerDay;
  }
  return totalHours;
}
