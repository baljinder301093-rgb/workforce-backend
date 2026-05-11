import { Router } from "express";
import { eq, and, SQL } from "drizzle-orm";
import { db, paymentsTable, usersTable, projectsTable } from "@workspace/db";
import { requireAuth, requireRole, AuthRequest } from "../middlewares/auth";
import {
  CreatePaymentBody, ListPaymentsQueryParams,
  GetPaymentParams, ReleasePaymentParams
} from "@workspace/api-zod";
import { createNotification } from "../lib/sse";

const router = Router();

async function enrichPayment(p: typeof paymentsTable.$inferSelect) {
  const [worker] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, p.workerId));
  const [project] = await db.select({ title: projectsTable.title }).from(projectsTable).where(eq(projectsTable.id, p.projectId));
  return { ...p, workerName: worker?.name ?? null, projectTitle: project?.title ?? null };
}

router.get("/payments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListPaymentsQueryParams.safeParse(req.query);
  const { workerId, projectId, status } = params.success ? params.data : {};
  const conditions: SQL[] = [];
  if (workerId) conditions.push(eq(paymentsTable.workerId, Number(workerId)));
  if (projectId) conditions.push(eq(paymentsTable.projectId, Number(projectId)));
  if (status) conditions.push(eq(paymentsTable.status, status as "pending" | "released" | "failed"));
  if (req.userRole === "worker") {
    conditions.push(eq(paymentsTable.workerId, req.userId!));
  }
  const payments = await db.select().from(paymentsTable).where(conditions.length ? and(...conditions) : undefined);
  const enriched = await Promise.all(payments.map(enrichPayment));
  res.json(enriched);
});

router.post("/payments", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [payment] = await db.insert(paymentsTable).values({
    workerId: parsed.data.workerId,
    projectId: parsed.data.projectId,
    assignmentId: parsed.data.assignmentId ?? null,
    amount: parsed.data.amount,
    paymentType: parsed.data.paymentType as "daily" | "hourly" | "fixed",
    status: "pending",
  }).returning();
  res.status(201).json(await enrichPayment(payment));
});

router.get("/payments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetPaymentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, params.data.id));
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  res.json(await enrichPayment(payment));
});

router.patch("/payments/:id/release", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const params = ReleasePaymentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const txId = `TXN-${Date.now()}-${params.data.id}`;
  const [payment] = await db.update(paymentsTable)
    .set({ status: "released", releasedAt: new Date(), transactionId: txId })
    .where(eq(paymentsTable.id, params.data.id))
    .returning();
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  const enriched = await enrichPayment(payment);

  await createNotification({
    userId: payment.workerId,
    type: "payment_released",
    title: "Payment Released!",
    message: `$${Number(payment.amount).toFixed(2)} has been released for "${enriched.projectTitle}". Transaction: ${txId}`,
    relatedId: payment.id,
  });

  res.json(enriched);
});

export default router;
