import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileSearch,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { adminDailyWorkApi, dailyWorkApi, type DailyWorkQuery } from '../../features/daily-work/api';
import { ApiClientError } from '../../shared/api/client';
import { canExportDailyWork } from '../../shared/auth/permissions';
import {
  DailyWorkAggregate,
  DailyWorkAggregateRow,
  DailyWorkMeta,
  DailyWorkRecord,
  WorkCategory,
} from '../../types';

type MainMode = 'register' | 'my' | 'admin';
type AdminMode = 'person' | 'region' | 'month' | 'period';

const formatNumber = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
const firstDayOfMonth = (date: string) => `${date.slice(0, 7)}-01`;

const emptyCounts = (categories: WorkCategory[]) =>
  Object.fromEntries(categories.map((category) => [category.code, 0])) as Record<string, number>;

const CountEditor: React.FC<{
  category: WorkCategory;
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
}> = ({ category, value, onChange, compact = false }) => (
  <div className={`flex items-center justify-between gap-3 ${compact ? 'py-1.5' : 'rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm'}`}>
    <div className="min-w-0">
      <p className="truncate text-sm font-extrabold text-[#173B57]">{category.name}</p>
      {!compact && <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{category.code}</p>}
    </div>
    <div className="flex shrink-0 items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
      <button
        type="button"
        className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-slate-600 shadow-xs disabled:opacity-30"
        aria-label={`${category.name} 1 감소`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`${category.name} 건수`}
        value={value}
        onChange={(event) => {
          const normalized = event.target.value.replace(/\D/g, '');
          onChange(normalized === '' ? 0 : Math.min(9999, Number(normalized)));
        }}
        className="h-11 w-16 bg-transparent text-center text-lg font-black text-[#173B57] outline-none"
      />
      <button
        type="button"
        className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#2878B5] text-white shadow-xs"
        aria-label={`${category.name} 1 증가`}
        onClick={() => onChange(Math.min(9999, value + 1))}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  </div>
);

