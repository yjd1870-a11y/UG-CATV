export const WORK_TRANSFER_REGION_NAMES = ['평택안성', '용인', '수원', '오산화성'] as const;

export const workTransferRegionPlaceholders = WORK_TRANSFER_REGION_NAMES.map(() => '?').join(', ');

export const workTransferRegionParams = [...WORK_TRANSFER_REGION_NAMES];
