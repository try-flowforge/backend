import { Router } from 'express';
import userRoutes from './user.routes';
import relayRoutes from './relay.routes';
import slackRoutes from './integrations/slack.routes';
import workflowRoutes from './workflow.routes';
import swapRoutes from './swap.routes';

const router = Router();

// Health check endpoint
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

// API routes
router.use('/users', userRoutes);
router.use('/relay', relayRoutes);
router.use('/integrations/slack', slackRoutes);
router.use('/workflows', workflowRoutes);
router.use('/swaps', swapRoutes);

export default router;
