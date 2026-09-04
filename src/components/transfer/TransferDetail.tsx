import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  FileText,
  History,
  ImagePlus,
  Images,
  MapPin,
  Pencil,
  Radio,
  RotateCcw,
  Save,
  Trash2,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { transfersApi } from '../../features/transfers/api';
import { HNS_BRANCHES } from '../../features/transfers/browser-ocr/validation';
import { canProcessTransfer } from '../../shared/auth/permissions';
import type { WorkTransfer } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { TransferPhotoViewer } from './TransferPhotoViewer';

const localDateTime = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

type PendingEditPhoto = { id: string; fileName: string; dataUrl: string };
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

const supportedPhotoMime = (file: File) => {
  const declared = file.type.toLowerCase();
  if (PHOTO_MIME_TYPES.has(declared)) return declared;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return PHOTO_MIME_BY_EXTENSION[extension] || '';
};

const readPhoto = (file: File, mimeType: string) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^;,]*;/i, `data:${mimeType};`));
  reader.onerror = () => reject(new Error('사진 파일을 읽지 못했습니다.'));
  reader.readAsDataURL(file);
});

export const TransferDetail: React.FC = () => {
  const { transfers, selectedTransferId, navigateTo, selectCell, currentUser, showToast, reloadBusinessData } = useApp();
  const initial = transfers.find((item) => item.id === selectedTransferId) || null;
  const [transfer, setTransfer] = useState<WorkTransfer | null>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fieldActionText, setFieldActionText] = useState('');
  const [processedAt, setProcessedAt] = useState(localDateTime);
  const [editing, setEditing] = useState(false);
  const [editBranchName, setEditBranchName] = useState('');
  const [editInspectionDate, setEditInspectionDate] = useState('');
  const [editInspectionCompany, setEditInspectionCompany] = useState('');
  const [editMediaType, setEditMediaType] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editUrgent, setEditUrgent] = useState(false);
  const [editPhotos, setEditPhotos] = useState<PendingEditPhoto[]>([]);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);
  const [failedPhotoIds, setFailedPhotoIds] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<'delete' | 'reopen' | null>(null);
  const [actionReason, setActionReason] = useState('');

  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'public_official' || currentUser?.role === 'team_leader';
  const canProcess = canProcessTransfer(currentUser?.role);
  const canReopen = currentUser?.role === 'admin' || currentUser?.role === 'public_official';
  const canDelete = currentUser?.role === 'admin' || currentUser?.role === 'public_official';
  const evidencePhotos = useMemo(() => transfer?.attachments || [], [transfer?.attachments]);

  const loadDetail = async () => {
    if (!selectedTransferId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const detail = await transfersApi.detail(selectedTransferId);
      const attachments = detail.workflowStatus === 'completed'
        ? []
        : await Promise.all((detail.attachments || []).map(async (photo) => {
          try {
            return { ...photo, url: await transfersApi.attachmentAccessUrl(detail.id, photo.id) };
          } catch {
            return { ...photo, url: '' };
          }
        }));
      setFailedPhotoIds([]);
      setTransfer({ ...detail, attachments });
    } catch (error) {
      setTransfer(null);
      showToast(error instanceof Error ? error.message : '업무이관을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadDetail(); }, [selectedTransferId]);

  useEffect(() => {
    if (!transfer) return;
    setEditBranchName(transfer.branchName || '');
    setEditInspectionDate((transfer.inspectionRequestedDate || transfer.requestDate).slice(0, 10));
    setEditInspectionCompany(transfer.inspectionCompany || '유지텔레컴');
    setEditMediaType(transfer.mediaType || 'CABLE');
    setEditLocation(transfer.location);
    setEditUrgent(Boolean(transfer.isUrgent));
    setEditPhotos([]);
  }, [transfer?.id]);

  const handleEditPhotoSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    event.currentTarget.value = '';
    if (files.length === 0) return;
    const selected = files.map((file) => ({ file, mimeType: supportedPhotoMime(file) }));
    if (selected.some(({ mimeType }) => !mimeType)) {
      showToast('업무이관 사진은 JPG, PNG, WEBP 형식만 등록할 수 있습니다.', 'warning');
      return;
    }
    if (evidencePhotos.length + editPhotos.length + selected.length > 3) {
      showToast('기존 사진을 포함해 업무이관 사진은 최대 3장까지 등록할 수 있습니다.', 'warning');
      return;
    }
    if (selected.some(({ file }) => file.size > 10 * 1024 * 1024)) {
      showToast('업무이관 사진은 한 장당 10MB 이하만 등록할 수 있습니다.', 'warning');
      return;
    }
    try {
      const next = await Promise.all(selected.map(async ({ file, mimeType }, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        fileName: file.name,
        dataUrl: await readPhoto(file, mimeType),
      })));
      setEditPhotos((current) => [...current, ...next]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '사진을 읽지 못했습니다.', 'error');
    }
  };

  const handleFieldAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!transfer || !fieldActionText.trim()) return;
    setBusy(true);
    try {
      await transfersApi.addFieldAction(transfer.id, { actionText: fieldActionText.trim(), processedAt: processedAt.replace('T', ' ') });
      setFieldActionText('');
      showToast('현장처리가 등록되었습니다.', 'success');
      await Promise.all([loadDetail(), reloadBusinessData()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '현장처리 등록에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (!transfer || !window.confirm('현장처리 내용을 확인하고 최종 완료하시겠습니까? 완료하면 CATV에 등록된 업무이관 사진은 복구할 수 없게 완전 삭제됩니다.')) return;
    setBusy(true);
    try {
      setTransfer(await transfersApi.complete(transfer.id));
      showToast('업무이관을 최종 완료했습니다.', 'success');
      await reloadBusinessData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '완료 처리에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async (reason: string) => {
    if (!transfer || !reason.trim()) return;
    setBusy(true);
    try {
      setTransfer(await transfersApi.reopen(transfer.id, reason.trim()));
      setPendingAction(null);
      setActionReason('');
      showToast('완료 건을 현장처리 상태로 재오픈했습니다.', 'success');
      await reloadBusinessData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '재오픈에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!transfer || !editBranchName || !editInspectionDate || !editLocation.trim()
      || !editInspectionCompany.trim() || !editMediaType.trim()) return;
    setBusy(true);
    try {
      await transfersApi.update(transfer.id, {
        branchName: editBranchName,
        inspectionRequestedDate: editInspectionDate, customerAddress: editLocation.trim(),
        inspectionCompany: editInspectionCompany.trim(), mediaType: editMediaType.trim(),
        isUrgent: editUrgent,
      });
      for (const photo of editPhotos) {
        await transfersApi.addAttachment(transfer.id, {
          attachmentType: 'request_photo', fileName: photo.fileName, dataUrl: photo.dataUrl,
        });
      }
      setEditPhotos([]);
      setEditing(false);
      showToast(editPhotos.length > 0 ? '업무이관 정보와 추가 사진을 저장했습니다.' : '업무이관 정보를 수정했습니다.', 'success');
      await Promise.all([loadDetail(), reloadBusinessData()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '수정에 실패했습니다.', 'error');
      await loadDetail();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (reason: string) => {
    if (!transfer || !canDelete || !reason.trim()) return;
    setBusy(true);
    try {
      await transfersApi.remove(transfer.id, reason.trim());
      setPendingAction(null);
      setActionReason('');
      showToast('업무이관을 삭제했습니다. CATV에 저장된 첨부사진도 완전 삭제되었습니다.', 'success');
      await reloadBusinessData();
      navigateTo('transfer_list');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '삭제에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !transfer) return <div className="p-10 text-center bg-white rounded-2xl border border-slate-200 text-sm text-slate-500">업무이관 상세를 불러오는 중입니다.</div>;
  if (!transfer) return (
    <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
      <div className="text-sm font-bold text-slate-700">선택된 업무이관 건을 찾을 수 없거나 접근 권한이 없습니다.</div>
      <button type="button" onClick={() => navigateTo('transfer_list')} className="mt-3 px-4 py-2 bg-[#2878B5] text-white text-xs font-bold rounded-xl">목록으로 이동</button>
    </div>
  );

  return (
    <div id="transfer-detail-view" className="space-y-4 pb-24 sm:pb-8 text-[#1F2937]">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => navigateTo('transfer_list')} className="inline-flex items-center gap-1 text-xs font-bold text-[#173B57] bg-white px-3.5 py-2 rounded-xl border border-[#E5E7EB]"><ArrowLeft className="w-4 h-4" />업무이관 목록</button>
        {transfer.cellName ? <button type="button" onClick={() => selectCell(transfer.cellName)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-[#2878B5] text-xs font-bold rounded-xl border border-blue-200"><Radio className="w-3.5 h-3.5" />관련 CELL</button> : null}
      </div>

      <section className={`bg-white rounded-2xl p-4 sm:p-5 border shadow-sm ${transfer.isUrgent ? 'border-red-300' : 'border-[#E5E7EB]'}`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-[#173B57]">{transfer.branchName || transfer.serviceNo}</h1>
              <StatusBadge status={transfer.status} size="md" />
              {transfer.isUrgent ? <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700"><AlertTriangle className="w-4 h-4" />긴급</span> : null}
            </div>
            <p className="text-xs text-slate-500 mt-1">{transfer.regionName} · {transfer.inspectionRequestedDate || transfer.requestDate}</p>
          </div>
          {canManage && transfer.workflowStatus !== 'completed' ? <button type="button" onClick={() => { setEditPhotos([]); setEditing((value) => !value); }} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"><Pencil className="w-3.5 h-3.5" />등록정보·사진 수정</button> : null}
        </div>
      </section>

      {editing ? (
        <section className="bg-white rounded-2xl p-4 sm:p-5 border border-blue-200 shadow-sm space-y-3">
          <h2 className="text-sm font-extrabold text-[#173B57]">등록정보 수정</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block text-xs font-bold text-slate-700">지점 *<select required value={editBranchName} onChange={(event) => setEditBranchName(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50"><option value="">지점 선택</option>{editBranchName && !(HNS_BRANCHES as readonly string[]).includes(editBranchName) ? <option value={editBranchName}>{editBranchName} (기존)</option> : null}{HNS_BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select></label>
            <label className="block text-xs font-bold text-slate-700">점검요청일 *<input type="date" required value={editInspectionDate} onChange={(event) => setEditInspectionDate(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
            <label className="block text-xs font-bold text-slate-700">점검작업업체 *<input required value={editInspectionCompany} onChange={(event) => setEditInspectionCompany(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
            <label className="block text-xs font-bold text-slate-700">매체구분 *<input required value={editMediaType} onChange={(event) => setEditMediaType(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          </div>
          <label className="block text-xs font-bold text-slate-700">고객주소 *<input required value={editLocation} onChange={(event) => setEditLocation(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-700">추가 업무이관 사진 ({evidencePhotos.length + editPhotos.length}/3)</span><span className="text-[10px] text-slate-400">장당 10MB</span></div>
            {evidencePhotos.length + editPhotos.length < 3 ? <label className="mt-2 flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-white text-xs font-bold text-[#2878B5]"><ImagePlus className="h-4 w-4" />갤러리에서 선택<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void handleEditPhotoSelection(event)} className="sr-only" /></label> : <p className="mt-2 text-[11px] font-bold text-amber-700">사진 3장이 모두 등록되어 추가할 수 없습니다.</p>}
            {editPhotos.length > 0 ? <div className="mt-2 grid grid-cols-3 gap-2">{editPhotos.map((photo, index) => <div key={photo.id} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white"><img src={photo.dataUrl} alt={photo.fileName} className="aspect-square w-full object-cover" /><button type="button" aria-label={`추가 사진 ${index + 1} 삭제`} onClick={() => setEditPhotos((current) => current.filter((item) => item.id !== photo.id))} className="absolute right-1 top-1 rounded-md bg-red-600 p-1 text-white"><Trash2 className="h-3 w-3" /></button><p className="truncate px-1.5 py-1 text-[9px] text-slate-500">{photo.fileName}</p></div>)}</div> : null}
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-red-700"><input type="checkbox" checked={editUrgent} onChange={(event) => setEditUrgent(event.target.checked)} />긴급 건</label>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => { setEditPhotos([]); setEditing(false); }} className="px-4 h-10 rounded-xl bg-slate-100 text-xs font-bold">취소</button><button type="button" disabled={busy} onClick={() => void handleSaveEdit()} className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-[#2878B5] text-white text-xs font-bold"><Save className="w-4 h-4" />저장</button></div>
        </section>
      ) : null}

      <section className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm">
        <h2 className="text-sm font-extrabold text-[#173B57] mb-3 flex items-center gap-1.5"><FileText className="w-4 h-4 text-[#2878B5]" />등록정보</h2>
        <dl className="grid grid-cols-[82px_1fr] gap-x-3 gap-y-3 text-xs">
          <dt className="font-bold text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" />점검요청일</dt><dd className="font-semibold">{transfer.inspectionRequestedDate || transfer.requestDate}</dd>
          <dt className="font-bold text-slate-500">지역</dt><dd className="font-extrabold text-[#173B57]">{transfer.regionName || '-'}</dd>
          <dt className="font-bold text-slate-500">지점</dt><dd className="font-extrabold text-[#173B57]">{transfer.branchName || '-'}</dd>
          <dt className="font-bold text-slate-500">점검업체/매체</dt><dd className="font-medium">{transfer.inspectionCompany || '유지텔레컴'} / {transfer.mediaType || 'CABLE'}</dd>
          <dt className="font-bold text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />주소</dt><dd className="font-medium">{transfer.location}</dd>
          <dt className="font-bold text-slate-500 flex items-center gap-1"><User className="w-3 h-3" />작업처리자</dt><dd className="font-semibold">{transfer.fieldProcessedByName || '미지정'}</dd>
        </dl>
      </section>

      <section className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold text-[#173B57] flex items-center gap-1.5"><Images className="w-4 h-4 text-[#2878B5]" />업무이관 사진</h2>
          <span className="text-[11px] font-bold text-slate-500">{transfer.workflowStatus === 'completed' ? '삭제 완료' : `${evidencePhotos.length}/3장`}</span>
        </div>
        {transfer.workflowStatus === 'completed' ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-800">업무 완료 처리로 첨부사진이 자동 삭제되었습니다.</div>
        ) : loading ? (
          <div className="rounded-xl bg-slate-50 p-4 text-xs font-bold text-slate-500">첨부사진 보기 권한을 확인하고 있습니다.</div>
        ) : evidencePhotos.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{evidencePhotos.map((photo, index) => {
            const failed = !photo.url || failedPhotoIds.includes(photo.id);
            return failed ? <div key={photo.id} className="flex aspect-video flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 p-2 text-center text-[10px] font-bold text-red-700">
              <span>사진을 불러오지 못했습니다.</span>
              <button type="button" onClick={() => void loadDetail()} className="mt-1 rounded-lg bg-white px-2 py-1 text-[#2878B5] shadow-sm">다시 불러오기</button>
            </div> : <button key={photo.id} type="button" onClick={() => setPhotoViewerIndex(index)} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
              <img src={photo.url} alt={photo.fileName} onError={() => setFailedPhotoIds((current) => current.includes(photo.id) ? current : [...current, photo.id])} className="w-full aspect-video object-cover transition group-hover:scale-105" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-1.5 text-left text-[10px] font-bold text-white">{index + 1}. {photo.fileName}</span>
            </button>;
          })}</div>
        ) : <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">등록된 업무이관 사진이 없습니다.</p>}
        {transfer.workflowStatus !== 'completed' ? <p className="text-[10px] text-amber-700">완료 처리 시 CATV에 저장된 사진과 첨부 DB 정보가 완전 삭제됩니다.</p> : null}
      </section>

      <section className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3">
        <h2 className="text-sm font-extrabold text-[#173B57] flex items-center gap-1.5"><Wrench className="w-4 h-4 text-[#F28C28]" />현장처리 정보</h2>
        {transfer.fieldActions?.length ? <div className="space-y-2">{transfer.fieldActions.map((action) => <div key={action.id} className="p-3 rounded-xl bg-blue-50/60 border border-blue-100 text-xs"><div className="flex items-center justify-between gap-2 mb-1"><strong className="flex items-center gap-1"><User className="w-3 h-3" />{action.processedByName}</strong><span className="text-slate-500">{action.processedAt}</span></div><p className="whitespace-pre-wrap">{action.actionText}</p></div>)}</div> : <p className="text-xs text-slate-400">등록된 현장처리가 없습니다.</p>}
        {canProcess && transfer.workflowStatus !== 'completed' ? (
          <form onSubmit={handleFieldAction} className="pt-3 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2"><label className="text-xs font-bold text-slate-700">처리일시<input type="datetime-local" value={processedAt} onChange={(event) => setProcessedAt(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label><label className="text-xs font-bold text-slate-700">현장 처리내용 *<textarea required rows={3} value={fieldActionText} onChange={(event) => setFieldActionText(event.target.value)} className="mt-1 w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label></div>
            <div className="flex justify-end"><button type="submit" disabled={busy || !fieldActionText.trim()} className="px-5 h-10 bg-[#2878B5] text-white rounded-xl text-xs font-bold disabled:opacity-50">현장처리 등록</button></div>
          </form>
        ) : null}
      </section>

      <section className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3">
        <h2 className="text-sm font-extrabold text-[#173B57] flex items-center gap-1.5"><History className="w-4 h-4 text-[#2878B5]" />전체 처리 이력 ({transfer.logs?.length || 0}건)</h2>
        <div className="space-y-2">{transfer.logs?.map((log, index) => <div key={`${log.timestamp}-${index}`} className="p-3 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB] text-xs"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><StatusBadge status={log.toStatus} size="sm" /><strong>{log.author}</strong></div><span className="text-[11px] text-slate-400">{log.timestamp}</span></div><p className="mt-1 text-slate-600 whitespace-pre-wrap">{log.comment}</p></div>)}</div>
      </section>

      {canManage || canReopen ? (
        <div className="sticky bottom-20 sm:bottom-4 z-20 bg-white/95 backdrop-blur-md p-3.5 rounded-2xl border border-[#E5E7EB] shadow-xl flex items-center justify-between gap-2">
          <div className="text-xs"><span className="text-slate-500">현재 상태:</span> <strong className="text-[#173B57]">{transfer.status}</strong></div>
          {canDelete ? <button type="button" disabled={busy} onClick={() => { setActionReason(''); setPendingAction('delete'); }} className="inline-flex items-center gap-1.5 px-4 h-10 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-bold"><Trash2 className="w-4 h-4" />삭제</button> : null}
          {canManage && transfer.workflowStatus === 'field_processed' ? <button type="button" disabled={busy} onClick={() => void handleComplete()} className="inline-flex items-center gap-1.5 px-4 h-10 bg-emerald-600 text-white rounded-xl text-xs font-bold"><CheckCircle2 className="w-4 h-4" />최종 완료</button> : null}
          {canReopen && transfer.workflowStatus === 'completed' ? <button type="button" disabled={busy} onClick={() => { setActionReason(''); setPendingAction('reopen'); }} className="inline-flex items-center gap-1.5 px-4 h-10 bg-amber-500 text-white rounded-xl text-xs font-bold"><RotateCcw className="w-4 h-4" />재오픈</button> : null}
        </div>
      ) : null}

      {pendingAction ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="transfer-action-title">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (pendingAction === 'delete') void handleDelete(actionReason);
              else void handleReopen(actionReason);
            }}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 id="transfer-action-title" className="font-extrabold text-[#173B57]">업무이관 {pendingAction === 'delete' ? '삭제' : '재오픈'}</h2>
                <p className="mt-1 text-xs text-slate-500">{transfer.branchName || '지점 미확인'} · {transfer.location} · {transfer.inspectionRequestedDate || transfer.requestDate}</p>
              </div>
              <button type="button" aria-label="사유 입력창 닫기" onClick={() => setPendingAction(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <label className="mt-4 block text-xs font-bold text-slate-700">{pendingAction === 'delete' ? '삭제' : '재오픈'} 사유 *
              <textarea autoFocus required maxLength={1000} rows={4} value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="처리 사유를 입력해 주세요." className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-[#2878B5] focus:bg-white" />
            </label>
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setPendingAction(null)} className="h-11 flex-1 rounded-xl bg-slate-100 text-xs font-bold text-slate-700">취소</button>
              <button type="submit" disabled={busy || !actionReason.trim()} className={`h-11 flex-1 rounded-xl text-xs font-bold text-white disabled:opacity-50 ${pendingAction === 'delete' ? 'bg-red-600' : 'bg-amber-500'}`}>{busy ? '처리 중...' : pendingAction === 'delete' ? '삭제 실행' : '재오픈 실행'}</button>
            </div>
          </form>
        </div>
      ) : null}
      {photoViewerIndex !== null ? <TransferPhotoViewer
        photos={evidencePhotos.map((photo) => ({ id: photo.id, url: photo.url, fileName: photo.fileName }))}
        initialIndex={photoViewerIndex}
        onClose={() => setPhotoViewerIndex(null)}
      /> : null}
    </div>
  );
};
