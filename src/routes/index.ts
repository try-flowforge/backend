import { Router } from 'express';
import userRoutes from './user.routes';
import relayRoutes from './relay.routes';

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

export default router;
