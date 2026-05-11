import type { Response } from "express";
import { db, notificationsTable } from "@workspace/db";

type SseClient = Response;

const clients = new Map<number, Set<SseClient>>();

export function addClient(userId: number, res: SseClient): void {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId)!.add(res);
}

export function removeClient(userId: number, res: SseClient): void {
  const set = clients.get(userId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(userId);
  }
}

function sendEvent(res: SseClient, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function createNotification(opts: {
  userId: number;
  type: string;
  title: string;
  message: string;
  relatedId?: number;
}): Promise<void> {
  const [notif] = await db.insert(notificationsTable).values({
    userId: opts.userId,
    type: opts.type,
    title: opts.title,
    message: opts.message,
    relatedId: opts.relatedId ?? null,
    isRead: false,
  }).returning();

  const userClients = clients.get(opts.userId);
  if (userClients && userClients.size > 0) {
    for (const client of userClients) {
      try {
        sendEvent(client, "notification", notif);
      } catch {
        userClients.delete(client);
      }
    }
  }
}
