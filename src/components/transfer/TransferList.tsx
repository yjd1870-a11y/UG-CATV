import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  Images,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  ChartNoAxesCombined,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { transfersApi, type TransferFilters, type TransferMeta, type TransferSummary } from '../../features/transfers/api';
import { recognizeWorkTransferPhotoInBrowser, type BrowserOcrResult } from '../../features/transfers/browser-ocr/engine';
import { HNS_BRANCHES, HNS_BRANCH_REGION_HINTS } from '../../features/transfers/browser-ocr/validation';
import { koreaDate, resolveInspectionRequestedDate } from '../../features/transfers/registration-policy';
import type { TransferWorkflowStatus, WorkTransfer } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { TransferPhotoViewer } from './TransferPhotoViewer';

type PendingPhoto = { id: string; fileName: string; dataUrl: string; sourceKey: string };
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
const FIXED_INSPECTION_COMPANY = '유지텔레컴';
const INTERNAL_MEDIA_TYPE = 'CABLE';
const emptySummary: TransferSummary = { registered: 0, field_processed: 0, completed: 0 };
const statusTabs: Array<{ value: TransferWorkflowStatus; label: string }> = [
  { value: 'registered', label: '미완료' },
  { value: 'field_processed', label: '현장처리' },
  { value: 'completed', label: '완료' },
];

const supportedPhotoMime = (file: File) => {
  const declared = file.type.toLowerCase();
  if (PHOTO_MIME_TYPES.has(declared)) return declared;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return PHOTO_MIME_BY_EXTENSION[extension] || '';
};

const photoSourceKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const readFile = (file: File, mimeType: string) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || '');
    resolve(dataUrl.replace(/^data:[^;,]*;/i, `data:${mimeType};`));
  };
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

  const [inspectionRequestedDate, setInspectionRequestedDate] = useState(koreaDate);
  const [newRegionId, setNewRegionId] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [location, setLocation] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState<PendingPhoto[]>([]);
  const [evidenceViewerIndex, setEvidenceViewerIndex] = useState<number | null>(null);
  const [ocrSource, setOcrSource] = useState<{ fileName: string; previewUrl: string } | null>(null);
  const [ocrResult, setOcrResult] = useState<BrowserOcrResult | null>(null);
  const [ocrDragActive, setOcrDragActive] = useState(false);
  const [evidenceDragActive, setEvidenceDragActive] = useState(false);
  const ocrRequestId = useRef(0);
  const ocrAbortController = useRef<AbortController | null>(null);
  const ocrPreviewUrl = useRef('');
  const inspectionDateEdited = useRef(false);

  const isManagerView = currentUser?.role === 'manager' || currentUser?.role === 'guest';
  const canRegister = currentUser?.role === 'admin' || currentUser?.role === 'public_official' || currentUser?.role === 'team_leader';
  const canComplete = canRegister;
  const visibleTabs = useMemo(() => isManagerView ? statusTabs.filter((tab) => tab.value !== 'completed') : statusTabs, [isManagerView]);

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
        if (currentUser?.role === 'team_leader' || currentUser?.role === 'manager' || currentUser?.role === 'guest') {
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
    inspectionDateEdited.current = false;
    setInspectionRequestedDate(koreaDate());
    setNewRegionId((currentUser?.role === 'team_leader' ? meta?.currentRegionId : '') || '');
    setIsUrgent(false);
    setBranchName('');
    setLocation('');
    setEvidencePhotos([]);
    setEvidenceViewerIndex(null);
    setOcrSource(null);
    setOcrResult(null);
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
    const mimeType = supportedPhotoMime(file);
    if (!mimeType) {
      showToast('OCR 사진은 JPG, PNG, WEBP 형식만 사용할 수 있습니다.', 'warning');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('OCR 사진은 업무이관 사진으로 함께 등록되므로 10MB 이하만 사용할 수 있습니다.', 'warning');
      return;
    }
    const normalizedFile = file.type === mimeType ? file : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
    const attached = await processEvidencePhotos([normalizedFile], true);
    if (!attached) return;
    ocrAbortController.current?.abort();
    const controller = new AbortController();
    ocrAbortController.current = controller;
    const requestId = ++ocrRequestId.current;
    if (ocrPreviewUrl.current) URL.revokeObjectURL(ocrPreviewUrl.current);
    const previewUrl = URL.createObjectURL(file);
    ocrPreviewUrl.current = previewUrl;
    setOcrSource({ fileName: file.name, previewUrl });
    setOcrResult(null);
    setOcrLoading(true);
    setOcrStatus('pending');
    setOcrMessage('사진 품질을 확인하고 있습니다.');
    try {
      const result = await recognizeWorkTransferPhotoInBrowser(normalizedFile, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (requestId === ocrRequestId.current) setOcrMessage(progress.message);
        },
      });
      if (requestId !== ocrRequestId.current) return;
      setOcrResult(result);
      setOcrStatus(result.status);
      if (result.status === 'succeeded') {
        const recognizedBranch = result.fields.branchName.value;
        setBranchName(recognizedBranch);
        setLocation(result.fields.customerAddress.value);
        const regionMapped = applyRegionHint(recognizedBranch);
        const branchDecisionMessage = result.fields.branchName.warnings.find((warning) => warning.includes('고객주소'));
        setOcrMessage(branchDecisionMessage || (!recognizedBranch
          ? 'OCR은 완료됐지만 지점명을 확정하지 못했습니다. 지점과 지역을 직접 선택해 주세요.'
          : !regionMapped && currentUser?.role !== 'team_leader'
            ? 'OCR은 완료됐습니다. 지점은 확인했지만 지역은 자동 확정하지 않았으니 직접 확인해 주세요.'
            : result.requiresReview
              ? 'OCR 변환이 완료되었습니다. 지점과 고객주소를 확인해 주세요.'
              : 'OCR 변환이 완료되었습니다. 저장 전 지점과 고객주소를 확인해 주세요.'));
      } else {
        setOcrMessage(result.errorMessage || 'OCR 변환에 실패했습니다. 다른 갤러리 사진을 선택하거나 직접 입력해 주세요.');
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
    const files: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.currentTarget.value = '';
    await processOcrPhoto(files[0]);
  };

  const handleOcrDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOcrDragActive(false);
    void processOcrPhoto(event.dataTransfer.files?.[0]);
  };

  const processEvidencePhotos = async (fileList: FileList | File[], allowExisting = false) => {
    const selected = Array.from(fileList);
    const selectedWithMime = selected.map((file) => ({ file, mimeType: supportedPhotoMime(file) }));
    if (selectedWithMime.some(({ mimeType }) => !mimeType)) {
      showToast('업무이관 사진은 JPG, PNG, WEBP 형식만 등록할 수 있습니다.', 'warning');
      return false;
    }
    const existingKeys = new Set(evidencePhotos.map((photo) => photo.sourceKey));
    const uniqueSelected = selectedWithMime.filter(({ file }) => !existingKeys.has(photoSourceKey(file)));
    if (uniqueSelected.length === 0 && allowExisting) return true;
    const remaining = 3 - evidencePhotos.length;
    if (remaining <= 0 || uniqueSelected.length > remaining) {
      showToast('업무이관 사진은 최대 3장까지 등록할 수 있습니다.', 'warning');
      return false;
    }
    if (uniqueSelected.length === 0) {
      showToast('이미 선택된 사진입니다.', 'info');
      return false;
    }
    if (uniqueSelected.some(({ file }) => file.size > 10 * 1024 * 1024)) {
      showToast('업무이관 사진은 한 장당 10MB 이하만 등록할 수 있습니다.', 'warning');
      return false;
    }
    try {
      const nextPhotos = await Promise.all(uniqueSelected.map(async ({ file, mimeType }, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        fileName: file.name,
        dataUrl: await readFile(file, mimeType),
        sourceKey: photoSourceKey(file),
      })));
      setEvidencePhotos((current) => [...current, ...nextPhotos]);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '증빙사진을 읽지 못했습니다.', 'error');
      return false;
    }
  };

  const handleEvidencePhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // FileList is live and becomes empty as soon as the input value is reset.
    // Copy it first so mobile gallery selections survive the reset.
    const files: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.currentTarget.value = '';
    if (files.length > 0) await processEvidencePhotos(files);
  };

  const handleEvidenceDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setEvidenceDragActive(false);
    void processEvidencePhotos(event.dataTransfer.files);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const submittedInspectionDate = resolveInspectionRequestedDate(inspectionRequestedDate, inspectionDateEdited.current);
    if (!newRegionId || !branchName || !submittedInspectionDate || !location.trim()) {
      showToast('요청일, 지역, 지점, 고객주소는 필수입니다.', 'warning');
      return;
    }
    if (evidencePhotos.length < 1 || evidencePhotos.length > 3) {
      showToast('상세내용 확인을 위한 업무이관 사진을 1~3장 등록해 주세요.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await transfersApi.create({
        inspectionRequestedDate: submittedInspectionDate,
        regionId: newRegionId,
        isUrgent,
        branchName,
        inspectionCompany: FIXED_INSPECTION_COMPANY,
        mediaType: INTERNAL_MEDIA_TYPE,
        customerAddress: location.trim(),
        ocrStatus,
        ocrEngine: ocrResult?.engine || 'manual',
        requestPhotos: evidencePhotos.map(({ fileName, dataUrl }) => ({ fileName, dataUrl })),
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
    if (!window.confirm(`${transfer.regionName} 업무를 최종 완료하시겠습니까? 완료하면 CATV에 등록된 업무이관 사진은 복구할 수 없게 완전 삭제됩니다.`)) return;
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
        <div className={`grid gap-2 ${isManagerView ? 'grid-cols-2' : 'grid-cols-3'}`}>
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
          {isManagerView ? (
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지역, 지점, 점검업체, 매체, 주소, 현장처리자 검색" className="w-full h-11 pl-10 pr-10 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl text-xs outline-none focus:bg-white focus:border-[#2878B5]" />
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
              <dt className="font-bold text-slate-500 flex items-center gap-1"><Images className="w-3 h-3" />사진</dt><dd className="font-medium text-slate-800">{item.workflowStatus === 'completed' ? '완료 시 삭제됨' : `${item.evidencePhotoCount || 0}장`}</dd>
              <dt className="font-bold text-slate-500">처리내용</dt><dd className="font-medium text-slate-800 whitespace-pre-wrap line-clamp-3">{item.workflowStatus === 'registered' ? '현장처리 대기' : item.fieldActionSummary || '-'}</dd>
              <dt className="font-bold text-slate-500">작업처리자</dt><dd className="font-semibold text-slate-800">{item.fieldProcessedByName || '미지정'}</dd>
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
                  <input type="date" required value={inspectionRequestedDate} onChange={(event) => { inspectionDateEdited.current = true; setInspectionRequestedDate(event.target.value); }} className="mt-1 w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl" />
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
                  <span className="font-bold text-slate-700">OCR용 점검사진</span><span className="text-[10px] text-emerald-700">OCR 분석은 브라우저에서만 처리</span>
                </div>
                <label className="h-12 rounded-xl bg-[#2878B5] text-white flex items-center justify-center gap-2 font-bold cursor-pointer">
                  <Images className="w-4 h-4" />OCR 사진 갤러리에서 선택
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void handleOcrPhoto(event)} className="sr-only" />
                </label>
                <div
                  onDragEnter={(event) => { event.preventDefault(); setOcrDragActive(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setOcrDragActive(false)}
                  onDrop={handleOcrDrop}
                  className={`mt-2 h-10 border border-dashed rounded-xl hidden sm:flex items-center justify-center gap-2 font-bold transition ${ocrDragActive ? 'border-[#2878B5] bg-blue-100 text-[#173B57]' : 'border-blue-200 text-[#2878B5]'}`}
                ><ImagePlus className="w-4 h-4" />PC에서는 OCR 사진을 여기에 끌어놓을 수도 있습니다.</div>
                {ocrSource ? <div className="mt-2 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2"><img src={ocrSource.previewUrl} alt={ocrSource.fileName} className="w-20 h-16 object-cover rounded-lg border border-emerald-200" /><div className="min-w-0"><p className="truncate font-bold text-slate-700">{ocrSource.fileName}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />OCR은 브라우저에서 처리되며, 같은 사진은 업무이관 사진에도 자동 추가됩니다.</p></div></div> : null}
                {ocrMessage ? <div className={`mt-2 p-2.5 rounded-lg flex items-center gap-2 ${ocrLoading ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'}`}><Sparkles className="w-4 h-4 shrink-0" />{ocrMessage}</div> : null}
              </div>
              <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3" aria-labelledby="inspection-fields-title">
                <h3 id="inspection-fields-title" className="font-extrabold text-sm text-[#173B57]">누적 관리 항목</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="font-bold text-slate-700">지점 *
                    <select required value={branchName} onChange={(event) => { setBranchName(event.target.value); applyRegionHint(event.target.value); }} className="mt-1 w-full h-10 px-3 bg-white border border-slate-200 rounded-xl">
                      <option value="">지점 선택</option>{HNS_BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                    </select>
                  </label>
                  <label className="font-bold text-slate-700">점검작업업체 *
                    <input readOnly value={FIXED_INSPECTION_COMPANY} aria-readonly="true" className="mt-1 w-full h-10 px-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-700" />
                  </label>
                </div>
                <label className="block font-bold text-slate-700">고객주소 *
                  <input required value={location} onChange={(event) => setLocation(event.target.value)} placeholder="현장 주소를 확인해 입력하세요." className="mt-1 w-full h-10 px-3 bg-white border border-slate-200 rounded-xl" />
                </label>
              </section>
              <div>
                <div className="flex items-center justify-between gap-2 mb-2"><span className="font-bold text-slate-700">업무이관 사진 * ({evidencePhotos.length}/3)</span><span className="text-[10px] text-slate-400">JPG/PNG/WEBP · 장당 10MB</span></div>
                <label className="h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center gap-2 font-bold cursor-pointer">
                  <Images className="w-4 h-4" />갤러리에서 선택
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void handleEvidencePhotos(event)} className="sr-only" />
                </label>
                <div
                  onDragEnter={(event) => { event.preventDefault(); setEvidenceDragActive(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setEvidenceDragActive(false)}
                  onDrop={handleEvidenceDrop}
                  className={`mt-2 h-10 border border-dashed rounded-xl hidden sm:flex items-center justify-center gap-2 font-bold transition ${evidenceDragActive ? 'border-[#2878B5] bg-blue-50 text-[#2878B5]' : 'border-slate-300 text-slate-500'}`}
                ><ImagePlus className="w-4 h-4" />PC에서는 사진을 여기에 끌어놓을 수도 있습니다.</div>
                {evidencePhotos.length > 0 ? <div className="mt-3 grid grid-cols-3 gap-2">{evidencePhotos.map((photo, index) => <div key={photo.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <button type="button" onClick={() => setEvidenceViewerIndex(index)} className="block w-full"><img src={photo.dataUrl} alt={photo.fileName} className="w-full aspect-square object-cover" /><span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white">{index + 1}</span></button>
                  <button type="button" aria-label={`${index + 1}번 사진 삭제`} onClick={() => setEvidencePhotos((current) => current.filter((item) => item.id !== photo.id))} className="absolute right-1.5 top-1.5 rounded-md bg-red-600 p-1 text-white"><Trash2 className="h-3.5 w-3.5" /></button>
                  <p className="truncate px-2 py-1.5 text-[10px] text-slate-500">{photo.fileName}</p>
                </div>)}</div> : <p className="mt-2 text-[11px] text-amber-700">사진에 이관사유와 상세 요청내용이 보이도록 1~3장을 등록해 주세요.</p>}
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] font-medium text-amber-800">업무이관 완료 시 CATV에 업로드된 첨부사진은 자동으로 완전 삭제됩니다. 휴대폰 갤러리 원본은 삭제되지 않습니다.</p>
              </div>
              <div className="pt-2 flex gap-2">
                <button type="button" onClick={closeRegistration} className="flex-1 h-11 bg-slate-100 text-slate-700 font-bold rounded-xl">취소</button>
                <button type="submit" disabled={submitting || ocrLoading} className="flex-1 h-11 bg-[#F28C28] text-white font-bold rounded-xl disabled:opacity-50">{submitting ? '등록 중...' : '저장 및 등록'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {evidenceViewerIndex !== null ? <TransferPhotoViewer
        photos={evidencePhotos.map((photo) => ({ id: photo.id, url: photo.dataUrl, fileName: photo.fileName }))}
        initialIndex={evidenceViewerIndex}
        onClose={() => setEvidenceViewerIndex(null)}
      /> : null}
    </div>
  );
};
