import type { Express } from 'express';
import { administrationModule } from './administration';
import { authModule } from './auth';
import { networkModule } from './network';
import { operationsModule } from './operations';
import type { ApiModule } from './types';

export const apiModules: ApiModule[] = [
  authModule,
  administrationModule,
  networkModule,
  operationsModule,
];

export const registerApiModules = (app: Express) => {
  for (const module of apiModules) {
    for (const route of module.routes) {
      app.use(route.path, route.router);
    }
  }
};
