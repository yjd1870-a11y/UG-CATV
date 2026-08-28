import dailyWorkRouter from '../routes/daily-work';
import materialsRouter, { materialUsageRouter } from '../routes/materials';
import noticesRouter from '../routes/notices';
import workTransfersRouter from '../routes/work-transfers';
import workTransferAnalyticsRouter from '../routes/work-transfer-analytics';
import manpowerRouter from '../routes/manpower';
import type { ApiModule } from './types';

export const operationsModule: ApiModule = {
  name: '업무 운영',
  routes: [
    { path: '/api/notices', router: noticesRouter },
    { path: '/api/work-transfers/analytics', router: workTransferAnalyticsRouter },
    { path: '/api/work-transfers', router: workTransfersRouter },
    { path: '/api/daily-work', router: dailyWorkRouter },
    { path: '/api/materials', router: materialsRouter },
    { path: '/api/material-usage', router: materialUsageRouter },
    { path: '/api/manpower', router: manpowerRouter },
  ],
};
