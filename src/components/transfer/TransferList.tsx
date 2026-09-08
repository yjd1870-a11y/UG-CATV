import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Calendar, CheckCircle2, ImagePlus, Images, MapPin, Plus, Search, Trash2, X, ChartNoAxesCombined } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { transfersApi, type TransferFilters, type TransferMeta, type TransferSummary } from '../../features/transfers/api';
import { koreaDate, resolveInspectionRequestedDate } from '../../features/transfers/registration-policy';
import type { TransferWorkflowStatus, WorkTransfer } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { TransferPhotoViewer } from './TransferPhotoViewer';

type PendingPhoto = { id: string; fileName: string; dataUrl: string; sourceKey: string; clientKey: string; status: 'idle' | 'uploading' | 'failed'; error?: string };
type InlineField = 'inspectionRequestedDate' | 'regionId' | 'customerAddress';
type EditingCell = { transferId: string; field: InlineField };
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_MIME_BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const emptySummary: TransferSummary = { registered: 0, field_processed: 0, completed: 0 };
const statusTabs: Array<{ value: TransferWorkflowStatus; label: string }> = [
  { value: 'registered', label: '미완료' }, { value: 'field_processed', label: '현장처리' }, { value: 'completed', label: '완료' },
];
const newClientKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const supportedPhotoMime = (file: File) => PHOTO_MIME_TYPES.has(file.type.toLowerCase())
  ? file.type.toLowerCase() : PHOTO_MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() || ''] || '';
const photoSourceKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
const readFile = (file: File, mimeType: string) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^;,]*;/i, `data:${mimeType};`));
  reader.onerror = () => reject(new Error('사진 파일을 읽지 못했습니다.'));
  reader.readAsDataURL(file);
});

