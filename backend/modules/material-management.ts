import inventoryRouter from '../routes/inventory';
import materialsRouter, { materialUsageRouter } from '../routes/materials';
import type { ApiModule } from './types';

/**
 * 자재 관련 API의 단일 등록 지점입니다.
 * CELL, 업무이관, 일일업무 모듈과 라우트 등록을 분리해 배포 범위를 제한합니다.
 */
export const materialManagementModule: ApiModule = {
  name: '자재 관리',
  routes: [
    { path: '/api/materials', router: materialsRouter },
    { path: '/api/material-usage', router: materialUsageRouter },
    { path: '/api/material-management', router: inventoryRouter },
  ],
};