const ResultView: React.FC<{
  data: DailyWorkAggregate | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onRowClick: (row: DailyWorkAggregateRow) => void;
}> = ({ data, loading, error, onRetry, onRowClick }) => {
  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white py-14 text-center text-sm font-semibold text-slate-500">데이터를 불러오는 중입니다.</div>;
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white py-12 text-center">
        <p className="text-sm font-bold text-rose-700">업무내역을 불러오지 못했습니다.</p>
        <p className="mt-1 text-xs text-slate-500">다시 시도해주세요.</p>
        <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#173B57] px-4 py-2 text-xs font-bold text-white">
          <RotateCcw className="h-3.5 w-3.5" /> 다시 시도
        </button>
      </div>
    );
  }
  if (!data || data.rows.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white py-14 text-center text-sm font-semibold text-slate-400">조회된 업무내역이 없습니다.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <div className="max-h-[560px] overflow-auto">
          <table className="min-w-max border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20 bg-[#173B57] text-white">
              <tr>
                <th className="sticky left-0 z-30 min-w-28 border-r border-white/10 bg-[#173B57] px-3 py-3 text-left">날짜</th>
                {data.rows.some((row) => row.workerName) && <th className="min-w-24 px-3 py-3 text-left">담당자</th>}
                {data.rows.some((row) => row.regionName) && <th className="min-w-28 px-3 py-3 text-left">지역</th>}
                {data.categories.map((category) => <th key={category.code} className="min-w-24 px-3 py-3 text-right">{category.name}</th>)}
                <th className="sticky right-0 z-30 min-w-24 border-l border-white/10 bg-[#102c42] px-3 py-3 text-right">합계</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.key || row.id} onClick={() => onRowClick(row)} className="cursor-pointer border-b border-slate-100 hover:bg-blue-50/60">
                  <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-3 font-bold text-[#173B57]">{row.workDate}</td>
                  {data.rows.some((item) => item.workerName) && <td className="border-b border-slate-100 px-3 py-3 font-bold">{row.workerName || '-'}</td>}
                  {data.rows.some((item) => item.regionName) && <td className="border-b border-slate-100 px-3 py-3 text-slate-500">{row.regionName || '-'}</td>}
                  {data.categories.map((category) => <td key={category.code} className="border-b border-slate-100 px-3 py-3 text-right font-mono">{row.counts[category.code] || 0}</td>)}
                  <td className="sticky right-0 z-10 border-b border-l border-slate-100 bg-blue-50 px-3 py-3 text-right font-black text-[#2878B5]">{formatNumber(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-20 bg-slate-100 font-black">
              <tr>
                <td className="sticky left-0 z-30 border-r border-slate-200 bg-slate-100 px-3 py-3">합계</td>
                {data.rows.some((row) => row.workerName) && <td />}
                {data.rows.some((row) => row.regionName) && <td />}
                {data.categories.map((category) => <td key={category.code} className="px-3 py-3 text-right">{formatNumber(data.categoryTotals[category.code] || 0)}</td>)}
                <td className="sticky right-0 z-30 border-l border-amber-200 bg-amber-50 px-3 py-3 text-right text-[#F28C28]">{formatNumber(data.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="space-y-2.5 pb-20 md:hidden">
        {data.rows.map((row) => (
          <button key={row.key || row.id} type="button" onClick={() => onRowClick(row)} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:bg-blue-50">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-sm font-black text-[#173B57]">{row.workerName || row.regionName || row.workDate}</p>
                <p className="mt-0.5 text-xs text-slate-500">{row.workDate}{row.workerName && row.regionName ? ` · ${row.regionName}` : ''}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-300" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2">
              {data.categories.map((category) => (
                <div key={category.code} className="flex items-center justify-between text-xs">
                  <span className="truncate text-slate-500">{category.name}</span>
                  <span className="ml-2 font-mono font-bold text-slate-800">{row.counts[category.code] || 0}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-end justify-between border-t border-dashed border-slate-200 pt-3">
              <span className="text-xs font-bold text-slate-500">합계</span>
              <span className="text-xl font-black text-[#F28C28]">{formatNumber(row.total)}<small className="ml-0.5 text-xs">건</small></span>
            </div>
          </button>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-[68px] z-30 flex items-center justify-between border-y border-amber-200 bg-amber-50 px-5 py-3 shadow-[0_-3px_12px_rgba(15,35,51,0.08)] md:hidden">
        <span className="text-sm font-extrabold text-[#173B57]">전체 합계</span>
        <span className="text-xl font-black text-[#F28C28]">{formatNumber(data.grandTotal)}건</span>
      </div>
    </div>
  );
};

export const DailyWorkView: React.FC = () => {
  const { currentUser, reloadBusinessData, showToast } = useApp();
  const isAdmin = currentUser?.role === 'admin';
  const canManageDailyWork = currentUser?.role === 'admin' || currentUser?.role === 'public_official' || currentUser?.role === 'team_leader';
  const canDeleteDailyWork = currentUser?.role === 'admin' || currentUser?.role === 'public_official';
  const canExport = canExportDailyWork(currentUser?.role);
  const [mode, setMode] = useState<MainMode>('register');
  const [meta, setMeta] = useState<DailyWorkMeta | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [formDate, setFormDate] = useState('');
  const [formCounts, setFormCounts] = useState<Record<string, number>>({});
  const [memo, setMemo] = useState('');
  const [existing, setExisting] = useState<DailyWorkRecord | null>(null);
  const [targetUserId, setTargetUserId] = useState('');
  const [saving, setSaving] = useState(false);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [myData, setMyData] = useState<DailyWorkAggregate | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState('');

  const [adminMode, setAdminMode] = useState<AdminMode>('period');
  const [adminData, setAdminData] = useState<DailyWorkAggregate | null>(null);
  const [summary, setSummary] = useState<{ todayTotal: number; monthTotal: number; enteredUsers: number; missingUsers: number } | null>(null);
  const [userId, setUserId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [detail, setDetail] = useState<DailyWorkRecord | null>(null);
  const [detailCounts, setDetailCounts] = useState<Record<string, number>>({});
  const [detailMemo, setDetailMemo] = useState('');
  const [detailEditing, setDetailEditing] = useState(false);
  const [drillRows, setDrillRows] = useState<DailyWorkAggregateRow[]>([]);
  const [detailHistory, setDetailHistory] = useState<Array<Record<string, unknown>>>([]);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoryRows, setCategoryRows] = useState<WorkCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');

  const total = useMemo(() => (Object.values(formCounts) as number[]).reduce((sum, count) => sum + Number(count || 0), 0), [formCounts]);
  const selectedTarget = meta?.users.find((user) => user.id === targetUserId);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const loadedMeta = await dailyWorkApi.meta();
        if (!mounted) return;
        setMeta(loadedMeta);
        setFormDate(loadedMeta.today);
        setFrom(firstDayOfMonth(loadedMeta.today));
        setTo(loadedMeta.today);
        setYear(loadedMeta.today.slice(0, 4));
        setMonth(loadedMeta.today.slice(5, 7));
        setFormCounts(emptyCounts(loadedMeta.categories));
        setTargetUserId(currentUser?.id || '');
        if (canManageDailyWork) {
          const [loadedSummary, initialAdmin] = await Promise.all([
            adminDailyWorkApi.summary(),
            adminDailyWorkApi.query('period', { from: firstDayOfMonth(loadedMeta.today), to: loadedMeta.today, sortOrder: 'asc' }),
          ]);
          if (!mounted) return;
          setSummary(loadedSummary);
          setAdminData(initialAdmin);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '일일업무 정보를 불러오지 못했습니다.', 'error');
      } finally {
        if (mounted) setPageLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [canManageDailyWork, currentUser?.id]);

  useEffect(() => {
    if (!meta || !formDate || !targetUserId) return;
    let active = true;
    setExisting(null);
    setFormCounts(emptyCounts(meta.categories));
    setMemo('');
    void dailyWorkApi.find(formDate, canManageDailyWork ? targetUserId : undefined)
      .then((record) => {
        if (!active || !record) return;
        setExisting(record);
        setFormCounts({ ...emptyCounts(meta.categories), ...record.counts });
        setMemo(record.memo || '');
      })
      .catch((error) => { if (active) showToast(error instanceof Error ? error.message : '일일업무를 불러오지 못했습니다.', 'error'); });
    return () => { active = false; };
  }, [canManageDailyWork, formDate, meta, showToast, targetUserId]);

  const saveForm = async () => {
    if (!meta) return;
    setSaving(true);
    try {
      const saved = existing
        ? await dailyWorkApi.update(existing.id, { date: formDate, counts: formCounts, memo, updatedAt: existing.updatedAt })
        : await dailyWorkApi.save({ date: formDate, counts: formCounts, memo, userId: canManageDailyWork ? targetUserId : undefined });
      setExisting(saved);
      setFormCounts({ ...emptyCounts(meta.categories), ...saved.counts });
      if (canManageDailyWork) setSummary(await adminDailyWorkApi.summary());
      await reloadBusinessData();
      showToast('일일업무가 저장되었습니다.', 'success');
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'STALE_UPDATE') {
        showToast('다른 사용자가 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.', 'warning');
      } else {
        showToast(error instanceof Error ? error.message : '일일업무를 저장하지 못했습니다.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const loadMy = async () => {
    setResultLoading(true);
    setResultError('');
    try {
      const query = new URLSearchParams({ from, to, sortBy: 'work_date', sortOrder });
      if (categoryId) query.set('categoryId', categoryId);
      setMyData(await dailyWorkApi.my(query.toString()));
    } catch (error) {
      setResultError(error instanceof Error ? error.message : '조회 실패');
    } finally {
      setResultLoading(false);
    }
  };

  const adminQuery = (): DailyWorkQuery => ({
    ...(adminMode === 'month' ? { year, month } : { from, to }),
    userId: adminMode === 'person' ? userId : undefined,
    regionId: adminMode === 'region' || adminMode === 'period' ? regionId : undefined,
    categoryId,
    sortBy: 'work_date',
    sortOrder,
  });

  const loadAdmin = async (requestedMode = adminMode) => {
    setResultLoading(true);
    setResultError('');
    try {
      const query = {
        ...(requestedMode === 'month' ? { year, month } : { from, to }),
        userId: requestedMode === 'person' ? userId : undefined,
        regionId: requestedMode === 'region' || requestedMode === 'period' ? regionId : undefined,
        categoryId,
        sortBy: 'work_date',
        sortOrder,
      } satisfies DailyWorkQuery;
      setAdminData(await adminDailyWorkApi.query(requestedMode, query));
    } catch (error) {
      setResultError(error instanceof Error ? error.message : '조회 실패');
    } finally {
      setResultLoading(false);
    }
  };

  const openRow = async (row: DailyWorkAggregateRow) => {
    try {
      if (row.id) {
        const [loaded, history] = await Promise.all([
          dailyWorkApi.detail(row.id),
          dailyWorkApi.history(row.id),
        ]);
        setDetail(loaded);
        setDetailHistory(history);
        setDetailCounts({ ...loaded.counts });
        setDetailMemo(loaded.memo || '');
        setDetailEditing(false);
        setDrillRows([]);
        return;
      }
      if (!canManageDailyWork) return;
      const drilled = await adminDailyWorkApi.drilldown({
        from: row.workDate,
        to: row.workDate,
        regionId: row.regionId,
        categoryId,
        sortOrder: 'asc',
      });
      setDrillRows(drilled.rows);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '상세내역을 불러오지 못했습니다.', 'error');
    }
  };

  const saveDetail = async () => {
    if (!detail) return;
    try {
      const saved = await dailyWorkApi.update(detail.id, {
        date: detail.workDate || detail.date,
        counts: detailCounts,
        memo: detailMemo,
        updatedAt: detail.updatedAt,
      });
      setDetail(saved);
      setDetailEditing(false);
      showToast('일일업무가 수정되었습니다.', 'success');
      if (mode === 'admin') await loadAdmin();
      if (mode === 'my') await loadMy();
      if (canManageDailyWork) setSummary(await adminDailyWorkApi.summary());
      await reloadBusinessData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '수정하지 못했습니다.', 'error');
    }
  };

  const deleteDetail = async () => {
    if (!detail || !canDeleteDailyWork) return;
    if (!window.confirm(`${detail.workerName}님의 ${detail.workDate || detail.date} 일일업무를 DB에서 완전히 삭제하시겠습니까?`)) return;
    const reason = window.prompt('삭제 사유를 입력해주세요. 감사 로그에 기록됩니다.', '')?.trim();
    if (reason === undefined) return;
    try {
      await dailyWorkApi.remove(detail.id, reason);
      setDetail(null);
      setDetailHistory([]);
      if (existing?.id === detail.id && meta) {
        setExisting(null);
        setFormCounts(emptyCounts(meta.categories));
        setMemo('');
      }
      if (mode === 'admin') await loadAdmin();
      if (mode === 'my') await loadMy();
      if (canManageDailyWork) setSummary(await adminDailyWorkApi.summary());
      await reloadBusinessData();
      showToast('일일업무와 연관 데이터를 완전히 삭제했습니다.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '일일업무를 삭제하지 못했습니다.', 'error');
    }
  };

  const setQuickRange = (kind: 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth') => {
    if (!meta) return;
    const current = new Date(`${meta.today}T00:00:00`);
    const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (kind === 'today') { setFrom(meta.today); setTo(meta.today); return; }
    if (kind === 'yesterday') { current.setDate(current.getDate() - 1); const value = iso(current); setFrom(value); setTo(value); return; }
    if (kind === 'week' || kind === 'lastWeek') {
      const day = current.getDay() || 7;
      current.setDate(current.getDate() - day + 1 - (kind === 'lastWeek' ? 7 : 0));
      const start = iso(current); current.setDate(current.getDate() + 6); setFrom(start); setTo(iso(current)); return;
    }
    current.setDate(1);
    if (kind === 'lastMonth') current.setMonth(current.getMonth() - 1);
    const start = iso(current); current.setMonth(current.getMonth() + 1, 0); setFrom(start); setTo(iso(current));
  };

  const openCategoryManager = async () => {
    try {
      setCategoryRows(await adminDailyWorkApi.categories());
      setShowCategoryManager(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '업무구분을 불러오지 못했습니다.', 'error');
    }
  };

  const saveCategory = async (category: WorkCategory) => {
    try {
      const saved = await adminDailyWorkApi.updateCategory(category.id, {
        name: category.name,
        sortOrder: category.sortOrder,
        active: category.active,
      });
      setCategoryRows((previous) => previous.map((item) => item.id === saved.id ? saved : item).sort((a, b) => a.sortOrder - b.sortOrder));
      setMeta(await adminDailyWorkApi.meta());
      showToast(`${saved.name} 업무구분이 저장되었습니다.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '업무구분을 저장하지 못했습니다.', 'error');
    }
  };

  const addCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      const saved = await adminDailyWorkApi.createCategory(newCategoryName.trim());
      setCategoryRows((previous) => [...previous, saved]);
      setNewCategoryName('');
      setMeta(await adminDailyWorkApi.meta());
      showToast('새 업무구분이 추가되었습니다.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '업무구분을 추가하지 못했습니다.', 'error');
    }
  };

  if (pageLoading || !meta) {
    return <div className="flex min-h-[55vh] items-center justify-center text-sm font-bold text-[#173B57]">일일업무 화면을 준비하는 중입니다.</div>;
  }

  return (
    <div id="daily-work-view" className="space-y-4 pb-24 sm:pb-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-[#2878B5]" />
            <h1 className="text-xl font-black text-[#173B57]">전송망 일일업무</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">업무 등록부터 지역·기간별 집계까지 한곳에서 관리합니다.</p>
        </div>
        <div className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {([
            ['register', '일일업무 등록'],
            ['my', '내 업무내역'],
            ...(canManageDailyWork ? [['admin', '업무 관리']] : []),
          ] as Array<[MainMode, string]>).map(([value, label]) => (
            <button key={value} type="button" onClick={() => { setMode(value); if (value === 'my' && !myData) void loadMy(); }} className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold ${mode === value ? 'bg-[#173B57] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'register' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className={`grid gap-3 ${canManageDailyWork ? 'sm:grid-cols-[1fr_1.3fr_auto]' : 'sm:grid-cols-[1fr_1fr_auto]'} sm:items-end`}>
              <label className="text-xs font-bold text-slate-500">날짜
                <input type="date" value={formDate} max={meta.today} readOnly={!canManageDailyWork} onChange={(event) => setFormDate(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-bold text-[#173B57] outline-none" />
              </label>
              {canManageDailyWork ? <label className="text-xs font-bold text-slate-500">담당자 / 지역
                <select value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-extrabold text-[#173B57] outline-none">
                  {meta.users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.department}</option>)}
                </select>
              </label> : <div>
                <p className="text-xs font-bold text-slate-500">담당자 / 지역</p>
                <p className="mt-1.5 flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-extrabold text-[#173B57]">{currentUser?.name} · {currentUser?.regionName || currentUser?.team}</p>
              </div>}
              <div className="flex h-14 items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 sm:min-w-40">
                <span className="text-xs font-bold text-slate-500">{formDate === meta.today ? '오늘 합계' : '선택일 합계'}</span>
                <span className="text-2xl font-black text-[#F28C28]">{formatNumber(total)}<small className="ml-1 text-xs">건</small></span>
              </div>
            </div>
          </div>

          <div className="grid gap-2.5 lg:grid-cols-2">
            {meta.categories.map((category) => (
              <CountEditor key={category.code} category={category} value={formCounts[category.code] || 0} onChange={(value) => setFormCounts((previous) => ({ ...previous, [category.code]: value }))} />
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label htmlFor="daily-memo" className="text-xs font-bold text-slate-500">비고</label>
            <textarea id="daily-memo" rows={3} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="해당 날짜 전체 업무의 특이사항을 입력하세요." className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-[#2878B5] focus:bg-white" />
          </div>

          <button type="button" disabled={saving} onClick={() => void saveForm()} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#F28C28] text-base font-black text-white shadow-sm disabled:opacity-60">
            {saving ? <RotateCcw className="h-5 w-5 animate-spin" /> : existing ? <Check className="h-5 w-5" /> : <Save className="h-5 w-5" />}
            {saving ? '저장 중...' : existing ? `${selectedTarget?.name || currentUser?.name || ''} 업무 수정 · ${formatNumber(total)}건` : `일일업무 저장 · ${formatNumber(total)}건`}
          </button>
        </div>
      )}

      {mode === 'my' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-xs font-bold text-slate-500">시작일<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3" /></label>
              <label className="text-xs font-bold text-slate-500">종료일<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3" /></label>
              <label className="text-xs font-bold text-slate-500">업무구분<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"><option value="">전체</option>{meta.categories.map((category) => <option key={category.code} value={category.code}>{category.name}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">정렬<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as 'asc' | 'desc')} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"><option value="asc">날짜 오름차순</option><option value="desc">날짜 내림차순</option></select></label>
              <div className="mt-auto flex gap-2 sm:col-span-2 lg:col-span-1">
                {canExport ? <button type="button" onClick={() => void dailyWorkApi.export({ from, to, categoryId, sortBy: 'work_date', sortOrder }).catch((error) => showToast(error instanceof Error ? error.message : 'Excel 파일을 생성하지 못했습니다. 다시 시도해주세요.', 'error'))} className="flex h-10 items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700"><Download className="h-3.5 w-3.5" />Excel</button> : null}
                <button type="button" onClick={() => void loadMy()} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#2878B5] px-3 text-xs font-bold text-white"><Search className="h-4 w-4" />조회</button>
              </div>
            </div>
          </div>
          <ResultView data={myData} loading={resultLoading} error={resultError} onRetry={loadMy} onRowClick={openRow} />
        </div>
      )}

      {mode === 'admin' && canManageDailyWork && (
        <div className="space-y-3">
          {summary && (
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {[
                ['오늘 업무', `${formatNumber(summary.todayTotal)}건`],
                ['이번 달 업무', `${formatNumber(summary.monthTotal)}건`],
                ['오늘 입력자', `${formatNumber(summary.enteredUsers)}명`],
                ['오늘 미입력자', `${formatNumber(summary.missingUsers)}명`],
              ].map(([label, value], index) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[11px] font-bold text-slate-500">{label}</p><p className={`mt-1 text-xl font-black ${index === 3 ? 'text-rose-600' : index === 0 ? 'text-[#F28C28]' : 'text-[#173B57]'}`}>{value}</p></div>)}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div className="flex gap-1.5 overflow-x-auto pb-1">
              {([
                ['person', '개인별'], ['region', '지역별'], ['month', '월별'], ['period', '기간별'],
              ] as Array<[AdminMode, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => { setAdminMode(value); void loadAdmin(value); }} className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold ${adminMode === value ? 'bg-[#173B57] text-white' : 'border border-slate-200 bg-slate-50 text-slate-500'}`}>{label}</button>)}
              </div>
              {isAdmin ? <button type="button" onClick={() => void openCategoryManager()} className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-[#2878B5]"><SlidersHorizontal className="h-4 w-4" />업무구분 관리</button> : null}
            </div>

            {adminMode === 'period' && <div className="mb-3 flex flex-wrap gap-1.5">{([['today', '오늘'], ['yesterday', '어제'], ['week', '이번주'], ['lastWeek', '지난주'], ['month', '이번달'], ['lastMonth', '지난달']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setQuickRange(value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600">{label}</button>)}</div>}

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {adminMode === 'month' ? (
                <>
                  <label className="text-xs font-bold text-slate-500">연도<input type="number" value={year} onChange={(event) => setYear(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3" /></label>
                  <label className="text-xs font-bold text-slate-500">월<select value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3">{Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map((value) => <option key={value} value={value}>{Number(value)}월</option>)}</select></label>
                </>
              ) : (
                <>
                  <label className="text-xs font-bold text-slate-500">시작일<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3" /></label>
                  <label className="text-xs font-bold text-slate-500">종료일<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3" /></label>
                </>
              )}
              {adminMode === 'person' && <label className="text-xs font-bold text-slate-500">담당자<select value={userId} onChange={(event) => setUserId(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"><option value="">전체 담당자</option>{meta.users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.department}</option>)}</select></label>}
              {(adminMode === 'region' || adminMode === 'period') && <label className="text-xs font-bold text-slate-500">지역<select value={regionId} onChange={(event) => setRegionId(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"><option value="">전체 지역</option>{meta.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label>}
              <label className="text-xs font-bold text-slate-500">업무구분<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"><option value="">전체</option>{meta.categories.map((category) => <option key={category.code} value={category.code}>{category.name}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">정렬<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as 'asc' | 'desc')} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"><option value="asc">날짜 오름차순</option><option value="desc">날짜 내림차순</option></select></label>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => void adminDailyWorkApi.export(adminMode, adminQuery()).catch((error) => showToast(error instanceof Error ? error.message : 'Excel 파일을 생성하지 못했습니다. 다시 시도해주세요.', 'error'))} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-bold text-emerald-700"><Download className="h-4 w-4" />Excel 다운로드</button>
              <button type="button" onClick={() => void loadAdmin()} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#2878B5] px-5 text-xs font-bold text-white"><Search className="h-4 w-4" />조회</button>
            </div>
          </div>
          <ResultView data={adminData} loading={resultLoading} error={resultError} onRetry={() => loadAdmin()} onRowClick={openRow} />
        </div>
      )}

      {drillRows.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-5" onClick={() => setDrillRows([])}>
          <div className="max-h-[78vh] w-full max-w-lg overflow-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><div><p className="text-base font-black text-[#173B57]">담당자별 드릴다운</p><p className="text-xs text-slate-500">담당자를 선택하면 상세 업무를 확인합니다.</p></div><button type="button" onClick={() => setDrillRows([])} className="rounded-full bg-slate-100 p-2"><X className="h-4 w-4" /></button></div>
            <div className="space-y-2">{drillRows.map((row) => <button key={row.id || row.key} type="button" onClick={() => void openRow(row)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left"><div><p className="text-sm font-bold text-[#173B57]">{row.workerName}</p><p className="text-xs text-slate-500">{row.regionName} · {row.workDate}</p></div><span className="font-black text-[#F28C28]">{row.total}건</span></button>)}</div>
          </div>
        </div>
      )}

      {showCategoryManager && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-5" onClick={() => setShowCategoryManager(false)}>
          <div className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between"><div><p className="text-lg font-black text-[#173B57]">업무구분 관리</p><p className="mt-1 text-xs text-slate-500">명칭, 활성 상태, 표시순서를 변경하면 모든 입력·조회·Excel에 동일하게 반영됩니다.</p></div><button type="button" onClick={() => setShowCategoryManager(false)} className="rounded-full bg-slate-100 p-2"><X className="h-4 w-4" /></button></div>
            <div className="space-y-2">
              {categoryRows.map((category) => (
                <div key={category.id} className="grid grid-cols-[68px_1fr_58px] items-center gap-2 rounded-xl border border-slate-200 p-2.5 sm:grid-cols-[72px_1fr_72px_72px]">
                  <span className="text-[11px] font-bold text-slate-400">{category.code}</span>
                  <input value={category.name} onChange={(event) => setCategoryRows((previous) => previous.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item))} className="h-9 min-w-0 rounded-lg border border-slate-200 px-2.5 text-sm font-bold" />
                  <input type="number" min={1} aria-label={`${category.name} 표시순서`} value={category.sortOrder} onChange={(event) => setCategoryRows((previous) => previous.map((item) => item.id === category.id ? { ...item, sortOrder: Number(event.target.value) } : item))} className="h-9 rounded-lg border border-slate-200 px-2 text-center text-sm" />
                  <div className="col-span-3 flex items-center justify-between gap-2 sm:col-span-1">
                    <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500"><input type="checkbox" checked={category.active} onChange={(event) => setCategoryRows((previous) => previous.map((item) => item.id === category.id ? { ...item, active: event.target.checked } : item))} />활성</label>
                    <button type="button" onClick={() => void saveCategory(category)} className="h-8 rounded-lg bg-[#173B57] px-2.5 text-[11px] font-bold text-white">저장</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4"><input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="새 업무구분명" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm" /><button type="button" onClick={() => void addCategory()} className="flex h-11 items-center gap-1 rounded-xl bg-[#F28C28] px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" />추가</button></div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-5" onClick={() => setDetail(null)}>
          <div className="max-h-[88vh] w-full max-w-xl overflow-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div><p className="text-lg font-black text-[#173B57]">{detail.workerName} 업무 상세</p><p className="mt-1 text-xs text-slate-500">{detail.workDate || detail.date} · {detail.regionName || detail.team}</p></div>
              <button type="button" onClick={() => setDetail(null)} className="rounded-full bg-slate-100 p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 space-y-1">
              {meta.categories.map((category) => detailEditing ? (
                <CountEditor key={category.code} compact category={category} value={detailCounts[category.code] || 0} onChange={(value) => setDetailCounts((previous) => ({ ...previous, [category.code]: value }))} />
              ) : (
                <div key={category.code} className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm"><span className="text-slate-500">{category.name}</span><span className="font-mono font-bold">{detail.counts[category.code] || 0}건</span></div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3"><span className="text-sm font-bold text-slate-600">전체 합계</span><span className="text-xl font-black text-[#F28C28]">{formatNumber(detailEditing ? (Object.values(detailCounts) as number[]).reduce((sum, count) => sum + count, 0) : detail.total || 0)}건</span></div>
            <div className="mt-4"><p className="text-xs font-bold text-slate-500">비고</p>{detailEditing ? <textarea value={detailMemo} onChange={(event) => setDetailMemo(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm" /> : <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{detail.memo || '등록된 비고가 없습니다.'}</p>}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400"><p>등록시간<br /><span className="text-slate-600">{detail.createdAt || '-'}</span></p><p>최종수정시간<br /><span className="text-slate-600">{detail.updatedAt || '-'}</span></p></div>
            {detailHistory.length > 0 && <div className="mt-4 rounded-xl border border-slate-200 p-3"><p className="mb-2 text-xs font-black text-[#173B57]">변경이력</p><div className="space-y-1.5">{detailHistory.slice(0, 5).map((entry) => <div key={String(entry.id)} className="flex items-center justify-between text-[11px]"><span className="font-bold text-slate-600">{String(entry.changedByName || '')} · {String(entry.changeType || '')}</span><span className="text-slate-400">{String(entry.changedAt || '')}</span></div>)}</div></div>}
            {(detail.canEdit || canDeleteDailyWork) && <div className="mt-5 flex gap-2">
              {detailEditing ? <>
                <button type="button" onClick={() => setDetailEditing(false)} className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-bold">취소</button>
                <button type="button" onClick={() => void saveDetail()} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#F28C28] text-sm font-bold text-white"><Save className="h-4 w-4" />저장</button>
              </> : <>
                {canDeleteDailyWork ? <button type="button" onClick={() => void deleteDetail()} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-bold text-rose-700"><Trash2 className="h-4 w-4" />삭제</button> : null}
                {detail.canEdit ? <button type="button" onClick={() => setDetailEditing(true)} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#173B57] text-sm font-bold text-white"><Pencil className="h-4 w-4" />수정</button> : null}
              </>}
            </div>}
          </div>
        </div>
      )}
    </div>
  );
};