export const TransferList: React.FC = () => {
  const { currentUser, navigateTo, selectTransfer, showToast, reloadBusinessData } = useApp();
  const [items, setItems] = useState<WorkTransfer[]>([]);
  const [meta, setMeta] = useState<TransferMeta | null>(null);
  const [summary, setSummary] = useState<TransferSummary>(emptySummary);
  const [status, setStatus] = useState<TransferWorkflowStatus | ''>('');
  const [regionId, setRegionId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [urgent, setUrgent] = useState<'all' | 'true' | 'false'>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registrationMode, setRegistrationMode] = useState<'standard' | 'bulk'>('standard');
  const [inspectionRequestedDate, setInspectionRequestedDate] = useState(koreaDate);
  const [newRegionId, setNewRegionId] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [location, setLocation] = useState('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const [pendingViewerIndex, setPendingViewerIndex] = useState<number | null>(null);
  const [listViewerPhotos, setListViewerPhotos] = useState<Array<{ id: string; url: string; fileName: string }> | null>(null);
  const [listViewerWindow, setListViewerWindow] = useState<Window | null>(null);
  const [listPhotosLoadingId, setListPhotosLoadingId] = useState('');
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0, success: 0, failed: 0 });
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [inlineValue, setInlineValue] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);
  const cancelInlineSave = useRef(false);
  const inspectionDateEdited = useRef(false);
  const standardClientKey = useRef(newClientKey());
  const addressInputRef = useRef<HTMLInputElement>(null);
  const listViewerWindowRef = useRef<Window | null>(null);

  const isManager = currentUser?.role === 'manager';
  const isGuest = currentUser?.role === 'guest';
  const canRegister = currentUser?.role === 'admin' || currentUser?.role === 'public_official' || currentUser?.role === 'team_leader';
  const visibleTabs = isManager ? statusTabs.slice(0, 1) : isGuest ? statusTabs.slice(0, 2) : statusTabs;
  const currentFilters = useMemo<TransferFilters>(() => ({
    status: isManager ? 'registered' : status, regionId: regionId || undefined, from: from || undefined, to: to || undefined,
    urgent: urgent === 'all' ? undefined : urgent === 'true', q: query || undefined,
  }), [from, isManager, query, regionId, status, to, urgent]);

  const loadTransfers = async (filters: TransferFilters) => {
    setLoading(true);
    try {
      const { status: _status, ...summaryFilters } = filters;
      const [nextItems, nextSummary] = await Promise.all([transfersApi.list(filters), transfersApi.summary(summaryFilters)]);
      setItems(nextItems); setSummary(nextSummary);
    } catch (error) { showToast(error instanceof Error ? error.message : '업무이관 목록을 불러오지 못했습니다.', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void transfersApi.meta().then((value) => {
      setMeta(value);
      if (isManager || isGuest) { setRegionId(value.currentRegionId || ''); setNewRegionId(value.currentRegionId || ''); }
      else { setRegionId(''); setNewRegionId(''); }
    }).catch((error) => showToast(error instanceof Error ? error.message : '지역 정보를 불러오지 못했습니다.', 'error'));
  }, [currentUser?.id, currentUser?.role, isGuest, isManager, showToast]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadTransfers(currentFilters); }, 250); return () => window.clearTimeout(timer); }, [currentFilters]);
  useEffect(() => () => {
    if (listViewerWindowRef.current && !listViewerWindowRef.current.closed) listViewerWindowRef.current.close();
    listViewerWindowRef.current = null;
  }, []);

  const resetRegistration = (preserveDateAndRegion = false) => {
    if (!preserveDateAndRegion) {
      inspectionDateEdited.current = false; setInspectionRequestedDate(koreaDate());
      setNewRegionId(''); setRegistrationMode('standard');
    }
    setLocation(''); setIsUrgent(false); setPhotos([]); setPendingViewerIndex(null); setPhotoDragActive(false);
    setBatchProgress({ completed: 0, total: 0, success: 0, failed: 0 }); standardClientKey.current = newClientKey();
  };
  const closeRegistration = () => { resetRegistration(); setShowNewModal(false); };

  const processPhotos = async (fileList: FileList | File[]) => {
    const selected = Array.from(fileList); if (!selected.length) return;
    const limit = registrationMode === 'bulk' ? 10 : 3;
    const withMime = selected.map((file) => ({ file, mimeType: supportedPhotoMime(file) }));
    if (withMime.some(({ mimeType }) => !mimeType)) { showToast('업무이관 사진은 JPG, PNG, WEBP 형식만 등록할 수 있습니다.', 'warning'); return; }
    if (withMime.some(({ file }) => file.size > 10 * 1024 * 1024)) { showToast('업무이관 사진은 한 장당 10MB 이하만 등록할 수 있습니다.', 'warning'); return; }
    const existingKeys = new Set(photos.map((photo) => photo.sourceKey));
    const unique = withMime.filter(({ file }) => !existingKeys.has(photoSourceKey(file)));
    if (!unique.length) { showToast('이미 선택된 사진입니다.', 'info'); return; }
    if (photos.length + unique.length > limit) { showToast(registrationMode === 'bulk' ? '일괄등록 사진은 최대 10장입니다.' : '업무이관 사진은 최대 3장입니다.', 'warning'); return; }
    try {
      const next = await Promise.all(unique.map(async ({ file, mimeType }, index) => ({
        id: `${Date.now()}-${index}-${file.name}`, fileName: file.name, dataUrl: await readFile(file, mimeType),
        sourceKey: photoSourceKey(file), clientKey: newClientKey(), status: 'idle' as const,
      })));
      setPhotos((current) => [...current, ...next]);
    } catch (error) { showToast(error instanceof Error ? error.message : '사진을 읽지 못했습니다.', 'error'); }
  };

  const createPayload = (requestPhotos: PendingPhoto[], address: string, clientRegistrationKey: string) => ({
    inspectionRequestedDate: resolveInspectionRequestedDate(inspectionRequestedDate, inspectionDateEdited.current), regionId: newRegionId,
    isUrgent, mediaType: 'CABLE', customerAddress: address.trim(), clientRegistrationKey,
    requestPhotos: requestPhotos.map(({ fileName, dataUrl }) => ({ fileName, dataUrl })),
  });
  const validateRegistration = (maxPhotos: number) => {
    if (!newRegionId || !resolveInspectionRequestedDate(inspectionRequestedDate, inspectionDateEdited.current)) { showToast('점검요청일과 지역을 확인해 주세요.', 'warning'); return false; }
    if (photos.length < 1 || photos.length > maxPhotos) { showToast(`사진을 1~${maxPhotos}장 등록해 주세요.`, 'warning'); return false; }
    return true;
  };
  const refreshBusinessData = async () => Promise.all([loadTransfers(currentFilters), reloadBusinessData()]);

  const submitSingle = async (keepOpen: boolean) => {
    if (registrationMode !== 'standard') { showToast('일반·연속 등록 모드로 변경해 주세요.', 'warning'); return; }
    if (!validateRegistration(3)) return; setSubmitting(true);
    try {
      await transfersApi.create(createPayload(photos, location, standardClientKey.current));
      showToast(keepOpen ? '등록되었습니다. 같은 날짜와 지역으로 계속 등록할 수 있습니다.' : '업무이관이 등록되었습니다.', 'success');
      if (keepOpen) { resetRegistration(true); window.setTimeout(() => addressInputRef.current?.focus(), 0); } else closeRegistration();
      await refreshBusinessData();
    } catch (error) { showToast(error instanceof Error ? error.message : '업무이관 등록에 실패했습니다.', 'error'); }
    finally { setSubmitting(false); }
  };

  const submitBulk = async () => {
    if (registrationMode !== 'bulk') { showToast('먼저 일괄등록 모드를 선택해 주세요.', 'warning'); return; }
    if (!validateRegistration(10)) return; setSubmitting(true);
    const targets = [...photos]; let successCount = 0; let failedCount = 0;
    setBatchProgress({ completed: 0, total: targets.length, success: 0, failed: 0 });
    for (let index = 0; index < targets.length; index += 1) {
      const photo = targets[index];
      setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, status: 'uploading', error: undefined } : item));
      try { await transfersApi.create(createPayload([photo], '', photo.clientKey)); successCount += 1; setPhotos((current) => current.filter((item) => item.id !== photo.id)); }
      catch (error) { failedCount += 1; const message = error instanceof Error ? error.message : '등록 실패'; setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, status: 'failed', error: message } : item)); }
      setBatchProgress({ completed: index + 1, total: targets.length, success: successCount, failed: failedCount });
    }
    setSubmitting(false); if (successCount) await refreshBusinessData();
    showToast(failedCount ? `${successCount}건 등록, ${failedCount}건 실패했습니다. 실패한 사진만 다시 시도할 수 있습니다.` : `${successCount}건을 일괄 등록했습니다.`, failedCount ? 'warning' : 'success');
  };

  const closeListViewer = useCallback(() => {
    const popup = listViewerWindowRef.current;
    listViewerWindowRef.current = null;
    setListViewerWindow(null);
    setListViewerPhotos(null);
    if (popup && !popup.closed) popup.close();
  }, []);
  const handlePopupClosed = useCallback(() => {
    listViewerWindowRef.current = null;
    setListViewerWindow(null);
    setListViewerPhotos(null);
  }, []);
  const openListPhotos = async (event: React.MouseEvent, transfer: WorkTransfer) => {
    event.stopPropagation();
    if (transfer.workflowStatus === 'completed' || !(transfer.attachments || []).length) { showToast(transfer.workflowStatus === 'completed' ? '완료 시 사진이 삭제되었습니다.' : '등록된 사진이 없습니다.', 'info'); return; }
    const wantsPopup = window.matchMedia('(min-width: 768px)').matches;
    const popup = wantsPopup ? window.open('', 'catv-transfer-photo-viewer', 'popup=yes,width=960,height=820,resizable=yes,scrollbars=no') : null;
    if (popup) {
      const isExistingViewer = listViewerWindowRef.current === popup && !popup.closed;
      listViewerWindowRef.current = popup;
      setListViewerWindow(popup);
      if (!isExistingViewer) {
        popup.document.title = '업무이관 사진 불러오는 중...';
        popup.document.body.style.cssText = 'margin:0;display:grid;place-items:center;min-height:100vh;background:#0f172a;color:white;font:600 14px system-ui,sans-serif';
        popup.document.body.textContent = '업무이관 사진을 불러오는 중입니다.';
      }
      popup.focus();
    } else if (wantsPopup) {
      showToast('팝업이 차단되어 현재 화면의 이동 가능한 사진창으로 열었습니다.', 'info');
    }
    setListPhotosLoadingId(transfer.id);
    try {
      const resolved = await Promise.all((transfer.attachments || []).map(async (photo) => ({ id: photo.id, fileName: photo.fileName, url: await transfersApi.attachmentAccessUrl(transfer.id, photo.id) })));
      setListViewerPhotos(resolved);
      popup?.focus();
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      if (listViewerWindowRef.current === popup) listViewerWindowRef.current = null;
      setListViewerWindow(null);
      showToast(error instanceof Error ? error.message : '사진을 불러오지 못했습니다.', 'error');
    }
    finally { setListPhotosLoadingId(''); }
  };
  const fieldValue = (transfer: WorkTransfer, field: InlineField) => {
    if (field === 'inspectionRequestedDate') return (transfer.inspectionRequestedDate || transfer.requestDate).slice(0, 10);
    if (field === 'regionId') return transfer.regionId || '';
    return transfer.location || '';
  };
  const beginInlineEdit = (event: React.MouseEvent | React.KeyboardEvent, transfer: WorkTransfer, field: InlineField) => {
    event.stopPropagation();
    if (!canRegister || transfer.workflowStatus === 'completed' || inlineSaving) return;
    if (field === 'regionId' && currentUser?.role === 'team_leader') return;
    cancelInlineSave.current = false;
    setEditingCell({ transferId: transfer.id, field });
    setInlineValue(fieldValue(transfer, field));
  };
  const cancelInlineEdit = () => {
    cancelInlineSave.current = true;
    setEditingCell(null);
    setInlineValue('');
  };
  const saveInlineEdit = async (transfer: WorkTransfer, field: InlineField, value: string) => {
    if (cancelInlineSave.current) { cancelInlineSave.current = false; return; }
    if (inlineSaving || !editingCell || editingCell.transferId !== transfer.id || editingCell.field !== field) return;
    if ((field === 'inspectionRequestedDate' || field === 'regionId') && !value) {
      showToast(field === 'regionId' ? '지역을 선택해 주세요.' : '점검요청일을 입력해 주세요.', 'warning');
      return;
    }
    if (value === fieldValue(transfer, field)) { setEditingCell(null); setInlineValue(''); return; }
    const scrollPosition = { left: window.scrollX, top: window.scrollY };
    setInlineSaving(true);
    try {
      const updatedTransfer = await transfersApi.update(transfer.id, { [field]: value });
      setItems((current) => current.map((item) => item.id === updatedTransfer.id ? updatedTransfer : item));
      setEditingCell(null); setInlineValue('');
      showToast('업무이관 정보를 수정했습니다.', 'success');
      await reloadBusinessData();
    } catch (error) {
      setEditingCell(null); setInlineValue('');
      showToast(error instanceof Error ? error.message : '수정에 실패했습니다.', 'error');
    } finally {
      setInlineSaving(false);
      window.requestAnimationFrame(() => window.scrollTo({ ...scrollPosition, behavior: 'auto' }));
    }
  };
  const inlineKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); cancelInlineEdit(); }
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
  };
  const handleComplete = async (event: React.MouseEvent, transfer: WorkTransfer) => {
    event.stopPropagation(); if (!window.confirm(`${transfer.regionName} 업무를 최종 완료하시겠습니까? 완료하면 등록 사진은 복구할 수 없게 완전 삭제됩니다.`)) return;
    try { await transfersApi.complete(transfer.id); showToast('업무이관을 최종 완료했습니다.', 'success'); await refreshBusinessData(); }
    catch (error) { showToast(error instanceof Error ? error.message : '완료 처리에 실패했습니다.', 'error'); }
  };

  return <div id="transfer-list-view" className="space-y-4 pb-20 sm:pb-8">
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-[#F28C28]" /><h1 className="text-xl font-extrabold text-[#173B57]">업무이관 관리</h1></div><p className="mt-0.5 text-xs text-slate-500">사진 접수 · 지역 현장처리 · 최종 완료</p></div>{canRegister ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => navigateTo('transfer_analytics')} className="inline-flex items-center gap-1.5 rounded-xl border border-[#2878B5] bg-white px-4 py-2 text-xs font-bold text-[#2878B5]"><ChartNoAxesCombined className="h-4 w-4" />업무이관 통계</button><button type="button" onClick={() => { resetRegistration(); setShowNewModal(true); }} className="inline-flex items-center gap-1.5 rounded-xl bg-[#F28C28] px-4 py-2 text-xs font-bold text-white"><Plus className="h-4 w-4" />업무이관 등록</button></div> : null}</div>
    <section className="space-y-3 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-5" aria-label="업무이관 검색 조건">
      <div className={`grid gap-2 ${visibleTabs.length === 1 ? 'grid-cols-1' : visibleTabs.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>{visibleTabs.map((tab) => <button key={tab.value} type="button" onClick={() => { if (!isManager) setStatus((current) => current === tab.value ? '' : tab.value); }} className={`rounded-xl border p-3 text-left ${status === tab.value || isManager ? 'border-[#173B57] bg-[#173B57] text-white' : 'border-[#E5E7EB] bg-[#F9FAFB] text-[#173B57]'}`}><span className="block text-[11px] font-bold opacity-75">{tab.label}</span><strong className="text-xl">{summary[tab.value]}</strong></button>)}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-[11px] font-bold text-slate-600">접수 시작일<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3" /></label><label className="text-[11px] font-bold text-slate-600">접수 종료일<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3" /></label>{isManager || isGuest ? <div className="text-[11px] font-bold text-slate-600">담당 지역<div className="mt-1 flex h-10 items-center rounded-xl border border-slate-200 bg-slate-100 px-3">{meta?.currentRegionName || '-'}</div></div> : <label className="text-[11px] font-bold text-slate-600">지역<select value={regionId} onChange={(event) => setRegionId(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"><option value="">전체</option>{meta?.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label>}<label className="text-[11px] font-bold text-slate-600">긴급 여부<select value={urgent} onChange={(event) => setUrgent(event.target.value as typeof urgent)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3"><option value="all">전체</option><option value="true">긴급</option><option value="false">일반</option></select></label></div>
      <div className="relative"><Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지역, 주소, 매체, 처리내용, 현장처리자 검색" className="h-11 w-full rounded-xl border border-[#D1D5DB] bg-[#F9FAFB] pr-10 pl-10 text-xs outline-none focus:border-[#2878B5] focus:bg-white" />{query ? <button type="button" aria-label="검색어 지우기" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400"><X className="h-4 w-4" /></button> : null}</div>
    </section>
    <div className="space-y-3" aria-live="polite">{loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">업무이관을 불러오는 중입니다.</div> : items.length === 0 ? <div className="rounded-2xl border border-[#E5E7EB] bg-white p-12 text-center"><ArrowRightLeft className="mx-auto mb-2 h-10 w-10 text-slate-300" /><div className="text-sm font-bold text-[#173B57]">해당 조건의 업무이관 내역이 없습니다.</div></div> : items.map((item) => {
      const canEditItem = canRegister && item.workflowStatus !== 'completed';
      const editingDate = editingCell?.transferId === item.id && editingCell.field === 'inspectionRequestedDate';
      const editingRegion = editingCell?.transferId === item.id && editingCell.field === 'regionId';
      const editingAddress = editingCell?.transferId === item.id && editingCell.field === 'customerAddress';
      const editableTextClass = 'min-h-6 rounded-md px-1.5 py-0.5 text-left outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-[#2878B5]';
      return <article key={item.id} onClick={() => { if (isManager || isGuest) selectTransfer(item.id); }} className={`rounded-2xl border bg-white p-4 shadow-sm transition sm:p-5 ${isManager || isGuest ? 'cursor-pointer hover:shadow-md' : ''} ${item.isUrgent ? 'border-red-300' : 'border-[#E5E7EB]'}`}>
        <div className="mb-3 flex items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={item.status} size="sm" />{item.isUrgent ? <span className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-extrabold text-red-700"><AlertTriangle className="h-3 w-3" />긴급</span> : null}</div>{inlineSaving && editingCell?.transferId === item.id ? <span className="text-[11px] font-bold text-[#2878B5]">저장 중...</span> : null}</div>
        <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="flex items-center gap-1 font-bold text-slate-500"><Calendar className="h-3 w-3" />점검요청일</dt>
          <dd className="font-semibold text-slate-800">{editingDate ? <input autoFocus type="date" required disabled={inlineSaving} value={inlineValue} onClick={(event) => event.stopPropagation()} onChange={(event) => setInlineValue(event.target.value)} onBlur={(event) => void saveInlineEdit(item, 'inspectionRequestedDate', event.currentTarget.value)} onKeyDown={inlineKeyDown} className="h-8 w-full max-w-48 rounded-lg border border-[#2878B5] bg-white px-2 outline-none ring-2 ring-blue-100" /> : canEditItem ? <button type="button" aria-label="점검요청일 수정" title="더블클릭하여 수정" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => beginInlineEdit(event, item, 'inspectionRequestedDate')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') beginInlineEdit(event, item, 'inspectionRequestedDate'); }} className={editableTextClass}>{item.inspectionRequestedDate || item.requestDate}</button> : item.inspectionRequestedDate || item.requestDate}</dd>
          <dt className="font-bold text-slate-500">지역</dt>
          <dd className="font-extrabold text-[#173B57]">{editingRegion ? <select autoFocus required disabled={inlineSaving} value={inlineValue} onClick={(event) => event.stopPropagation()} onChange={(event) => setInlineValue(event.target.value)} onBlur={(event) => void saveInlineEdit(item, 'regionId', event.currentTarget.value)} onKeyDown={inlineKeyDown} className="h-8 w-full max-w-48 rounded-lg border border-[#2878B5] bg-white px-2 outline-none ring-2 ring-blue-100">{meta?.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select> : canEditItem ? <button type="button" aria-label="지역 수정" title="더블클릭하여 수정" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => beginInlineEdit(event, item, 'regionId')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') beginInlineEdit(event, item, 'regionId'); }} className={editableTextClass}>{item.regionName || '-'}</button> : item.regionName || '-'}</dd>
          <dt className="flex items-center gap-1 font-bold text-slate-500"><MapPin className="h-3 w-3" />주소</dt>
          <dd className={`font-medium ${item.location ? 'text-slate-800' : 'text-amber-700'}`}>{editingAddress ? <input autoFocus disabled={inlineSaving} value={inlineValue} placeholder="주소 미입력" onClick={(event) => event.stopPropagation()} onChange={(event) => setInlineValue(event.target.value)} onBlur={(event) => void saveInlineEdit(item, 'customerAddress', event.currentTarget.value)} onKeyDown={inlineKeyDown} className="h-8 w-full rounded-lg border border-[#2878B5] bg-white px-2 text-slate-800 outline-none ring-2 ring-blue-100" /> : canEditItem ? <button type="button" aria-label="주소 수정" title="더블클릭하여 수정" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => beginInlineEdit(event, item, 'customerAddress')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') beginInlineEdit(event, item, 'customerAddress'); }} className={editableTextClass}>{item.location || '주소 미입력'}</button> : item.location || '주소 미입력'}</dd>
          <dt className="font-bold text-slate-500">처리내용</dt><dd className="line-clamp-3 whitespace-pre-wrap font-medium text-slate-800">{item.workflowStatus === 'registered' ? '현장처리 대기' : item.fieldActionSummary || '-'}</dd>
          <dt className="font-bold text-slate-500">작업처리자</dt><dd className="font-semibold text-slate-800">{item.fieldProcessedByName || '미지정'}</dd>
        </dl>
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3"><button type="button" disabled={listPhotosLoadingId === item.id || item.workflowStatus === 'completed' || !(item.attachments || []).length} onClick={(event) => void openListPhotos(event, item)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-100 px-4 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"><Images className="h-4 w-4" />{item.workflowStatus === 'completed' ? '사진 삭제됨' : listPhotosLoadingId === item.id ? '불러오는 중' : `사진보기 (${item.evidencePhotoCount || 0})`}</button><button type="button" onClick={(event) => { event.stopPropagation(); selectTransfer(item.id); }} className="h-9 rounded-xl bg-[#2878B5] px-4 text-xs font-bold text-white">{isManager ? '현장처리' : '상세/처리'}</button>{canRegister ? <button type="button" disabled={item.workflowStatus !== 'field_processed'} onClick={(event) => void handleComplete(event, item)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"><CheckCircle2 className="h-4 w-4" />완료</button> : null}</div>
      </article>;
    })}</div>
    {showNewModal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs"><div role="dialog" aria-modal="true" aria-labelledby="transfer-create-title" className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white p-5"><h2 id="transfer-create-title" className="flex items-center gap-2 text-base font-extrabold text-[#173B57]"><ArrowRightLeft className="h-5 w-5 text-[#F28C28]" />업무이관 신규 등록</h2><button type="button" aria-label="등록창 닫기" disabled={submitting} onClick={closeRegistration} className="p-1 text-slate-400 disabled:opacity-40"><X className="h-5 w-5" /></button></div>
      <div className="space-y-4 p-5 text-xs"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="font-bold text-slate-700">점검요청일 *<input type="date" required value={inspectionRequestedDate} onChange={(event) => { inspectionDateEdited.current = true; setInspectionRequestedDate(event.target.value); }} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3" /></label><label className="font-bold text-slate-700">지역 *<select required disabled={submitting} value={newRegionId} onChange={(event) => setNewRegionId(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 disabled:bg-slate-100"><option value="">지역 선택</option>{meta?.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label></div><label className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 font-bold text-red-800"><input type="checkbox" checked={isUrgent} onChange={(event) => setIsUrgent(event.target.checked)} className="h-4 w-4" />긴급 건으로 우선 처리</label><label className="block font-bold text-slate-700">고객주소<input ref={addressInputRef} value={location} disabled={registrationMode === 'bulk'} onChange={(event) => setLocation(event.target.value)} placeholder={registrationMode === 'bulk' ? '일괄등록은 주소 공란으로 생성됩니다.' : '공란으로 등록한 후 목록에서 수정할 수 있습니다.'} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 disabled:bg-slate-100" /></label>
      <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1"><button type="button" disabled={submitting} onClick={() => { setRegistrationMode('standard'); setPhotos([]); setBatchProgress({ completed: 0, total: 0, success: 0, failed: 0 }); }} className={`h-10 rounded-lg font-bold ${registrationMode === 'standard' ? 'bg-white text-[#173B57] shadow-sm' : 'text-slate-500'}`}>일반·연속 (1~3장)</button><button type="button" disabled={submitting} onClick={() => { setRegistrationMode('bulk'); setLocation(''); setPhotos([]); setBatchProgress({ completed: 0, total: 0, success: 0, failed: 0 }); }} className={`h-10 rounded-lg font-bold ${registrationMode === 'bulk' ? 'bg-white text-[#173B57] shadow-sm' : 'text-slate-500'}`}>일괄 (1~10장)</button></div>
      <div><div className="mb-2 flex items-center justify-between gap-2"><span className="font-bold text-slate-700">업무이관 사진 * ({photos.length}/{registrationMode === 'bulk' ? 10 : 3})</span><span className="text-[10px] text-slate-400">JPG/PNG/WEBP · 장당 10MB</span></div><label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 font-bold text-slate-700"><Images className="h-4 w-4" />갤러리에서 선택<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={submitting} onChange={(event) => { const selected: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : []; event.currentTarget.value = ''; void processPhotos(selected); }} className="sr-only" /></label><div onDragEnter={(event) => { event.preventDefault(); setPhotoDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setPhotoDragActive(false)} onDrop={(event) => { event.preventDefault(); setPhotoDragActive(false); if (!submitting) void processPhotos(event.dataTransfer.files); }} className={`mt-2 hidden h-10 items-center justify-center gap-2 rounded-xl border border-dashed font-bold sm:flex ${photoDragActive ? 'border-[#2878B5] bg-blue-50 text-[#2878B5]' : 'border-slate-300 text-slate-500'}`}><ImagePlus className="h-4 w-4" />사진을 여기에 끌어놓을 수도 있습니다.</div>{photos.length ? <div className={`mt-3 grid gap-2 ${registrationMode === 'bulk' ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-3'}`}>{photos.map((photo, index) => <div key={photo.id} className={`relative overflow-hidden rounded-xl border bg-slate-50 ${photo.status === 'failed' ? 'border-red-300' : 'border-slate-200'}`}><button type="button" disabled={submitting} onClick={() => setPendingViewerIndex(index)} className="block w-full"><img src={photo.dataUrl} alt={photo.fileName} className="aspect-square w-full object-cover" /><span className="absolute top-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white">{index + 1}</span></button><button type="button" disabled={submitting} aria-label={`${index + 1}번 사진 삭제`} onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))} className="absolute top-1.5 right-1.5 rounded-md bg-red-600 p-1 text-white disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button><p className="truncate px-2 py-1 text-[9px] text-slate-500">{photo.status === 'uploading' ? '등록 중...' : photo.error || photo.fileName}</p></div>)}</div> : <p className="mt-2 text-[11px] text-amber-700">사진을 1장 이상 등록해 주세요.</p>}{batchProgress.total ? <div className="mt-3 rounded-xl bg-blue-50 p-3 font-bold text-blue-800">처리 중 {batchProgress.completed}/{batchProgress.total} · 성공 {batchProgress.success} · 실패 {batchProgress.failed}</div> : null}<p className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] font-medium text-amber-800">업무이관 완료 시 CATV에 업로드된 첨부사진은 자동으로 완전 삭제됩니다.</p></div></div>
      <div className="sticky bottom-0 z-10 grid grid-cols-2 gap-2 border-t border-slate-100 bg-white p-4 sm:grid-cols-4"><button type="button" disabled={submitting} onClick={closeRegistration} className="h-11 rounded-xl bg-slate-100 font-bold text-slate-700 disabled:opacity-50">취소</button><button type="button" disabled={submitting || registrationMode === 'bulk' || !inspectionRequestedDate || !newRegionId || photos.length < 1 || photos.length > 3} onClick={() => void submitSingle(false)} className="h-11 rounded-xl bg-[#F28C28] font-bold text-white disabled:opacity-40">저장 및 등록</button><button type="button" disabled={submitting || registrationMode === 'bulk' || !inspectionRequestedDate || !newRegionId || photos.length < 1 || photos.length > 3} onClick={() => void submitSingle(true)} className="h-11 rounded-xl bg-[#2878B5] font-bold text-white disabled:opacity-40">연속등록</button><button type="button" disabled={submitting || registrationMode !== 'bulk' || !inspectionRequestedDate || !newRegionId || photos.length < 1 || photos.length > 10} onClick={() => void submitBulk()} className="h-11 rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-40">{submitting && registrationMode === 'bulk' ? '일괄등록 중' : '일괄등록'}</button></div></div></div> : null}
    {pendingViewerIndex !== null ? <TransferPhotoViewer photos={photos.map((photo) => ({ id: photo.id, url: photo.dataUrl, fileName: photo.fileName }))} initialIndex={pendingViewerIndex} onClose={() => setPendingViewerIndex(null)} /> : null}
    {listViewerPhotos ? <TransferPhotoViewer photos={listViewerPhotos} initialIndex={0} onClose={closeListViewer} desktopFloating={!listViewerWindow} targetWindow={listViewerWindow} onPopupClosed={handlePopupClosed} /> : null}
  </div>;
};
