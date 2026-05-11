import { Router } from "express";
import { eq, or, and, SQL, desc, ne } from "drizzle-orm";
import { db, messagesTable, usersTable } from "@workspace/db";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { CreateMessageBody, ListMessagesQueryParams } from "@workspace/api-zod";

const router = Router();

async function enrichMessage(m: typeof messagesTable.$inferSelect) {
  const [sender] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, m.senderId));
  const [receiver] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, m.receiverId));
  return { ...m, senderName: sender?.name ?? null, receiverName: receiver?.name ?? null };
}

router.get("/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListMessagesQueryParams.safeParse(req.query);
  const { senderId, receiverId, projectId } = params.success ? params.data : {};
  const conditions: SQL[] = [];
  if (senderId) conditions.push(eq(messagesTable.senderId, Number(senderId)));
  if (receiverId) conditions.push(eq(messagesTable.receiverId, Number(receiverId)));
  if (projectId) conditions.push(eq(messagesTable.projectId, Number(projectId)));
  if (!senderId && !receiverId) {
    conditions.push(or(
      eq(messagesTable.senderId, req.userId!),
      eq(messagesTable.receiverId, req.userId!)
    )!);
  }
  const msgs = await db.select().from(messagesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(messagesTable.createdAt);
  const enriched = await Promise.all(msgs.map(enrichMessage));
  res.json(enriched);
});

router.post("/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [msg] = await db.insert(messagesTable).values({
    senderId: req.userId!,
    receiverId: parsed.data.receiverId,
    projectId: parsed.data.projectId ?? null,
    content: parsed.data.content,
    isRead: false,
  }).returning();
  res.status(201).json(await enrichMessage(msg));
});

router.get("/messages/conversations", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const allMsgs = await db.select().from(messagesTable)
    .where(or(eq(messagesTable.senderId, userId), eq(messagesTable.receiverId, userId))!)
    .orderBy(desc(messagesTable.createdAt));

  const conversationMap = new Map<number, {
    userId: number; lastMessage: string; lastMessageAt: Date; unreadCount: number;
  }>();

  for (const msg of allMsgs) {
    const otherId = msg.senderId === userId ? msg.receiverId : msg.senderId;
    if (!conversationMap.has(otherId)) {
      const unread = allMsgs.filter(m => m.senderId === otherId && m.receiverId === userId && !m.isRead).length;
      conversationMap.set(otherId, {
        userId: otherId,
        lastMessage: msg.content,
        lastMessageAt: msg.createdAt,
        unreadCount: unread,
      });
    }
  }

  const conversations = await Promise.all(
    Array.from(conversationMap.entries()).map(async ([otherId, conv]) => {
      const [user] = await db.select({ name: usersTable.name, role: usersTable.role })
        .from(usersTable).where(eq(usersTable.id, otherId));
      return { ...conv, userName: user?.name ?? "Unknown", userRole: user?.role ?? "worker" };
    })
  );
  res.json(conversations);
});

export default router;
