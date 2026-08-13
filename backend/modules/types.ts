import type { Router } from 'express';

export interface ApiRouteRegistration {
  path: string;
  router: Router;
}

export interface ApiModule {
  /** 사람이 알아보기 쉬운 업무 영역 이름입니다. */
  name: string;
  routes: ApiRouteRegistration[];
}
