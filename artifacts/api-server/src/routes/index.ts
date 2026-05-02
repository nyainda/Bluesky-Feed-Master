import { Router, type IRouter } from "express";
import healthRouter from "./health";
import feedsRouter from "./feeds";
import statsRouter from "./stats";
import publishRouter from "./publish";
import analyticsRouter from "./analytics";
import audienceRouter from "./audience";

const router: IRouter = Router();

router.use(healthRouter);
router.use(feedsRouter);
router.use(statsRouter);
router.use(publishRouter);
router.use(analyticsRouter);
router.use(audienceRouter);

export default router;
