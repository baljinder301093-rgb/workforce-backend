import { Router } from "express";
import { eq, and, SQL } from "drizzle-orm";
import { db, applicationsTable, usersTable, projectsTable } from "@workspace/db";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import {
  CreateApplicationBody, UpdateApplicationStatusBody,
  ListApplicationsQueryParams, GetApplicationParams,
  UpdateApplicationStatusParams
} from "@workspace/api-zod";
import { createNotification } from "../lib/sse";

const router = Router();

async function enrichApplication(app: typeof applicationsTable.$inferSelect) {
  const [worker] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, app.workerId));
  const [project] = await db.select({ title: projectsTable.title, managerId: projectsTable.managerId }).from(projectsTable).where(eq(projectsTable.id, app.projectId));
  return { ...app, workerName: worker?.name ?? null, projectTitle: project?.title ?? null, managerId: project?.managerId ?? null };
}

router.get("/applications", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListApplicationsQueryParams.safeParse(req.query);
  const { projectId, workerId, status } = params.success ? params.data : {};
  const conditions: SQL[] = [];
  if (projectId) conditions.push(eq(applicationsTable.projectId, Number(projectId)));
  if (workerId) conditions.push(eq(applicationsTable.workerId, Number(workerId)));
  if (status) conditions.push(eq(applicationsTable.status, status as "pending" | "approved" | "rejected"));

  if (req.userRole === "worker") {
    conditions.push(eq(applicationsTable.workerId, req.userId!));
  }

  const apps = await db.select().from(applicationsTable).where(conditions.length ? and(...conditions) : undefined);
  const enriched = await Promise.all(apps.map(enrichApplication));
  res.json(enriched);
});

router.post("/applications", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateApplicationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [app] = await db.insert(applicationsTable).values({
    projectId: parsed.data.projectId,
    workerId: req.userId!,
    coverNote: parsed.data.coverNote ?? null,
    status: "pending",
  }).returning();
  const enriched = await enrichApplication(app);

  if (enriched.managerId) {
    const [worker] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.userId!));
    await createNotification({
      userId: enriched.managerId,
      type: "new_application",
      title: "New Job Application",
      message: `${worker?.name ?? "A worker"} applied for "${enriched.projectTitle}"`,
      relatedId: app.id,
    });
  }

  res.status(201).json(enriched);
});

router.get("/applications/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetApplicationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [app] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, params.data.id));
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  res.json(await enrichApplication(app));
});

router.patch("/applications/:id/status", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateApplicationStatusParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateApplicationStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, params.data.id));
  const [app] = await db.update(applicationsTable)
    .set({ status: parsed.data.status as "pending" | "approved" | "rejected" })
    .where(eq(applicationsTable.id, params.data.id))
    .returning();
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }
  const enriched = await enrichApplication(app);

  if (existing && parsed.data.status !== "pending") {
    const approved = parsed.data.status === "approved";
    await createNotification({
      userId: app.workerId,
      type: approved ? "application_approved" : "application_rejected",
      title: approved ? "Application Approved!" : "Application Update",
      message: approved
        ? `Your application for "${enriched.projectTitle}" has been approved. Get ready to start!`
        : `Your application for "${enriched.projectTitle}" was not selected this time.`,
      relatedId: app.id,
    });
  }

  res.json(enriched);
});

export default router;
