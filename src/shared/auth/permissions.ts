import type { UserRole } from '../../types';

/** 매니져는 CATV 인력/차량 현황을 조회만 할 수 있습니다. */
export const canEditCatvManpower = (role: UserRole | undefined) => Boolean(role && role !== 'manager');

/** 매니져는 전송망 일일업무 Excel 파일을 내려받을 수 없습니다. */
export const canExportDailyWork = (role: UserRole | undefined) => Boolean(role && role !== 'manager');
