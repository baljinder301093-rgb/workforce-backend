import { Router } from "express";
import { eq, and, SQL } from "drizzle-orm";
import { db, assignmentsTable, usersTable, projectsTable } from "@workspace/db";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import {
  CreateAssignmentBody, UpdateAssignmentBody,
  ListAssignmentsQueryParams, UpdateAssignmentParams,
  DeleteAssignmentParams, CompleteAssignmentParams
} from "@workspace/api-zod";
import { createNotification } from "../lib/sse";

const router = Router();

async function enrichAssignment(a: typeof assignmentsTable.$inferSelect) {
  const [worker] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, a.workerId));
  const [manager] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, a.managerId));
  const [project] = await db.select({ title: projectsTable.title }).from(projectsTable).where(eq(projectsTable.id, a.projectId));
  return {
    ...a,
    workerName: worker?.name ?? null,
    managerName: manager?.name ?? null,
    projectTitle: project?.title ?? null,
  };
}

router.get("/assignments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListAssignmentsQueryParams.safeParse(req.query);
  const { projectId, workerId, managerId, status } = params.success ? params.data : {};
  const conditions: SQL[] = [];
  if (projectId) conditions.push(eq(assignmentsTable.projectId, Number(projectId)));
  if (workerId) conditions.push(eq(assignmentsTable.workerId, Number(workerId)));
  if (managerId) conditions.push(eq(assignmentsTable.managerId, Number(managerId)));
  if (status) conditions.push(eq(assignmentsTable.status, status as "active" | "completed" | "cancelled"));

  if (req.userRole === "worker") {
    conditions.push(eq(assignmentsTable.workerId, req.userId!));
  } else if (req.userRole === "manager") {
    conditions.push(eq(assignmentsTable.managerId, req.userId!));
  }

  const assignments = await db.select().from(assignmentsTable).where(conditions.length ? and(...conditions) : undefined);
  const enriched = await Promise.all(assignments.map(enrichAssignment));
  res.json(enriched);
});

router.post("/assignments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [assignment] = await db.insert(assignmentsTable).values({
    projectId: parsed.data.projectId,
    workerId: parsed.data.workerId,
    managerId: parsed.data.managerId,
    notes: parsed.data.notes ?? null,
    status: "active",
  }).returning();
  const enriched = await enrichAssignment(assignment);

  await createNotification({
    userId: assignment.workerId,
    type: "assignment_created",
    title: "New Assignment",
    message: `You've been assigned to "${enriched.projectTitle}". ${enriched.notes ? `Note: ${enriched.notes}` : ""}`.trim(),
    relatedId: assignment.id,
  });

  res.status(201).json(enriched);
});

router.patch("/assignments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAssignmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [assignment] = await db.update(assignmentsTable).set(parsed.data).where(eq(assignmentsTable.id, params.data.id)).returning();
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }
  res.json(await enrichAssignment(assignment));
});

router.delete("/assignments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteAssignmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(assignmentsTable).where(eq(assignmentsTable.id, params.data.id));
  res.sendStatus(204);
});

router.patch("/assignments/:id/complete", requireAuth, async (req, res): Promise<void> => {
  const params = CompleteAssignmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [assignment] = await db.update(assignmentsTable)
    .set({ status: "completed", endDate: new Date() })
    .where(eq(assignmentsTable.id, params.data.id))
    .returning();
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }
  const enriched = await enrichAssignment(assignment);

  await createNotification({
    userId: assignment.workerId,
    type: "assignment_completed",
    title: "Assignment Completed",
    message: `Your assignment for "${enriched.projectTitle}" has been marked as complete.`,
    relatedId: assignment.id,
  });

  res.json(enriched);
});

export default router;
