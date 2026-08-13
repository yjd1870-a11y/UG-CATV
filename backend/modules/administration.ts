import adminDailyWorkRouter from '../routes/admin-daily-work';
import adminRouter from '../routes/admin';
import type { ApiModule } from './types';

export const administrationModule: ApiModule = {
  name: '관리자',
  routes: [
    // 더 구체적인 주소를 먼저 등록해야 /api/admin 라우터에 가로채이지 않습니다.
    { path: '/api/admin/daily-work', router: adminDailyWorkRouter },
    { path: '/api/admin', router: adminRouter },
  ],
};
