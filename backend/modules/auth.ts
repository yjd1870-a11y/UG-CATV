import authRouter from '../routes/auth';
import type { ApiModule } from './types';

export const authModule: ApiModule = {
  name: '인증',
  routes: [{ path: '/api/auth', router: authRouter }],
};
