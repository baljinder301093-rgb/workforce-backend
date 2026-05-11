import { Router } from "express";
import { eq, ilike, and, SQL } from "drizzle-orm";
import { db, projectsTable, usersTable } from "@workspace/db";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import {
  CreateProjectBody, UpdateProjectBody, UpdateProjectStatusBody,
  ListProjectsQueryParams, GetProjectParams, UpdateProjectParams,
  UpdateProjectStatusParams, DeleteProjectParams
} from "@workspace/api-zod";

const router = Router();

async function enrichProject(project: typeof projectsTable.$inferSelect) {
  let managerName: string | null = null;
  if (project.managerId) {
    const [mgr] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, project.managerId));
    managerName = mgr?.name ?? null;
  }
  return { ...project, managerName };
}

router.get("/projects", async (req, res): Promise<void> => {
  const params = ListProjectsQueryParams.safeParse(req.query);
  const { status, managerId, search } = params.success ? params.data : {};

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(projectsTable.status, status as "open" | "in_progress" | "completed" | "cancelled"));
  if (managerId) conditions.push(eq(projectsTable.managerId, Number(managerId)));
  if (search) conditions.push(ilike(projectsTable.title, `%${search}%`));

  const projects = await db.select().from(projectsTable).where(conditions.length ? and(...conditions) : undefined);
  const enriched = await Promise.all(projects.map(enrichProject));
  res.json(enriched);
});

router.post("/projects", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { startDate, endDate, ...rest } = parsed.data;
  const [project] = await db.insert(projectsTable).values({
    ...rest,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    managerId: rest.managerId ?? null,
    safetyInstructions: rest.safetyInstructions ?? null,
  }).returning();
  res.status(201).json(await enrichProject(project));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(await enrichProject(project));
});

router.patch("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { startDate, endDate, ...rest } = parsed.data;
  const updateData: Record<string, unknown> = { ...rest };
  if (startDate) updateData.startDate = new Date(startDate);
  if (endDate) updateData.endDate = new Date(endDate);
  const [project] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, params.data.id)).returning();
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(await enrichProject(project));
});

router.delete("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(projectsTable).where(eq(projectsTable.id, params.data.id));
  res.sendStatus(204);
});

router.patch("/projects/:id/status", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateProjectStatusParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateProjectStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [project] = await db.update(projectsTable)
    .set({ status: parsed.data.status as "open" | "in_progress" | "completed" | "cancelled" })
    .where(eq(projectsTable.id, params.data.id))
    .returning();
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(await enrichProject(project));
});

export default router;
