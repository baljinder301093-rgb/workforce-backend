import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  location: text("location").notNull(),
  requiredSkills: text("required_skills").notNull(),
  workersRequired: integer("workers_required").notNull().default(1),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  workingHours: text("working_hours").notNull(),
  salaryAmount: real("salary_amount").notNull(),
  paymentRate: real("payment_rate").notNull().default(0),
  paymentType: text("payment_type", { enum: ["daily", "hourly", "fixed"] }).notNull().default("daily"),
  status: text("status", { enum: ["open", "in_progress", "completed", "cancelled"] }).notNull().default("open"),
  managerId: integer("manager_id"),
  safetyInstructions: text("safety_instructions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
