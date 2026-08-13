import React, { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  ChevronRight,
  Copy,
  History,
  Route,
  Server,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { catvApi } from '../../features/cells/api';
import type { CatvCell } from '../../types';
import { CatvCellHistorySection } from './CatvCellHistorySection';
import { FloorPlanViewer } from './FloorPlanViewer';
import { StraightMapViewer } from './StraightMapViewer';

type DetailTab = '국사현황' | 'HFC현황' | '직선도' | '작업이력';
type FloorTarget = { target: string; type: 'node' | 'rack'; equipment: string };

const value = (text?: string) => text?.trim() || '-';

const tabs: Array<{ id: DetailTab; icon: React.ComponentType<{ className?: string }> }> = [
  { id: '국사현황', icon: Building2 },
  { id: 'HFC현황', icon: Activity },
  { id: '작업이력', icon: History },
];

export const CatvCellDetail: React.FC<{ cell: CatvCell; onBack: () => void }> = ({ cell, onBack }) => {
  const { navigateTo, showToast } = useApp();
  const [detail, setDetail] = useState(cell);
  const [activeTab, setActiveTab] = useState<DetailTab>('국사현황');
  const [floorTarget, setFloorTarget] = useState<FloorTarget | null>(null);

  const circuitRows = [
    ['OTX (주)', detail.otxMain, detail.otxLine, 'OTX'],
    ['ORX (주)', detail.orxMain, detail.orxLine, 'ORX'],
    ['예비', detail.backup, detail.backupLine, '예비'],
  ] as const;
  const deviceRows = [
    ['OTX', detail.otxRack, detail.otxShelf, detail.otxPort, detail.otxModel],
    ['ORX', detail.orxRack, detail.orxShelf, detail.orxPort, detail.orxModel],
  ] as const;

  const reloadDetail = async () => {
    setDetail(await catvApi.getCell(detail.id));
  };

  const copyCellName = async () => {
    try {
      await navigator.clipboard.writeText(detail.cellName);
      showToast(`CELL명 ${detail.cellName}을 복사했습니다.`, 'info');
    } catch {
      showToast('CELL명을 복사하지 못했습니다.', 'error');
    }
  };

  const openPlan = (target: string, type: FloorTarget['type'], equipment: string) => {
    if (!target) return;
    setFloorTarget({ target, type, equipment });
  };

  const historySection = (
    <CatvCellHistorySection
      cellId={detail.id}
      cellName={detail.cellName}
      history={detail.history || []}
      onChanged={reloadDetail}
    />
  );

  return (
    <div id="catv-cell-detail" className="space-y-4 pb-24 text-[#1F2937] sm:pb-8">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-extrabold text-[#173B57] shadow-sm transition hover:border-blue-200 hover:text-[#2878B5]">
          <ArrowLeft className="h-4 w-4" /> CELL 목록
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void copyCellName()} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition hover:text-[#173B57]">
            <Copy className="h-4 w-4" /> <span className="hidden sm:inline">CELL명 복사</span>
          </button>
          <button type="button" onClick={() => navigateTo('material_list')} className="h-10 rounded-xl bg-[#F28C28] px-4 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#dd7b1d]">
            자재사용 등록
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-black tracking-tight text-[#173B57] sm:text-2xl">CELL : {detail.cellName.replace(/^#/, '')}</h1>
        </div>
        <div className="mt-4 flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2">
          {tabs.map(({ id, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)} className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-xs font-extrabold transition ${activeTab === id ? 'bg-[#173B57] text-white shadow-sm' : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-[#173B57]'}`}>
              <Icon className="h-4 w-4" /> {id}
            </button>
          ))}
        </div>
      </section>

      {activeTab === '국사현황' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-black text-[#173B57] sm:text-lg"><span className="h-2.5 w-2.5 rounded-full bg-[#173B57]" />국사 정보</h2>
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 text-xs">
              <div className="grid md:grid-cols-2">
                <div className="grid grid-cols-[112px_1fr] border-b border-slate-200 md:border-r">
                  <div className="flex items-center justify-center border-r border-slate-200 bg-slate-50 p-3 font-bold text-slate-600">설명</div>
                  <div className="flex items-center p-3 font-bold text-[#173B57]">{value(detail.cellName)}</div>
                </div>
                <div className="grid grid-cols-[112px_1fr] border-b border-slate-200">
                  <div className="flex items-center justify-center border-r border-slate-200 bg-slate-50 p-3 font-bold text-slate-600">국사</div>
                  <div className="flex items-center p-3 font-bold text-[#173B57]">{value(detail.stationName)}</div>
                </div>
              </div>
              <div className="grid grid-cols-[112px_1fr]">
                <div className="flex items-center justify-center border-r border-slate-200 bg-slate-50 p-3 font-bold text-slate-600">국사주소</div>
                <div className="flex items-center p-3 font-semibold text-slate-700">{value(detail.stationAddress)}</div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-black text-[#173B57] sm:text-lg"><span className="h-2.5 w-2.5 rounded-full bg-[#173B57]" />국사 현황</h2>
              <button type="button" onClick={() => setActiveTab('직선도')} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-4 text-xs font-extrabold text-white shadow-md transition hover:from-orange-600 hover:to-amber-700 active:scale-95 sm:px-6 sm:text-sm">
                직선도 보기 <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-2">
              <h3 className="text-xs font-extrabold text-slate-700">선번정보</h3>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full table-fixed text-center text-[11px] sm:text-xs">
                  <thead className="bg-[#173B57] text-white"><tr><th className="w-[25%] p-2.5 sm:w-auto sm:p-3">항목</th><th className="w-[45%] p-2.5 sm:w-auto sm:p-3">노드</th><th className="w-[30%] p-2.5 sm:w-auto sm:p-3">선번</th><th className="hidden w-24 p-3 sm:table-cell">평면도</th></tr></thead>
                  <tbody className="divide-y divide-slate-200">{circuitRows.map(([label, node, line, equipment]) => (
                    <tr key={label}><td className="border-r border-slate-200 p-2 font-extrabold text-[#173B57] sm:p-3"><span className="block">{label}</span><button type="button" disabled={!node} onClick={() => openPlan(node, 'node', equipment)} className="mt-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[9px] font-bold text-[#2878B5] disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 sm:hidden">평면도</button></td><td className="break-words border-r border-slate-200 p-2.5 sm:p-3">{value(node)}</td><td className="p-2.5 font-mono sm:border-r sm:border-slate-200 sm:p-3">{value(line)}</td><td className="hidden p-2 sm:table-cell"><button type="button" disabled={!node} onClick={() => openPlan(node, 'node', equipment)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-[#2878B5] disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300">이동</button></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <h3 className="flex items-center gap-2 text-xs font-extrabold text-slate-700"><span className="h-4 w-1 rounded bg-[#173B57]" />송수신기 정보</h3>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full table-fixed text-center text-[10px] sm:text-xs">
                  <thead className="bg-[#173B57] text-white"><tr><th className="w-[18%] p-2 sm:w-auto sm:p-3">항목</th><th className="w-[14%] p-2 sm:w-auto sm:p-3">랙</th><th className="w-[14%] p-2 sm:w-auto sm:p-3">쉘프</th><th className="w-[14%] p-2 sm:w-auto sm:p-3">포트</th><th className="w-[40%] p-2 sm:w-auto sm:p-3">모델명</th><th className="hidden w-24 p-3 sm:table-cell">평면도</th></tr></thead>
                  <tbody className="divide-y divide-slate-200">{deviceRows.map(([label, rack, shelf, port, model]) => (
                    <tr key={label}><td className="border-r border-slate-200 p-2 font-extrabold text-[#173B57] sm:p-3"><span className="block">{label}</span><button type="button" disabled={!rack} onClick={() => openPlan(rack, 'rack', label)} className="mt-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[9px] font-bold text-[#2878B5] disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 sm:hidden">평면도</button></td><td className="border-r border-slate-200 p-2 font-mono sm:p-3">{value(rack)}</td><td className="border-r border-slate-200 p-2 font-mono sm:p-3">{value(shelf)}</td><td className="border-r border-slate-200 p-2 font-mono sm:p-3">{value(port)}</td><td className="break-words p-2 font-semibold sm:border-r sm:border-slate-200 sm:p-3">{value(model)}</td><td className="hidden p-2 sm:table-cell"><button type="button" disabled={!rack} onClick={() => openPlan(rack, 'rack', label)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-[#2878B5] disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300">이동</button></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </section>
          {historySection}
        </div>
      ) : null}

      {activeTab === 'HFC현황' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="flex items-center gap-2 text-base font-black text-[#173B57] sm:text-lg"><span className="h-2.5 w-2.5 rounded-full bg-[#173B57]" />HFC 현황</h2>
            <div className="mt-5 space-y-5">
              <article className="rounded-2xl border border-slate-200 p-5 sm:p-6">
                <h3 className="flex items-center gap-2 text-base font-black text-[#173B57]"><span className="h-5 w-1.5 rounded bg-[#173B57]" />ONU</h3>
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 text-xs">
                  <InfoRow label="위치" value={value(detail.onuLocation)} full />
                  <div className="grid md:grid-cols-2"><InfoRow label="제조사" value={value(detail.onuMaker)} /><InfoRow label="모델명" value={value(detail.onuModel)} /></div>
                  <div className="grid md:grid-cols-2"><InfoRow label="분할구분" value={value(detail.onuSplit)} /><InfoRow label="셀구성" value={value(detail.onuCellConfig)} /></div>
                </div>
              </article>
              <article className="rounded-2xl border border-slate-200 p-5 sm:p-6">
                <h3 className="flex items-center gap-2 text-base font-black text-[#173B57]"><span className="h-5 w-1.5 rounded bg-[#173B57]" />UPS</h3>
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 text-xs">
                  <InfoRow label="위치" value={value(detail.upsLocation)} full />
                  <div className="grid md:grid-cols-2"><InfoRow label="제조사" value={value(detail.upsMaker)} /><InfoRow label="모델명" value={value(detail.upsModel)} /></div>
                </div>
              </article>
            </div>
          </section>
          {historySection}
        </div>
      ) : null}

      {activeTab === '직선도' ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-black text-[#173B57] sm:text-lg"><Route className="h-5 w-5" />직선도</h2>
              <p className="mt-1 text-xs text-slate-500">{detail.cellName} HFC 전송선로</p>
            </div>
            <button type="button" onClick={() => setActiveTab('국사현황')} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-[#173B57] hover:bg-slate-100">국사 현황으로</button>
          </div>

          <div className="mt-5">
            <StraightMapViewer
              title={`${detail.cellName} 직선도`}
              stationName={detail.stationName}
              matchLength={6}
              searchKeys={[detail.cellName, detail.keyNumber]}
            />
          </div>

          <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-xs font-extrabold text-[#173B57]">기존 요약 선로 보기</summary>
          <div className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 p-4 sm:p-6">
            <div className="min-w-[700px] space-y-5">
              <DiagramPath
                title="하향 선로"
                nodes={[
                  { label: '국사', value: detail.stationName, sub: detail.stationAddress, icon: Building2 },
                  { label: 'OTX', value: `${value(detail.otxRack)}랙 / ${value(detail.otxShelf)}쉘프 / ${value(detail.otxPort)}포트`, sub: detail.otxModel, icon: Server },
                  { label: '광노드', value: value(detail.otxMain), sub: `선번 ${value(detail.otxLine)}`, icon: Route },
                  { label: 'ONU', value: value(detail.onuLocation), sub: `${value(detail.onuMaker)} · ${value(detail.onuModel)}`, icon: Server },
                ]}
              />
              <DiagramPath
                title="상향 선로"
                nodes={[
                  { label: 'ONU', value: value(detail.onuLocation), sub: value(detail.onuCellConfig), icon: Server },
                  { label: '광노드', value: value(detail.orxMain), sub: `선번 ${value(detail.orxLine)}`, icon: Route },
                  { label: 'ORX', value: `${value(detail.orxRack)}랙 / ${value(detail.orxShelf)}쉘프 / ${value(detail.orxPort)}포트`, sub: detail.orxModel, icon: Server },
                  { label: '국사', value: detail.stationName, sub: detail.cellName, icon: Building2 },
                ]}
              />
            </div>
          </div>
          </details>
        </section>
      ) : null}

      {activeTab === '작업이력' ? historySection : null}

      {floorTarget ? (
        <div className="fixed inset-0 z-60 overflow-y-auto bg-slate-950/75 p-3 backdrop-blur-xs sm:p-6">
          <div className="mx-auto max-w-6xl rounded-2xl bg-white p-4 shadow-2xl sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><h2 className="font-black text-[#173B57]">{detail.stationName} 국사 평면도</h2><p className="mt-1 text-xs text-slate-500">{floorTarget.equipment} · {floorTarget.target}</p></div>
              <button type="button" onClick={() => setFloorTarget(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="평면도 닫기"><X className="h-5 w-5" /></button>
            </div>
            <FloorPlanViewer stationName={detail.stationName} target={floorTarget.target} type={floorTarget.type} equipment={floorTarget.equipment} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string; full?: boolean }> = ({ label, value: rowValue, full }) => (
  <div className={`grid grid-cols-[112px_1fr] border-b border-slate-200 last:border-b-0 ${full ? '' : 'md:border-r md:last:border-r-0'}`}>
    <div className="flex items-center justify-center border-r border-slate-200 bg-slate-50 p-3 font-bold text-slate-600">{label}</div>
    <div className="flex items-center p-3 font-bold text-[#173B57]">{rowValue}</div>
  </div>
);

type DiagramPathNode = {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
};

const DiagramPath: React.FC<{ title: string; nodes: DiagramPathNode[] }> = ({ title, nodes }) => (
  <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
    <h3 className="mb-4 text-xs font-extrabold text-orange-300">{title}</h3>
    <div className="flex items-stretch gap-3">
      {nodes.map((node, index) => {
        const Icon = node.icon;
        return (
          <React.Fragment key={`${title}-${node.label}-${index}`}>
            <div className="flex w-36 shrink-0 flex-col items-center justify-center rounded-xl border border-blue-400/50 bg-[#173B57] p-3 text-center text-white">
              <Icon className="mb-2 h-5 w-5 text-blue-200" />
              <strong className="text-xs text-blue-100">{node.label}</strong>
              <span className="mt-1 break-words text-xs font-bold">{value(node.value)}</span>
              <small className="mt-1 break-words text-[10px] text-blue-200">{value(node.sub)}</small>
            </div>
            {index < nodes.length - 1 ? <div className="flex min-w-8 flex-1 items-center"><span className="h-1 w-full rounded bg-gradient-to-r from-blue-500 via-emerald-400 to-orange-400" /><ChevronRight className="-ml-1 h-5 w-5 shrink-0 text-orange-300" /></div> : null}
          </React.Fragment>
        );
      })}
    </div>
  </div>
);
