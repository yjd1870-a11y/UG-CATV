import React, { useState } from 'react';
import { Building2, ChevronRight, MapPin, Network, Radio, Search, Server } from 'lucide-react';
import { catvApi } from '../../features/cells/api';
import { ApiClientError } from '../../shared/api/client';
import type { CatvB2CLine, CatvCell } from '../../types';
import { B2CDetail } from './B2CDetail';
import { CatvCellDetail } from './CatvCellDetail';

type SearchMode = 'cell' | 'b2c';

const requestMessage = (error: unknown) => {
  if (error instanceof ApiClientError && error.status >= 500) return '데이터 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
  if (error instanceof ApiClientError) return error.message;
  return '서버에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.';
};

export const CellList: React.FC = () => {
  const [cellQuery, setCellQuery] = useState('');
  const [b2cQuery, setB2cQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('cell');
  const [cellResults, setCellResults] = useState<CatvCell[]>([]);
  const [b2cResults, setB2cResults] = useState<CatvB2CLine[]>([]);
  const [selectedCell, setSelectedCell] = useState<CatvCell | null>(null);
  const [selectedB2C, setSelectedB2C] = useState<CatvB2CLine | null>(null);
  const [loading, setLoading] = useState<SearchMode | null>(null);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState<SearchMode | null>(null);

  const searchCell = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = cellQuery.trim();
    setMode('cell');
    setSearched('cell');
    setError('');
    if (!query) { setCellResults([]); setError('CELL(셀명)을 입력해주세요.'); return; }
    setLoading('cell');
    try {
      const results = await catvApi.searchCells(query);
      setCellResults(results);
      if (results.length === 1) setSelectedCell(await catvApi.getCell(results[0].id));
    } catch (requestError) {
      setCellResults([]);
      setError(requestMessage(requestError));
    } finally { setLoading(null); }
  };

  const searchB2C = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = b2cQuery.trim();
    setMode('b2c');
    setSearched('b2c');
    setError('');
    if (!query) { setB2cResults([]); setError('B2C(전용선 주소/명칭)을 입력해주세요.'); return; }
    setLoading('b2c');
    try {
      const results = await catvApi.searchB2C(query);
      setB2cResults(results);
      if (results.length === 1) setSelectedB2C(await catvApi.getB2C(results[0].id));
    } catch (requestError) {
      setB2cResults([]);
      setError(requestMessage(requestError));
    } finally { setLoading(null); }
  };

  const openCell = async (cell: CatvCell) => {
    setLoading('cell');
    try { setSelectedCell(await catvApi.getCell(cell.id)); }
    catch (requestError) { setError(requestMessage(requestError)); }
    finally { setLoading(null); }
  };
  const openB2C = async (line: CatvB2CLine) => {
    setLoading('b2c');
    try { setSelectedB2C(await catvApi.getB2C(line.id)); }
    catch (requestError) { setError(requestMessage(requestError)); }
    finally { setLoading(null); }
  };

  if (selectedCell) return <CatvCellDetail cell={selectedCell} onBack={() => setSelectedCell(null)} />;
  if (selectedB2C) return <B2CDetail line={selectedB2C} onBack={() => setSelectedB2C(null)} />;

  const resultsCount = mode === 'cell' ? cellResults.length : b2cResults.length;
  return (
    <div className="space-y-4 pb-20 sm:pb-8">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div><div className="flex items-center gap-2"><Radio className="h-5 w-5 text-[#2878B5]" /><h1 className="text-xl font-extrabold text-[#173B57]">CELL / B2C 조회</h1></div><p className="mt-0.5 text-xs text-slate-500">필요한 전송망 정보만 서버 DB에서 조회합니다.</p></div>
        {searched ? <span className="self-start rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500">조회 결과 <strong className="text-[#2878B5]">{resultsCount}</strong>건</span> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <form onSubmit={searchCell} className={`rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ${mode === 'cell' ? 'border-blue-300 ring-2 ring-blue-50' : 'border-slate-200'}`}>
          <div className="flex items-center gap-2"><span className="rounded-lg bg-blue-50 p-2 text-[#2878B5]"><Radio className="h-4 w-4" /></span><div><h2 className="text-sm font-extrabold text-[#173B57]">CELL (셀명)</h2><p className="text-[11px] text-slate-500">셀명·키번호·국사명 조회</p></div></div>
          <div className="relative mt-4"><Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="CELL 검색어" value={cellQuery} onChange={(event) => setCellQuery(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-[#2878B5] focus:bg-white focus:ring-2 focus:ring-blue-100" placeholder="예: A123, OSAN-001" /></div>
          <button type="submit" disabled={loading !== null} className="mt-3 h-11 w-full rounded-xl bg-[#173B57] text-sm font-bold text-white disabled:opacity-60">CELL 조회</button>
        </form>

        <form onSubmit={searchB2C} className={`rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ${mode === 'b2c' ? 'border-blue-300 ring-2 ring-blue-50' : 'border-slate-200'}`}>
          <div className="flex items-center gap-2"><span className="rounded-lg bg-blue-50 p-2 text-[#2878B5]"><Network className="h-4 w-4" /></span><div><h2 className="text-sm font-extrabold text-[#173B57]">B2C (전용선 주소/명칭)</h2><p className="text-[11px] text-slate-500">회선번호·명칭·구분·종류·비고 조회</p></div></div>
          <div className="relative mt-4"><Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="B2C 검색어" value={b2cQuery} onChange={(event) => setB2cQuery(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-[#2878B5] focus:bg-white focus:ring-2 focus:ring-blue-100" placeholder="예: 고덕여염6길112" /></div>
          <button type="submit" disabled={loading !== null} className="mt-3 h-11 w-full rounded-xl bg-[#2878B5] text-sm font-bold text-white disabled:opacity-60">B2C 조회</button>
        </form>
      </div>

      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-600">{loading === 'cell' ? 'CELL 정보를 조회하는 중입니다.' : 'B2C 정보를 조회하는 중입니다.'}</div> : null}
      {!loading && error ? <div role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-5 text-center text-sm font-semibold text-red-700">{error}</div> : null}

      {!loading && !error && searched === 'cell' && cellResults.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><Radio className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-2 text-sm font-bold text-[#173B57]">일치하는 CELL 데이터가 없습니다.</p></div> : null}
      {!loading && !error && searched === 'b2c' && b2cResults.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><Network className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-2 text-sm font-bold text-[#173B57]">일치하는 B2C 전용선 데이터가 없습니다.</p></div> : null}

      {!loading && mode === 'cell' && cellResults.length > 1 ? <section className="space-y-3"><h2 className="text-sm font-extrabold text-[#173B57]">CELL 조회 결과 {cellResults.length}건</h2>{cellResults.map((cell) => <button type="button" key={cell.id} onClick={() => void openCell(cell)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/30"><div className="min-w-0"><strong className="text-base font-black text-[#173B57]">{cell.cellName}</strong><p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-600"><Building2 className="h-3.5 w-3.5 shrink-0" />{cell.stationName}</p><p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-500"><MapPin className="h-3.5 w-3.5 shrink-0" />{cell.stationAddress || '주소 미등록'}</p><p className="mt-2 text-[11px] font-semibold text-slate-500"><Server className="mr-1 inline h-3.5 w-3.5" />OTX Rack {cell.otxRack || '-'} · ORX Rack {cell.orxRack || '-'}</p></div><ChevronRight className="h-5 w-5 shrink-0 text-[#2878B5]" /></button>)}</section> : null}

      {!loading && mode === 'b2c' && b2cResults.length > 1 ? <section className="space-y-3"><h2 className="text-sm font-extrabold text-[#173B57]">B2C 조회 결과 {b2cResults.length}건</h2>{b2cResults.map((line) => <button type="button" key={line.id} onClick={() => void openB2C(line)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/30"><div className="min-w-0"><strong className="text-base font-black text-[#173B57]">{line.serviceName || line.b2cName || '-'}</strong><p className="mt-1 truncate text-xs text-slate-600">국사 {line.stationName} · 노드 {line.node || '-'} · 코어 {line.core || line.line || '-'}</p><p className="mt-2 truncate text-[11px] text-slate-500">비고: {line.memo || '-'}</p></div><ChevronRight className="h-5 w-5 shrink-0 text-[#2878B5]" /></button>)}</section> : null}
    </div>
  );
};
