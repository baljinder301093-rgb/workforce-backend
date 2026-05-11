import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull(),
  projectId: integer("project_id").notNull(),
  assignmentId: integer("assignment_id"),
  amount: real("amount").notNull(),
  paymentType: text("payment_type", { enum: ["daily", "hourly", "fixed"] }).notNull().default("fixed"),
  status: text("status", { enum: ["pending", "released", "failed"] }).notNull().default("pending"),
  transactionId: text("transaction_id"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
