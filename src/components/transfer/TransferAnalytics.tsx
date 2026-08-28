import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, BarChart3, CalendarDays, CheckCircle2, Clock3, Download,
  FilterX, LoaderCircle, MapPinned, Search, UserRoundCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  transfersApi,
  type AnalyticsDetailMetric,
  type TransferAnalytics as AnalyticsResponse,
  type TransferAnalyticsFilters,
  type TransferAnalyticsMeta,
} from '../../features/transfers/api';

const currentMonth = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 7);
};
const currentYear = () => currentMonth().slice(0, 4);
const initialFilters = (): TransferAnalyticsFilters => ({
  periodType: 'month', month: currentMonth(), year: currentYear(), urgent: 'all', detailLimit: 30,
});
const statusLabel: Record<string, string> = { registered: '미완료', field_processed: '현장처리', completed: '완료' };
const metricLabel: Record<AnalyticsDetailMetric, string> = {
  received: '선택 기간 접수건', registered: '미완료 건', fieldProcessed: '현장처리 건',
  completedFromReceived: '접수건 중 완료', completedInPeriod: '기간 내 완료', urgent: '긴급 접수건',
};

const formatDateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '-';
const formatHours = (value: number | null) => value == null ? '-' : value < 24 ? `${value.toFixed(1)}시간` : `${(value / 24).toFixed(1)}일`;

type SummaryCardProps = {
  label: string;
  value: string;
  description: string;
  metric?: AnalyticsDetailMetric;
  accent: string;
  onSelect: (metric: AnalyticsDetailMetric) => void;
};

const SummaryCard = ({ label, value, description, metric, accent, onSelect }: SummaryCardProps) => {
  const content = <>
    <span className="block text-[11px] font-bold text-slate-500">{label}</span>
    <strong className={`mt-1 block text-2xl ${accent}`}>{value}</strong>
    <span className="mt-1 block text-[10px] leading-4 text-slate-400">{description}</span>
  </>;
  return metric ? (
    <button type="button" title={description} onClick={() => onSelect(metric)} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
      {content}
    </button>
  ) : <div title={description} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">{content}</div>;
};

const TableShell = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-4 py-3">
      <h2 className="font-extrabold text-[#173B57]">{title}</h2>
      {note ? <p className="mt-0.5 text-[11px] text-slate-500">{note}</p> : null}
    </div>
    <div className="overflow-x-auto">{children}</div>
  </section>
);

