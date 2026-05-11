import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { addClient, removeClient } from "../lib/sse";

const router = Router();

router.get("/notifications/stream", requireAuth, (req: AuthRequest, res): void => {
  const userId = req.userId!;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`: connected\n\n`);

  addClient(userId, res);

  const keepAlive = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 20000);

  req.on("close", () => {
    clearInterval(keepAlive);
    removeClient(userId, res);
  });
});

router.get("/notifications/unread-count", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, req.userId!), eq(notificationsTable.isRead, false)));
  res.json({ count: rows.length });
});

router.get("/notifications", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const unreadOnly = req.query.unreadOnly === "true";
  const conditions = [eq(notificationsTable.userId, req.userId!)];
  if (unreadOnly) conditions.push(eq(notificationsTable.isRead, false));
  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(notifications);
});

router.patch("/notifications/read-all", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, req.userId!), eq(notificationsTable.isRead, false)));
  res.sendStatus(204);
});

router.patch("/notifications/:id/read", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [notif] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.userId!)))
    .returning();
  if (!notif) { res.status(404).json({ error: "Notification not found" }); return; }
  res.json(notif);
});

export default router;
