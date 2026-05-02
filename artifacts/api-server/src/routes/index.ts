import { Router, type IRouter } from "express";
import healthRouter from "./health";
import feedsRouter from "./feeds";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(feedsRouter);
router.use(statsRouter);

export default router;
