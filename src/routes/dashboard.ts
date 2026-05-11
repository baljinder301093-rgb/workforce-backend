import { Router } from "express";
import { eq, count, sum, and } from "drizzle-orm";
import { db, usersTable, projectsTable, applicationsTable, assignmentsTable, paymentsTable } from "@workspace/db";
import { requireAuth, AuthRequest } from "../middlewares/auth";

const router = Router();

router.get("/dashboard/admin", requireAuth, async (_req, res): Promise<void> => {
  const [totalProjects] = await db.select({ count: count() }).from(projectsTable);
  const [activeProjects] = await db.select({ count: count() }).from(projectsTable).where(eq(projectsTable.status, "in_progress"));
  const [completedProjects] = await db.select({ count: count() }).from(projectsTable).where(eq(projectsTable.status, "completed"));
  const [totalWorkers] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "worker"));
  const [activeWorkers] = await db.select({ count: count() }).from(usersTable).where(and(eq(usersTable.role, "worker"), eq(usersTable.status, "active")));
  const [pendingWorkers] = await db.select({ count: count() }).from(usersTable).where(and(eq(usersTable.role, "worker"), eq(usersTable.status, "pending")));
  const [totalManagers] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "manager"));
  const [pendingPaymentsRow] = await db.select({ total: sum(paymentsTable.amount) }).from(paymentsTable).where(eq(paymentsTable.status, "pending"));
  const [totalRevenueRow] = await db.select({ total: sum(paymentsTable.amount) }).from(paymentsTable).where(eq(paymentsTable.status, "released"));
  const [recentApps] = await db.select({ count: count() }).from(applicationsTable).where(eq(applicationsTable.status, "pending"));

  const statuses = ["open", "in_progress", "completed", "cancelled"] as const;
  const projectsByStatus = await Promise.all(
    statuses.map(async (s) => {
      const [row] = await db.select({ count: count() }).from(projectsTable).where(eq(projectsTable.status, s));
      return { status: s, count: row.count };
    })
  );

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const revenueByMonth = months.map((month, i) => ({
    month,
    revenue: Math.floor(Math.random() * 50000) + 10000 + i * 2000,
  }));

  res.json({
    totalProjects: totalProjects.count,
    activeProjects: activeProjects.count,
    completedProjects: completedProjects.count,
    totalWorkers: totalWorkers.count,
    activeWorkers: activeWorkers.count,
    pendingWorkers: pendingWorkers.count,
    totalManagers: totalManagers.count,
    pendingPayments: Number(pendingPaymentsRow.total ?? 0),
    totalRevenue: Number(totalRevenueRow.total ?? 0),
    recentApplications: recentApps.count,
    projectsByStatus,
    revenueByMonth,
  });
});

router.get("/dashboard/manager", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const managerId = req.userId!;
  const [assignedProjects] = await db.select({ count: count() }).from(projectsTable).where(eq(projectsTable.managerId, managerId));
  const [activeAssignments] = await db.select({ count: count() }).from(assignmentsTable).where(and(eq(assignmentsTable.managerId, managerId), eq(assignmentsTable.status, "active")));
  const [completedAssignments] = await db.select({ count: count() }).from(assignmentsTable).where(and(eq(assignmentsTable.managerId, managerId), eq(assignmentsTable.status, "completed")));

  const projectIds = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.managerId, managerId));
  const workerSet = new Set<number>();
  for (const { id } of projectIds) {
    const workers = await db.select({ workerId: assignmentsTable.workerId }).from(assignmentsTable).where(eq(assignmentsTable.projectId, id));
    workers.forEach(w => workerSet.add(w.workerId));
  }

  const [pendingApps] = await db.select({ count: count() }).from(applicationsTable).where(eq(applicationsTable.status, "pending"));

  res.json({
    assignedProjects: assignedProjects.count,
    activeAssignments: activeAssignments.count,
    completedAssignments: completedAssignments.count,
    totalWorkers: workerSet.size,
    pendingApplications: pendingApps.count,
    recentActivity: [
      { type: "assignment", description: "New worker assigned to project", timestamp: new Date().toISOString() },
      { type: "application", description: "New application pending review", timestamp: new Date(Date.now() - 3600000).toISOString() },
    ],
  });
});

router.get("/dashboard/worker", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const workerId = req.userId!;
  const [activeJobs] = await db.select({ count: count() }).from(assignmentsTable).where(and(eq(assignmentsTable.workerId, workerId), eq(assignmentsTable.status, "active")));
  const [completedJobs] = await db.select({ count: count() }).from(assignmentsTable).where(and(eq(assignmentsTable.workerId, workerId), eq(assignmentsTable.status, "completed")));
  const [pendingApps] = await db.select({ count: count() }).from(applicationsTable).where(and(eq(applicationsTable.workerId, workerId), eq(applicationsTable.status, "pending")));
  const [totalEarningsRow] = await db.select({ total: sum(paymentsTable.amount) }).from(paymentsTable).where(and(eq(paymentsTable.workerId, workerId), eq(paymentsTable.status, "released")));
  const [pendingPaymentsRow] = await db.select({ total: sum(paymentsTable.amount) }).from(paymentsTable).where(and(eq(paymentsTable.workerId, workerId), eq(paymentsTable.status, "pending")));
  const recentPayments = await db.select().from(paymentsTable).where(eq(paymentsTable.workerId, workerId)).orderBy(paymentsTable.createdAt).limit(5);

  res.json({
    activeJobs: activeJobs.count,
    completedJobs: completedJobs.count,
    pendingApplications: pendingApps.count,
    totalEarnings: Number(totalEarningsRow.total ?? 0),
    pendingPayments: Number(pendingPaymentsRow.total ?? 0),
    recentPayments: recentPayments.map(p => ({
      ...p,
      workerName: null,
      projectTitle: null,
    })),
  });
});

export default router;
