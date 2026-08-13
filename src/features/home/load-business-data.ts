import { cellsApi } from '../cells/api';
import { transfersApi } from '../transfers/api';
import { dailyWorkApi } from '../daily-work/api';
import { materialsApi } from '../materials/api';

export const loadBusinessData = async () => {
  const [cells, transfers, dailyRecords, materialUsage] = await Promise.all([
    cellsApi.list(),
    transfersApi.list(),
    dailyWorkApi.list(),
    materialsApi.usage(),
  ]);
  return { cells, transfers, dailyRecords, materialUsage };
};
