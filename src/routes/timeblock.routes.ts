import { Router } from 'express';
import { verifyServiceKeyOrPrivyToken } from '../middleware/service-auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { idParamSchema, createTimeBlockSchema, listTimeBlocksQuerySchema } from '../middleware/schemas';
import {
  cancelTimeBlock,
  createTimeBlock,
  getTimeBlock,
  listTimeBlocks,
} from '../controllers/timeblock.controller';

const router = Router();

router.use(verifyServiceKeyOrPrivyToken);

router.post('/', validateBody(createTimeBlockSchema), createTimeBlock);
router.get('/', validateQuery(listTimeBlocksQuerySchema), listTimeBlocks);
router.get('/:id', validateParams(idParamSchema), getTimeBlock);
router.post('/:id/cancel', validateParams(idParamSchema), cancelTimeBlock);

export default router;

