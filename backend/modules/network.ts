import b2cRouter from '../routes/b2c';
import cellsRouter from '../routes/cells';
import floorPlansRouter from '../routes/floor-plans';
import straightMapsRouter from '../routes/straight-maps';
import type { ApiModule } from './types';

export const networkModule: ApiModule = {
  name: '망/CELL 조회',
  routes: [
    { path: '/api/cells', router: cellsRouter },
    { path: '/api/b2c', router: b2cRouter },
    { path: '/api/floor-plans', router: floorPlansRouter },
    { path: '/api/straight-maps', router: straightMapsRouter },
  ],
};
