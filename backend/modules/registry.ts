import type { Express } from 'express';
import { administrationModule } from './administration';
import { authModule } from './auth';
import { materialManagementModule } from './material-management';
import { networkModule } from './network';
import { operationsModule } from './operations';
import type { ApiModule } from './types';
import { manualModule } from './manual';
import { initializeManualModule } from '../routes/manual';

export const apiModules: ApiModule[] = [
  authModule,
  administrationModule,
  networkModule,
  operationsModule,
  materialManagementModule,
  manualModule,
];

export const registerApiModules = (app: Express) => {
  initializeManualModule();
  for (const module of apiModules) {
    for (const route of module.routes) {
      app.use(route.path, route.router);
    }
  }
};
