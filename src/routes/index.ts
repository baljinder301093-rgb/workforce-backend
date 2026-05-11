import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import projectsRouter from "./projects";
import applicationsRouter from "./applications";
import assignmentsRouter from "./assignments";
import paymentsRouter from "./payments";
import messagesRouter from "./messages";
import dashboardRouter from "./dashboard";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(projectsRouter);
router.use(applicationsRouter);
router.use(assignmentsRouter);
router.use(paymentsRouter);
router.use(messagesRouter);
router.use(dashboardRouter);
router.use(notificationsRouter);

export default router;
