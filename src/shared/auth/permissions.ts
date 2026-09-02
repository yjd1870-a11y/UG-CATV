import type { UserRole } from '../../types';

export const isGuest = (role: UserRole | undefined): role is 'guest' => role === 'guest';

/** 게스트는 모든 업무 화면을 조회만 할 수 있습니다. */
export const canWriteDailyWork = (role: UserRole | undefined) => Boolean(role && role !== 'guest');
export const canProcessTransfer = (role: UserRole | undefined) => Boolean(role && role !== 'guest');

/** 매니져와 게스트는 CATV 인력/차량 현황을 조회만 할 수 있습니다. */
export const canEditCatvManpower = (role: UserRole | undefined) => Boolean(role && role !== 'manager' && role !== 'guest');

/** 매니져와 게스트는 전송망 일일업무 Excel 파일을 내려받을 수 없습니다. */
export const canExportDailyWork = (role: UserRole | undefined) => Boolean(role && role !== 'manager' && role !== 'guest');
