import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  ChartNoAxesCombined,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { transfersApi, type TransferFilters, type TransferMeta, type TransferSummary } from '../../features/transfers/api';
import { recognizeWorkTransferPhotoInBrowser, type BrowserOcrResult } from '../../features/transfers/browser-ocr/engine';
import { HNS_BRANCHES, HNS_BRANCH_REGION_HINTS } from '../../features/transfers/browser-ocr/validation';
import type { TransferWorkflowStatus, WorkTransfer } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

type PendingPhoto = { fileName: string; dataUrl: string };
const emptySummary: TransferSummary = { registered: 0, field_processed: 0, completed: 0 };
const statusTabs: Array<{ value: TransferWorkflowStatus; label: string }> = [
  { value: 'registered', label: '미완료' },
  { value: 'field_processed', label: '현장처리' },
  { value: 'completed', label: '완료' },
];

const localDate = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
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
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMessage, setOcrMessage] = useState('');
  const [ocrStatus, setOcrStatus] = useState<'pending' | 'succeeded' | 'failed'>('pending');

  const [inspectionRequestedDate, setInspectionRequestedDate] = useState(localDate);
  const [newRegionId, setNewRegionId] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [location, setLocation] = useState('');
  const [handoverReason, setHandoverReason] = useState('');
  const [tapRnLocation, setTapRnLocation] = useState('');
  const [poleNumber, setPoleNumber] = useState('');
  const [leadInLength, setLeadInLength] = useState('');
  const [preActionNotes, setPreActionNotes] = useState('');
  const [inspectionRequestDetails, setInspectionRequestDetails] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState<PendingPhoto[]>([]);
  const [ocrSource, setOcrSource] = useState<{ fileName: string; previewUrl: string } | null>(null);
  const [ocrResult, setOcrResult] = useState<BrowserOcrResult | null>(null);
  const [ocrReviewed, setOcrReviewed] = useState(false);
  const [ocrDragActive, setOcrDragActive] = useState(false);
  const [evidenceDragActive, setEvidenceDragActive] = useState(false);
  const ocrRequestId = useRef(0);
  const ocrAbortController = useRef<AbortController | null>(null);
  const ocrPreviewUrl = useRef('');

  const isManager = currentUser?.role === 'manager';
  const canRegister = currentUser?.role === 'admin' || currentUser?.role === 'public_official' || currentUser?.role === 'team_leader';
  const canComplete = canRegister;
  const visibleTabs = useMemo(() => isManager ? statusTabs.filter((tab) => tab.value !== 'completed') : statusTabs, [isManager]);

  const currentFilters = useMemo<TransferFilters>(() => ({
    status,
    regionId: regionId || undefined,
    from: from || undefined,
    to: to || undefined,
    urgent: urgent === 'all' ? undefined : urgent === 'true',
    q: query || undefined,
  }), [from, query, regionId, status, to, urgent]);

  const loadTransfers = async (filters: TransferFilters) => {
    setLoading(true);
    try {
      const { status: _status, ...summaryFilters } = filters;
      const [nextItems, nextSummary] = await Promise.all([
        transfersApi.list(filters),
        transfersApi.summary(summaryFilters),
      ]);
      setItems(nextItems);
      setSummary(nextSummary);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '업무이관 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void transfersApi.meta()
      .then((value) => {
        setMeta(value);
        if (currentUser?.role === 'team_leader' || currentUser?.role === 'manager') {
          setRegionId(value.currentRegionId || '');
          setNewRegionId(value.currentRegionId || '');
        } else {
          setNewRegionId('');
        }
      })
      .catch((error) => showToast(error instanceof Error ? error.message : '지역 정보를 불러오지 못했습니다.', 'error'));
  }, [currentUser?.id, currentUser?.role, showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTransfers(currentFilters); }, 250);
    return () => window.clearTimeout(timer);
  }, [currentFilters]);

  useEffect(() => () => {
    ocrAbortController.current?.abort();
    if (ocrPreviewUrl.current) URL.revokeObjectURL(ocrPreviewUrl.current);
  }, []);

  const resetRegistration = () => {
    // Ignore an OCR response that arrives after the registration form closes.
    ocrRequestId.current += 1;
    ocrAbortController.current?.abort();
    ocrAbortController.current = null;
    if (ocrPreviewUrl.current) URL.revokeObjectURL(ocrPreviewUrl.current);
    ocrPreviewUrl.current = '';
    setInspectionRequestedDate(localDate());
    setNewRegionId((currentUser?.role === 'team_leader' ? meta?.currentRegionId : '') || '');
    setIsUrgent(false);
    setBranchName('');
    setRequesterName('');
    setLocation('');
    setHandoverReason('');
    setTapRnLocation('');
    setPoleNumber('');
    setLeadInLength('');
    setPreActionNotes('');
    setInspectionRequestDetails('');
    setOcrText('');
    setEvidencePhotos([]);
    setOcrSource(null);
    setOcrResult(null);
    setOcrReviewed(false);
    setOcrDragActive(false);
    setEvidenceDragActive(false);
    setOcrMessage('');
    setOcrStatus('pending');
    setOcrLoading(false);
  };

  const closeRegistration = () => {
    resetRegistration();
    setShowNewModal(false);
  };

  const applyRegionHint = (branch: string) => {
    if (!meta || currentUser?.role === 'team_leader' || !branch) return false;
    const hints = HNS_BRANCH_REGION_HINTS[branch as keyof typeof HNS_BRANCH_REGION_HINTS] || [];
    const matches = meta.regions.filter((region) => hints.some((hint) => (
      region.name.replace(/\s/g, '').includes(hint.replace(/\s/g, ''))
    )));
    if (matches.length !== 1) return false;
    setNewRegionId(matches[0].id);
    return true;
  };

  const processOcrPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('OCR에는 이미지 파일만 등록할 수 있습니다.', 'warning');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('OCR 사진은 15MB 이하만 사용할 수 있습니다.', 'warning');
      return;
    }
    ocrAbortController.current?.abort();
    const controller = new AbortController();
    ocrAbortController.current = controller;
    const requestId = ++ocrRequestId.current;
    if (ocrPreviewUrl.current) URL.revokeObjectURL(ocrPreviewUrl.current);
    const previewUrl = URL.createObjectURL(file);
    ocrPreviewUrl.current = previewUrl;
    setOcrSource({ fileName: file.name, previewUrl });
    setOcrResult(null);
    setOcrReviewed(false);
    setOcrLoading(true);
    setOcrStatus('pending');
    setOcrMessage('사진 품질을 확인하고 있습니다.');
    try {
      const result = await recognizeWorkTransferPhotoInBrowser(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (requestId === ocrRequestId.current) setOcrMessage(progress.message);
        },
      });
      if (requestId !== ocrRequestId.current) return;
      setOcrResult(result);
      setOcrStatus(result.status);
      if (result.status === 'succeeded') {
        setOcrText(result.text);
        const recognizedBranch = result.fields.branchName.value;
        setBranchName(recognizedBranch);
        setRequesterName(result.fields.requesterName.value);
        if (result.fields.inspectionRequestedDate.validationStatus === 'valid') {
          setInspectionRequestedDate(result.fields.inspectionRequestedDate.value);
        }
        setLocation(result.fields.customerAddress.value);
        setHandoverReason(result.fields.handoverReason.value);
        setTapRnLocation(result.fields.tapRnLocation.value);
        setPoleNumber(result.fields.poleNumber.value);
        setLeadInLength(result.fields.leadInLength.value);
        setPreActionNotes(result.fields.preActionNotes.value);
        setInspectionRequestDetails(result.fields.inspectionRequestDetails.value);
        const regionMapped = applyRegionHint(recognizedBranch);
        setOcrMessage(!recognizedBranch
          ? 'OCR은 완료됐지만 지점명을 확정하지 못했습니다. 지점과 지역을 직접 선택해 주세요.'
          : !regionMapped && currentUser?.role !== 'team_leader'
            ? 'OCR은 완료됐습니다. 지점은 확인했지만 지역은 자동 확정하지 않았으니 직접 확인해 주세요.'
            : result.requiresReview
              ? 'OCR 변환이 완료되었습니다. 경고 항목과 원문을 확인해 주세요.'
              : 'OCR 변환이 완료되었습니다. 저장 전 내용을 확인해 주세요.');
      } else {
        setOcrMessage(result.errorMessage || 'OCR 변환에 실패했습니다. 다시 촬영하거나 직접 입력해 주세요.');
      }
    } catch (error) {
      if (requestId !== ocrRequestId.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      setOcrStatus('failed');
      setOcrMessage(error instanceof Error ? error.message : '브라우저 OCR 처리에 실패했습니다.');
    } finally {
      if (requestId === ocrRequestId.current) setOcrLoading(false);
    }
  };

  const handleOcrPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    await processOcrPhoto(file);
  };

  const handleOcrDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOcrDragActive(false);
    void processOcrPhoto(event.dataTransfer.files?.[0]);
  };

  const processEvidencePhotos = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/')).slice(0, 5) as File[];
    if (files.length === 0) return;
    if (files.some((file) => file.size > 15 * 1024 * 1024)) {
      showToast('증빙사진은 한 장당 15MB 이하만 등록할 수 있습니다.', 'warning');
      return;
    }
    try {
      const nextPhotos = await Promise.all(files.map(async (file) => ({ fileName: file.name, dataUrl: await readFile(file) })));
      setEvidencePhotos(nextPhotos);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '증빙사진을 읽지 못했습니다.', 'error');
    }
  };

  const handleEvidencePhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    event.target.value = '';
    if (files) await processEvidencePhotos(files);
  };

  const handleEvidenceDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setEvidenceDragActive(false);
    void processEvidencePhotos(event.dataTransfer.files);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newRegionId || !branchName || !inspectionRequestedDate || !location.trim()
      || !handoverReason.trim() || !inspectionRequestDetails.trim()) {
      showToast('지점, 지역, 점검요청일, 고객주소, 이관사유, 점검요청내용은 필수입니다.', 'warning');
      return;
    }
    if (ocrResult?.status === 'succeeded' && !ocrReviewed) {
      showToast('OCR 결과를 확인한 뒤 확인란을 선택해 주세요.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await transfersApi.create({
        inspectionRequestedDate,
        regionId: newRegionId,
        isUrgent,
        branchName,
        requesterName: requesterName.trim(),
        customerAddress: location.trim(),
        handoverReason: handoverReason.trim(),
        tapRnLocation: tapRnLocation.trim(),
        poleNumber: poleNumber.trim(),
        leadInLength: leadInLength.trim(),
        preActionNotes: preActionNotes.trim(),
        inspectionRequestDetails: inspectionRequestDetails.trim(),
        inspectionCompany: '유지텔레컴',
        mediaType: 'CABLE',
        ocrText: ocrText.trim(),
        ocrStatus,
        ocrError: ocrStatus === 'failed' ? ocrMessage : '',
        ocrEngine: ocrResult?.engine || 'manual',
        ocrConfidence: ocrResult?.confidence,
        ocrQuality: ocrResult?.quality,
        requestPhotos: evidencePhotos,
      });
      showToast('업무이관이 미완료 상태로 등록되었습니다.', 'success');
      closeRegistration();
      await Promise.all([loadTransfers(currentFilters), reloadBusinessData()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '업무이관 등록에 실패했습니다.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async (event: React.MouseEvent, transfer: WorkTransfer) => {
    event.stopPropagation();
    if (!window.confirm(`${transfer.regionName} 업무를 최종 완료하시겠습니까?`)) return;
    try {
      await transfersApi.complete(transfer.id);
      showToast('업무이관을 최종 완료했습니다.', 'success');
      await Promise.all([loadTransfers(currentFilters), reloadBusinessData()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '완료 처리에 실패했습니다.', 'error');
    }
  };

  return (
    <div id="transfer-list-view" className="space-y-4 pb-20 sm:pb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-[#F28C28]" />
            <h1 className="text-xl font-extrabold text-[#173B57]">업무이관 관리</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">사진 접수 · 지역 현장처리 · 최종 완료</p>
        </div>
        {canRegister ? <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <button type="button" onClick={() => navigateTo('transfer_analytics')} className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-[#2878B5] text-[#2878B5] text-xs font-bold rounded-xl shadow-xs">
            <ChartNoAxesCombined className="w-4 h-4" /> 업무이관 통계
          </button>
          <button
            type="button"
            onClick={() => {
              resetRegistration();
              setShowNewModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F28C28] hover:bg-[#d97718] text-white text-xs font-bold rounded-xl shadow-xs transition"
          >
            <Plus className="w-4 h-4" /> 업무이관 등록
          </button>
        </div> : null}
      </div>

      <section className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-[#E5E7EB] space-y-3" aria-label="업무이관 검색 조건">
        <div className={`grid gap-2 ${isManager ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatus((current) => current === tab.value ? '' : tab.value)}
              className={`rounded-xl border p-3 text-left transition ${status === tab.value ? 'bg-[#173B57] border-[#173B57] text-white' : 'bg-[#F9FAFB] border-[#E5E7EB] text-[#173B57]'}`}
            >
              <span className="block text-[11px] font-bold opacity-75">{tab.label}</span>
              <strong className="text-xl">{summary[tab.value]}</strong>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-[11px] font-bold text-slate-600">접수 시작일
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" />
          </label>
          <label className="text-[11px] font-bold text-slate-600">접수 종료일
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" />
          </label>
          {isManager ? (
            <div className="text-[11px] font-bold text-slate-600">담당 지역
              <div className="mt-1 h-10 px-3 flex items-center rounded-xl border border-slate-200 bg-slate-100 text-slate-800">{meta?.currentRegionName || '지역 미지정'}</div>
            </div>
          ) : (
            <label className="text-[11px] font-bold text-slate-600">지역
              <select value={regionId} onChange={(event) => setRegionId(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50">
                <option value="">전체 지역</option>
                {meta?.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-[11px] font-bold text-slate-600">긴급 여부
            <select value={urgent} onChange={(event) => setUrgent(event.target.value as typeof urgent)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50">
              <option value="all">전체</option><option value="true">긴급</option><option value="false">일반</option>
            </select>
          </label>
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지점, 요청자, 주소, 이관사유, TAP/RN, 전주번호, 점검·현장처리, OCR 원문 검색" className="w-full h-11 pl-10 pr-10 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl text-xs outline-none focus:bg-white focus:border-[#2878B5]" />
          {query ? <button type="button" aria-label="검색어 지우기" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400"><X className="w-4 h-4" /></button> : null}
        </div>
      </section>

      <div className="space-y-3" aria-live="polite">
        {loading ? (
          <div className="bg-white rounded-2xl p-10 text-center text-sm text-slate-500 border border-slate-200">업무이관을 불러오는 중입니다.</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-[#E5E7EB]">
            <ArrowRightLeft className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <div className="text-sm font-bold text-[#173B57]">해당 조건의 업무이관 내역이 없습니다.</div>
          </div>
        ) : items.map((item) => (
          <article key={item.id} onClick={() => selectTransfer(item.id)} className={`bg-white rounded-2xl p-4 sm:p-5 border shadow-sm hover:shadow-md transition cursor-pointer ${item.isUrgent ? 'border-red-300' : 'border-[#E5E7EB]'}`}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={item.status} size="sm" />
                {item.isUrgent ? <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-lg"><AlertTriangle className="w-3 h-3" />긴급</span> : null}
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </div>
            <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-xs">
              <dt className="font-bold text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" />점검요청일</dt><dd className="font-semibold text-slate-800">{item.inspectionRequestedDate || item.requestDate}</dd>
              <dt className="font-bold text-slate-500">지역/지점</dt><dd className="font-extrabold text-[#173B57]">{item.regionName || '-'} · {item.branchName || '-'}</dd>
              <dt className="font-bold text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />주소</dt><dd className="font-medium text-slate-800">{item.location}</dd>
              <dt className="font-bold text-slate-500">처리내용</dt><dd className="font-medium text-slate-800 whitespace-pre-wrap line-clamp-3">{item.workflowStatus === 'registered' ? '현장처리 대기' : item.fieldActionSummary || '-'}</dd>
            </dl>
            {canComplete ? (
              <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  disabled={item.workflowStatus !== 'field_processed'}
                  onClick={(event) => void handleComplete(event, item)}
                  className="inline-flex items-center gap-1.5 px-4 h-9 rounded-xl text-xs font-bold bg-emerald-600 text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                ><CheckCircle2 className="w-4 h-4" />완료</button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {showNewModal ? (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="transfer-create-title" className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 id="transfer-create-title" className="font-extrabold text-base text-[#173B57] flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-[#F28C28]" />업무이관 신규 등록</h2>
              <button type="button" aria-label="등록창 닫기" onClick={closeRegistration} className="p-1 text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="font-bold text-slate-700">점검요청일 *
                  <input type="date" required value={inspectionRequestedDate} onChange={(event) => { setInspectionRequestedDate(event.target.value); setOcrReviewed(false); }} className="mt-1 w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl" />
                </label>
                <label className="font-bold text-slate-700">지역 *
                  <select required disabled={currentUser?.role === 'team_leader'} value={newRegionId} onChange={(event) => setNewRegionId(event.target.value)} className="mt-1 w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl disabled:bg-slate-100">
                    <option value="">지역 선택</option>{meta?.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 p-3 rounded-xl border border-red-200 bg-red-50 text-red-800 font-bold">
                <input type="checkbox" checked={isUrgent} onChange={(event) => setIsUrgent(event.target.checked)} className="w-4 h-4" />선완료 긴급 건으로 우선 처리
              </label>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-bold text-slate-700">OCR용 점검사진</span><span className="text-[10px] text-emerald-700">서버 전송·저장 안 함</span>
                </div>
                <label
                  onDragEnter={(event) => { event.preventDefault(); setOcrDragActive(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setOcrDragActive(false)}
                  onDrop={handleOcrDrop}
                  className={`h-24 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer font-bold transition ${ocrDragActive ? 'border-[#2878B5] bg-blue-100 text-[#173B57]' : 'border-blue-200 bg-blue-50/50 text-[#2878B5]'}`}
                >
                  <ImagePlus className="w-6 h-6" />사진 촬영·선택 또는 여기에 드래그
                  <span className="text-[10px] font-medium opacity-70">무료 OCR · JPG/PNG/WEBP</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void handleOcrPhoto(event)} className="sr-only" />
                </label>
                {ocrSource ? <div className="mt-2 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2"><img src={ocrSource.previewUrl} alt={ocrSource.fileName} className="w-20 h-16 object-cover rounded-lg border border-emerald-200" /><div className="min-w-0"><p className="truncate font-bold text-slate-700">{ocrSource.fileName}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />현재 브라우저 메모리에서만 처리됩니다.</p></div></div> : null}
                {ocrMessage ? <div className={`mt-2 p-2.5 rounded-lg flex items-center gap-2 ${ocrLoading ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'}`}><Sparkles className="w-4 h-4 shrink-0" />{ocrMessage}</div> : null}
                {ocrResult ? <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-lg bg-slate-50 p-2"><strong>전체 신뢰도</strong><span className="ml-1">{Math.round(ocrResult.confidence * 100)}%</span></div>
                  <div className="rounded-lg bg-slate-50 p-2"><strong>사진 품질</strong><span className="ml-1">{ocrResult.quality.status === 'good' ? '양호' : ocrResult.quality.status === 'acceptable' ? '확인 필요' : '재촬영 권장'}</span></div>
                  {ocrResult.quality.warnings.map((warning) => <p key={warning} className="col-span-2 text-amber-700">• {warning}</p>)}
                </div> : null}
              </div>
              <label className="block font-bold text-slate-700">OCR 원문
                <textarea rows={5} value={ocrText} onChange={(event) => { setOcrText(event.target.value); setOcrReviewed(false); }} placeholder="OCR 결과가 표시됩니다. 실패한 경우 직접 입력할 수 있습니다." className="mt-1 w-full p-3 bg-slate-50 border border-slate-200 rounded-xl resize-y font-medium" />
              </label>
              <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3" aria-labelledby="inspection-fields-title">
                <h3 id="inspection-fields-title" className="font-extrabold text-sm text-[#173B57]">점검사항</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="font-bold text-slate-700">지점 *
                    <select required value={branchName} onChange={(event) => { setBranchName(event.target.value); setOcrReviewed(false); applyRegionHint(event.target.value); }} className="mt-1 w-full h-10 px-3 bg-white border border-slate-200 rounded-xl">
                      <option value="">지점 선택</option>{HNS_BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                    </select>
                  </label>
                  <label className="font-bold text-slate-700">요청자
                    <input value={requesterName} onChange={(event) => { setRequesterName(event.target.value); setOcrReviewed(false); }} placeholder="성명 또는 연락처 포함" className="mt-1 w-full h-10 px-3 bg-white border border-slate-200 rounded-xl" />
                  </label>
                  <label className="font-bold text-slate-700">점검작업업체
                    <input readOnly value="유지텔레컴" className="mt-1 w-full h-10 px-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-600" />
                  </label>
                  <label className="font-bold text-slate-700">매체구분
                    <input readOnly value="CABLE" className="mt-1 w-full h-10 px-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-600" />
                  </label>
                </div>
              <label className="block font-bold text-slate-700">고객주소 *
                <input required value={location} onChange={(event) => { setLocation(event.target.value); setOcrReviewed(false); }} placeholder="현장 주소를 확인해 입력하세요." className="mt-1 w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl" />
              </label>
              <label className="block font-bold text-slate-700">이관사유 *
                <input required value={handoverReason} onChange={(event) => { setHandoverReason(event.target.value); setOcrReviewed(false); }} placeholder="예: 신호점검" className="mt-1 w-full h-10 px-3 bg-white border border-slate-200 rounded-xl" />
              </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="font-bold text-slate-700">TAP/RN 위치<input value={tapRnLocation} onChange={(event) => { setTapRnLocation(event.target.value); setOcrReviewed(false); }} className="mt-1 w-full h-10 px-3 bg-white border border-slate-200 rounded-xl" /></label>
                  <label className="font-bold text-slate-700">전주번호<input value={poleNumber} onChange={(event) => { setPoleNumber(event.target.value); setOcrReviewed(false); }} className="mt-1 w-full h-10 px-3 bg-white border border-slate-200 rounded-xl" /></label>
                  <label className="font-bold text-slate-700">인입선길이<input value={leadInLength} onChange={(event) => { setLeadInLength(event.target.value); setOcrReviewed(false); }} placeholder="원문 형식 유지" className="mt-1 w-full h-10 px-3 bg-white border border-slate-200 rounded-xl" /></label>
                </div>
                <label className="block font-bold text-slate-700">사전조치내용
                  <textarea rows={3} value={preActionNotes} onChange={(event) => { setPreActionNotes(event.target.value); setOcrReviewed(false); }} className="mt-1 w-full p-3 bg-white border border-slate-200 rounded-xl resize-y" />
                </label>
                <label className="block font-bold text-slate-700">점검요청내용 *
                  <textarea required rows={4} value={inspectionRequestDetails} onChange={(event) => { setInspectionRequestDetails(event.target.value); setOcrReviewed(false); }} placeholder="현장 매니저가 확인할 점검 요청내용" className="mt-1 w-full p-3 bg-white border border-slate-200 rounded-xl resize-y" />
                </label>
              </section>
              {ocrResult?.status === 'succeeded' ? <label className={`flex items-start gap-2 rounded-xl border p-3 font-bold ${ocrReviewed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                <input type="checkbox" checked={ocrReviewed} onChange={(event) => setOcrReviewed(event.target.checked)} className="mt-0.5 h-4 w-4" />
                OCR 원문과 모든 자동입력 항목을 직접 확인했으며 필요한 부분을 수정했습니다.
              </label> : null}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1"><span className="font-bold text-slate-700">접수 증빙사진 (선택)</span><span className="text-[10px] text-slate-400">기존 방식으로 저장됨 · 최대 5장</span></div>
                <label
                  onDragEnter={(event) => { event.preventDefault(); setEvidenceDragActive(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setEvidenceDragActive(false)}
                  onDrop={handleEvidenceDrop}
                  className={`h-16 border border-dashed rounded-xl flex items-center justify-center gap-2 font-bold cursor-pointer transition ${evidenceDragActive ? 'border-[#2878B5] bg-blue-50 text-[#2878B5]' : 'border-slate-300 text-slate-600'}`}
                ><ImagePlus className="w-4 h-4" />증빙사진 선택 또는 드래그<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void handleEvidencePhotos(event)} className="sr-only" /></label>
                {evidencePhotos.length > 0 ? <div className="mt-2 flex gap-2 overflow-x-auto">{evidencePhotos.map((photo) => <img key={photo.fileName} src={photo.dataUrl} alt={photo.fileName} className="w-20 h-16 object-cover rounded-lg border border-slate-200" />)}</div> : null}
              </div>
              <div className="pt-2 flex gap-2">
                <button type="button" onClick={closeRegistration} className="flex-1 h-11 bg-slate-100 text-slate-700 font-bold rounded-xl">취소</button>
                <button type="submit" disabled={submitting || ocrLoading} className="flex-1 h-11 bg-[#F28C28] text-white font-bold rounded-xl disabled:opacity-50">{submitting ? '등록 중...' : '저장 및 등록'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
