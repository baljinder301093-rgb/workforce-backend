import { Router } from "express";
import { eq, ilike, and, SQL } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth, requireRole, AuthRequest } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";
import { CreateUserBody, UpdateUserBody, UpdateUserStatusBody, ListUsersQueryParams, GetUserParams, UpdateUserParams, UpdateUserStatusParams, DeleteUserParams } from "@workspace/api-zod";

const router = Router();

function safeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

router.get("/users", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListUsersQueryParams.safeParse(req.query);
  const { role, status, search } = params.success ? params.data : {};

  const conditions: SQL[] = [];
  if (role) conditions.push(eq(usersTable.role, role as "admin" | "manager" | "worker"));
  if (status) conditions.push(eq(usersTable.status, status as "active" | "pending" | "suspended"));
  if (search) conditions.push(ilike(usersTable.name, `%${search}%`));

  const users = await db.select().from(usersTable).where(conditions.length ? and(...conditions) : undefined);
  res.json(users.map(safeUser));
});

router.post("/users", requireAuth, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password, name, role, phone, skills, experience } = parsed.data;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name, email, passwordHash,
    role: role as "admin" | "manager" | "worker",
    status: "active",
    phone: phone ?? null,
    skills: skills ?? null,
    experience: experience ?? null,
  }).returning();
  res.status(201).json(safeUser(user));
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(safeUser(user));
});

router.patch("/users/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(safeUser(user));
});

router.delete("/users/:id", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  res.sendStatus(204);
});

router.patch("/users/:id/status", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const params = UpdateUserStatusParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateUserStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.update(usersTable)
    .set({ status: parsed.data.status as "active" | "pending" | "suspended" })
    .where(eq(usersTable.id, params.data.id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(safeUser(user));
});

export default router;
