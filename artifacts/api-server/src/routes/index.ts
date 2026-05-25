import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import deviceRouter from "./device";

const router: IRouter = Router();

router.use(healthRouter);
router.use(deviceRouter);
router.use(adminRouter);

export default router;
