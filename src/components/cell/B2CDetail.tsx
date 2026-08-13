import React, { useState } from 'react';
import { ArrowLeft, Route, X } from 'lucide-react';
import type { CatvB2CLine } from '../../types';
import { StraightMapViewer } from './StraightMapViewer';

const value = (text?: string) => text?.trim() || '-';

export const B2CDetail: React.FC<{ line: CatvB2CLine; onBack: () => void }> = ({ line, onBack }) => {
  const [showDiagram, setShowDiagram] = useState(false);
  return (
    <div className="space-y-4 pb-24 sm:pb-8">
      <button type="button" onClick={onBack} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-extrabold text-[#173B57]"><ArrowLeft className="h-4 w-4" />B2C 목록</button>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-black text-[#173B57]">B2C : {value(line.serviceName || line.b2cName)}</h1>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          {[['국사', line.stationName], ['노드명', line.node], ['코어', line.core || line.line], ['서비스 회선번호', line.serviceLineNumber], ['서비스 구분', line.serviceCategory], ['서비스 타입', line.serviceType], ['원본', line.sourceFile]].map(([label, content]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-500">{label}</span><strong className="mt-1 block text-[#173B57]">{value(content)}</strong></div>)}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-extrabold text-[#173B57]">비고</h2>
        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><strong className="block text-[#173B57]">B2C: {value(line.serviceName || line.b2cName)}</strong><span className="mt-1 block whitespace-pre-wrap">{value(line.memo)}</span></div>
        <button type="button" onClick={() => setShowDiagram(true)} className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-4 text-xs font-bold text-[#2878B5]"><Route className="h-4 w-4" />직선도</button>
      </section>
      {showDiagram ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/75 p-3 backdrop-blur-xs sm:p-5">
          <div className="mx-auto max-w-7xl rounded-2xl bg-white p-3 shadow-2xl sm:p-5">
            <div className="mb-3 flex items-center justify-between"><div><h2 className="font-black text-[#173B57]">B2C 직선도</h2><p className="text-xs text-slate-500">원본: {line.sourceFile || 'DB 조회 결과'}</p></div><button type="button" onClick={() => setShowDiagram(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="직선도 닫기"><X className="h-5 w-5" /></button></div>
            <StraightMapViewer stationName={line.stationName} matchLength={5} searchKeys={[line.serviceName, line.serviceLineNumber, line.memo, ...line.searchValues]} title="B2C 직선도" />
          </div>
        </div>
      ) : null}
    </div>
  );
};
