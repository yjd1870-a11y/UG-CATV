import router from '../routes/manual';
import type { ApiModule } from './types';
export const manualModule: ApiModule = { name: '현장 장비 매뉴얼', routes: [{ path: '/api/manual', router }] };
