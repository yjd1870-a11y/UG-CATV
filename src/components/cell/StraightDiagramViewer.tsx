import React from 'react';
import { Radio } from 'lucide-react';
import type { CellInfo } from '../../types';
import { StraightMapViewer } from './StraightMapViewer';

export const StraightDiagramViewer: React.FC<{ cell: CellInfo }> = ({ cell }) => {
  const { diagramData } = cell;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#173B57]"><Radio className="h-4 w-4" />{cell.cellName} HFC 전송선로 직선도</h2>
        <p className="mt-0.5 text-xs text-slate-500">기존 CELL 검색 키로 Excel 직선도 좌표를 조회합니다.</p>
      </div>
      <StraightMapViewer
        title={`${cell.cellName} 직선도`}
        stationName={cell.stationDetails?.stationName || cell.stationInfo}
        matchLength={6}
        searchKeys={[cell.cellName, cell.stationDetails?.descriptionCode]}
      />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          ['광수신 레벨 (Rx)', diagramData.opticalRxLevel || '-1.2 dBm'],
          ['하향 RF 출력', diagramData.rfOutLevel || '+38 dBmV'],
          ['상향 송신 레벨', diagramData.returnLevel || '+42 dBmV'],
          ['전송 주파수대역', diagramData.freqBand || '54 ~ 1002 MHz'],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-2.5"><div className="text-[11px] font-bold text-slate-600">{label}</div><div className="mt-1 font-black text-[#173B57]">{value}</div></div>)}
      </div>
    </div>
  );
};