export const TransferAnalytics: React.FC = () => {
  const { currentUser, navigateTo, selectTransfer, showToast } = useApp();
  const [meta, setMeta] = useState<TransferAnalyticsMeta | null>(null);
  const [draft, setDraft] = useState<TransferAnalyticsFilters>(initialFilters);
  const [applied, setApplied] = useState<TransferAnalyticsFilters>(initialFilters);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [metric, setMetric] = useState<AnalyticsDetailMetric>('received');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const detailsRef = useRef<HTMLElement>(null);
  const canView = currentUser?.role === 'admin' || currentUser?.role === 'public_official' || currentUser?.role === 'team_leader';

  useEffect(() => {
    if (!canView) return;
    void transfersApi.analyticsMeta()
      .then((value) => {
        setMeta(value);
        if (value.regionLocked && value.currentRegionId) {
          setDraft((current) => ({ ...current, regionId: value.currentRegionId || undefined }));
          setApplied((current) => ({ ...current, regionId: value.currentRegionId || undefined }));
        }
      })
      .catch((error) => showToast(error instanceof Error ? error.message : '통계 조건을 불러오지 못했습니다.', 'error'));
  }, [canView, showToast]);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setLoading(true);
    void transfersApi.analytics({ ...applied, detailMetric: metric, detailPage: page })
      .then((value) => { if (active) setAnalytics(value); })
      .catch((error) => { if (active) showToast(error instanceof Error ? error.message : '업무이관 통계를 불러오지 못했습니다.', 'error'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied, canView, metric, page, showToast]);

  const processors = useMemo(() => meta?.fieldProcessors.filter((processor) => (
    !draft.regionId || processor.id === 'unassigned' || processor.regionId === draft.regionId
  )) || [], [draft.regionId, meta]);
  const trendMax = useMemo(() => Math.max(1, ...(analytics?.trend.map((row) => Math.max(row.received, row.completedInPeriod)) || [1])), [analytics]);

  const selectMetric = (nextMetric: AnalyticsDetailMetric) => {
    setMetric(nextMetric);
    setPage(1);
    window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setMetric('received');
    setPage(1);
    setApplied({ ...draft, detailLimit: 30 });
  };

  const resetFilters = () => {
    const reset = initialFilters();
    if (meta?.regionLocked && meta.currentRegionId) reset.regionId = meta.currentRegionId;
    setDraft(reset);
    setApplied(reset);
    setMetric('received');
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await transfersApi.exportAnalytics({ ...applied, detailMetric: metric });
      showToast('현재 조건의 업무이관 통계를 CSV로 저장했습니다.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'CSV 파일을 저장하지 못했습니다.', 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!canView) return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
      <p className="mt-2 font-bold text-red-800">업무이관 통계를 조회할 권한이 없습니다.</p>
      <button type="button" onClick={() => navigateTo('transfer_list')} className="mt-4 rounded-xl bg-[#173B57] px-4 py-2 text-xs font-bold text-white">업무이관 목록</button>
    </div>
  );

  return (
    <div id="transfer-analytics-view" className="space-y-4 pb-20 sm:pb-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <button type="button" onClick={() => navigateTo('transfer_list')} className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-[#2878B5]"><ArrowLeft className="h-4 w-4" />업무이관 목록</button>
          <div className="flex items-center gap-2"><BarChart3 className="h-6 w-6 text-[#F28C28]" /><h1 className="text-xl font-extrabold text-[#173B57]">업무이관 통계</h1></div>
          <p className="mt-1 text-xs text-slate-500">현장처리자를 기준으로 접수·처리·완료 현황을 조회합니다.</p>
        </div>
        <button type="button" onClick={() => void exportCsv()} disabled={exporting || !analytics} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-50">
          {exporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}CSV 내보내기
        </button>
      </header>

      <form onSubmit={applyFilters} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="업무이관 통계 조회 조건">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[11px] font-bold text-slate-600">기간 구분
            <select value={draft.periodType} onChange={(event) => setDraft((current) => ({ ...current, periodType: event.target.value as TransferAnalyticsFilters['periodType'] }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3">
              <option value="month">월별</option><option value="range">기간별</option><option value="year">연도별</option>
            </select>
          </label>
          {draft.periodType === 'month' ? <label className="text-[11px] font-bold text-slate-600">조회 월<input required type="month" value={draft.month || ''} onChange={(event) => setDraft((current) => ({ ...current, month: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3" /></label> : null}
          {draft.periodType === 'year' ? <label className="text-[11px] font-bold text-slate-600">조회 연도<input required type="number" min="2000" max="2100" value={draft.year || ''} onChange={(event) => setDraft((current) => ({ ...current, year: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3" /></label> : null}
          {draft.periodType === 'range' ? <>
            <label className="text-[11px] font-bold text-slate-600">시작일<input required type="date" value={draft.from || ''} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3" /></label>
            <label className="text-[11px] font-bold text-slate-600">종료일<input required type="date" value={draft.to || ''} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3" /></label>
          </> : null}
          {meta?.regionLocked ? <div className="text-[11px] font-bold text-slate-600">지역<div className="mt-1 flex h-10 items-center rounded-xl border border-slate-200 bg-slate-100 px-3 text-slate-800">{meta.currentRegionName || '지역 미지정'}</div></div> : <label className="text-[11px] font-bold text-slate-600">지역
            <select value={draft.regionId || ''} onChange={(event) => setDraft((current) => ({ ...current, regionId: event.target.value || undefined, fieldProcessorId: undefined }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3">
              <option value="">전체 지역</option>{meta?.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </label>}
          <label className="text-[11px] font-bold text-slate-600">현장처리자
            <select value={draft.fieldProcessorId || ''} onChange={(event) => setDraft((current) => ({ ...current, fieldProcessorId: event.target.value || undefined }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3">
              <option value="">전체 처리자</option>{processors.map((processor) => <option key={processor.id} value={processor.id}>{processor.name}{processor.regionName ? ` · ${processor.regionName}` : ''}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-600">긴급 여부
            <select value={draft.urgent || 'all'} onChange={(event) => setDraft((current) => ({ ...current, urgent: event.target.value as TransferAnalyticsFilters['urgent'] }))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3">
              <option value="all">전체</option><option value="true">긴급</option><option value="false">일반</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={resetFilters} className="inline-flex h-10 items-center gap-1 rounded-xl bg-slate-100 px-4 text-xs font-bold text-slate-700"><FilterX className="h-4 w-4" />초기화</button>
          <button type="submit" className="inline-flex h-10 items-center gap-1 rounded-xl bg-[#2878B5] px-5 text-xs font-bold text-white"><Search className="h-4 w-4" />조회</button>
        </div>
      </form>

      {loading && !analytics ? <div className="flex min-h-52 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />통계를 계산하는 중입니다.</div> : null}
      {analytics ? <>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="업무이관 통계 합계">
          <SummaryCard label="접수건" value={`${analytics.summary.received}건`} description="선택 기간에 점검요청일이 포함된 접수 건수" metric="received" accent="text-[#2878B5]" onSelect={selectMetric} />
          <SummaryCard label="미완료" value={`${analytics.summary.registered}건`} description="선택 기간 접수건 중 현재 미완료 상태" metric="registered" accent="text-amber-600" onSelect={selectMetric} />
          <SummaryCard label="현장처리" value={`${analytics.summary.fieldProcessed}건`} description="선택 기간 접수건 중 현재 현장처리 상태" metric="fieldProcessed" accent="text-blue-600" onSelect={selectMetric} />
          <SummaryCard label="접수건 중 완료" value={`${analytics.summary.completedFromReceived}건`} description="선택 기간 접수건 중 현재 완료 상태" metric="completedFromReceived" accent="text-emerald-600" onSelect={selectMetric} />
          <SummaryCard label="기간 내 완료" value={`${analytics.summary.completedInPeriod}건`} description="접수일과 관계없이 선택 기간에 최종 완료된 건수" metric="completedInPeriod" accent="text-teal-600" onSelect={selectMetric} />
          <SummaryCard label="완료율" value={`${analytics.summary.completionRate}%`} description="접수건 중 완료 ÷ 접수건 × 100" accent="text-violet-600" onSelect={selectMetric} />
          <SummaryCard label="긴급건" value={`${analytics.summary.urgent}건`} description="선택 기간 접수건 중 긴급 건수" metric="urgent" accent="text-red-600" onSelect={selectMetric} />
          <SummaryCard label="평균 처리시간" value={formatHours(analytics.summary.averageProcessingHours)} description="선택 기간 접수·완료 건의 점검요청일부터 완료까지 평균" accent="text-slate-700" onSelect={selectMetric} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="trend-chart-title">
          <div className="flex items-center justify-between"><h2 id="trend-chart-title" className="font-extrabold text-[#173B57]">기간 추이</h2><span className="text-[10px] text-slate-400">파랑 접수 · 초록 기간 내 완료</span></div>
          <div className="mt-4 flex h-36 items-end gap-1 overflow-x-auto border-b border-slate-200 pb-1" aria-label="접수 및 완료 추이 막대 그래프">
            {analytics.trend.map((row) => <div key={row.bucket} title={`${row.bucket} 접수 ${row.received}건, 기간 내 완료 ${row.completedInPeriod}건`} className="flex min-w-7 flex-1 items-end justify-center gap-0.5">
              <span className="w-2 rounded-t bg-blue-400" style={{ height: `${Math.max(row.received ? 5 : 0, row.received / trendMax * 112)}px` }} />
              <span className="w-2 rounded-t bg-emerald-400" style={{ height: `${Math.max(row.completedInPeriod ? 5 : 0, row.completedInPeriod / trendMax * 112)}px` }} />
            </div>)}
          </div>
        </section>

        <TableShell title="기간별 추이 표" note="월별 조회는 일 단위, 연도별 조회는 월 단위로 표시됩니다.">
          <table className="min-w-[760px] w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['기간', '접수', '미완료', '현장처리', '접수건 중 완료', '기간 내 완료', '완료율', '긴급'].map((label) => <th key={label} className="px-3 py-2 text-right first:text-left">{label}</th>)}</tr></thead>
            <tbody>{analytics.trend.map((row) => <tr key={row.bucket} className="border-t border-slate-100"><td className="px-3 py-2 font-bold">{row.bucket}</td><td className="px-3 py-2 text-right">{row.received}</td><td className="px-3 py-2 text-right">{row.registered}</td><td className="px-3 py-2 text-right">{row.fieldProcessed}</td><td className="px-3 py-2 text-right">{row.completedFromReceived}</td><td className="px-3 py-2 text-right">{row.completedInPeriod}</td><td className="px-3 py-2 text-right">{row.completionRate}%</td><td className="px-3 py-2 text-right text-red-600">{row.urgent}</td></tr>)}</tbody>
          </table>
        </TableShell>

        <div className="grid gap-4 xl:grid-cols-2">
          <TableShell title="지역별 현황" note="행을 누르면 해당 지역 접수건 상세로 좁혀집니다.">
            <table className="min-w-[650px] w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['지역', '접수', '미완료', '현장처리', '완료', '완료율', '긴급'].map((label) => <th key={label} className="px-3 py-2 text-right first:text-left">{label}</th>)}</tr></thead>
              <tbody>{analytics.byRegion.map((row) => <tr key={row.regionId || row.regionName} onClick={() => { const next = { ...applied, regionId: row.regionId || undefined }; setDraft(next); setApplied(next); selectMetric('received'); }} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50"><td className="px-3 py-2 font-bold">{row.regionName}</td><td className="px-3 py-2 text-right">{row.received}</td><td className="px-3 py-2 text-right">{row.registered}</td><td className="px-3 py-2 text-right">{row.fieldProcessed}</td><td className="px-3 py-2 text-right">{row.completed}</td><td className="px-3 py-2 text-right">{row.completionRate}%</td><td className="px-3 py-2 text-right text-red-600">{row.urgent}</td></tr>)}</tbody>
            </table>
          </TableShell>
          <TableShell title="현장처리자별 현황" note="등록자·완료자가 아닌 대표 현장처리자 기준이며 업무 1건은 한 번만 집계됩니다.">
            <table className="min-w-[780px] w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['현장처리자', '지역', '업무', '처리등록', '현장처리', '완료', '완료율', '긴급', '평균시간'].map((label) => <th key={label} className="px-3 py-2 text-right first:text-left">{label}</th>)}</tr></thead>
              <tbody>{analytics.byFieldProcessor.map((row) => <tr key={row.fieldProcessorId || `unassigned-${row.regionName}`} onClick={() => { const next = { ...applied, fieldProcessorId: row.fieldProcessorId || 'unassigned' }; setDraft(next); setApplied(next); selectMetric('received'); }} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50"><td className="px-3 py-2 font-bold">{row.fieldProcessorName}</td><td className="px-3 py-2 text-right">{row.regionName}</td><td className="px-3 py-2 text-right">{row.received}</td><td className="px-3 py-2 text-right">{row.processed}</td><td className="px-3 py-2 text-right">{row.fieldProcessed}</td><td className="px-3 py-2 text-right">{row.completed}</td><td className="px-3 py-2 text-right">{row.completionRate}%</td><td className="px-3 py-2 text-right text-red-600">{row.urgent}</td><td className="px-3 py-2 text-right">{formatHours(row.averageProcessingHours)}</td></tr>)}</tbody>
            </table>
          </TableShell>
        </div>

        <section ref={detailsRef} className="scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="analytics-details-title">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div><h2 id="analytics-details-title" className="font-extrabold text-[#173B57]">{metricLabel[analytics.details.metric]} 상세</h2><p className="text-[11px] text-slate-500">총 {analytics.details.total}건 · 행을 누르면 기존 업무이관 상세로 이동합니다.</p></div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500"><CalendarDays className="h-4 w-4" />{analytics.filters.from} ~ {analytics.filters.to}</div>
          </div>
          <div className="overflow-x-auto"><table className="min-w-[1200px] w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['점검요청일', '지역', '지점', '주소', '이관사유', '긴급', '현장처리자', '현장처리일', '완료일', '상태', '처리시간'].map((label) => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead>
            <tbody>{analytics.details.items.length ? analytics.details.items.map((row) => <tr key={row.id} onClick={() => selectTransfer(row.id)} className="cursor-pointer border-t border-slate-100 hover:bg-blue-50"><td className="whitespace-nowrap px-3 py-2 font-bold">{row.receivedDate}</td><td className="px-3 py-2"><span className="inline-flex items-center gap-1"><MapPinned className="h-3.5 w-3.5 text-slate-400" />{row.regionName}</span></td><td className="px-3 py-2">{row.branchName || '-'}</td><td className="max-w-64 px-3 py-2">{row.customerAddress || '-'}</td><td className="px-3 py-2">{row.handoverReason || '-'}</td><td className="px-3 py-2">{row.isUrgent ? <span className="font-bold text-red-600">긴급</span> : '일반'}</td><td className="px-3 py-2"><span className="inline-flex items-center gap-1"><UserRoundCheck className="h-3.5 w-3.5 text-slate-400" />{row.fieldProcessorName}</span></td><td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.fieldProcessedAt)}</td><td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.completedAt)}</td><td className="px-3 py-2"><span className="inline-flex items-center gap-1 font-bold"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{statusLabel[row.workflowStatus] || row.workflowStatus}</span></td><td className="whitespace-nowrap px-3 py-2"><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5 text-slate-400" />{formatHours(row.processingHours)}</span></td></tr>) : <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">해당 조건의 업무이관이 없습니다.</td></tr>}</tbody>
          </table></div>
          {analytics.details.total > analytics.details.limit ? <div className="flex items-center justify-center gap-3 border-t border-slate-100 p-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40">이전</button><span className="text-xs text-slate-500">{page} / {Math.ceil(analytics.details.total / analytics.details.limit)}</span><button type="button" disabled={page >= Math.ceil(analytics.details.total / analytics.details.limit) || loading} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40">다음</button></div> : null}
        </section>
      </> : null}
    </div>
  );
};
