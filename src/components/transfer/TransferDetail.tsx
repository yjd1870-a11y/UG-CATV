import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  FileText,
  History,
  ImagePlus,
  MapPin,
  Pencil,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { transfersApi } from '../../features/transfers/api';
import { recognizeWorkTransferPhotoInBrowser } from '../../features/transfers/browser-ocr/engine';
import { HNS_BRANCHES } from '../../features/transfers/browser-ocr/validation';
import { apiResourceUrl } from '../../shared/api/client';
import type { WorkTransfer } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

type PendingPhoto = { fileName: string; dataUrl: string };

const localDateTime = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
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
  const [fieldPhotos, setFieldPhotos] = useState<PendingPhoto[]>([]);
  const [editing, setEditing] = useState(false);
  const [editBranchName, setEditBranchName] = useState('');
  const [editRequesterName, setEditRequesterName] = useState('');
  const [editInspectionDate, setEditInspectionDate] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editHandoverReason, setEditHandoverReason] = useState('');
  const [editTapRnLocation, setEditTapRnLocation] = useState('');
  const [editPoleNumber, setEditPoleNumber] = useState('');
  const [editLeadInLength, setEditLeadInLength] = useState('');
  const [editPreActionNotes, setEditPreActionNotes] = useState('');
  const [editDetails, setEditDetails] = useState('');
  const [editOcrText, setEditOcrText] = useState('');
  const [editUrgent, setEditUrgent] = useState(false);
  const [pendingAction, setPendingAction] = useState<'delete' | 'reopen' | null>(null);
  const [actionReason, setActionReason] = useState('');
  const ocrAbortController = useRef<AbortController | null>(null);

  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'public_official' || currentUser?.role === 'team_leader';
  const canReopen = currentUser?.role === 'admin' || currentUser?.role === 'public_official';
  const canDelete = currentUser?.role === 'admin' || currentUser?.role === 'public_official';
  const requestPhotos = useMemo(() => transfer?.attachments?.filter((item) => item.attachmentType === 'request_photo') || [], [transfer?.attachments]);
  const actionPhotos = useMemo(() => transfer?.attachments?.filter((item) => item.attachmentType === 'field_photo') || [], [transfer?.attachments]);

  const loadDetail = async () => {
    if (!selectedTransferId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const detail = await transfersApi.detail(selectedTransferId);
      setTransfer(detail);
    } catch (error) {
      setTransfer(null);
      showToast(error instanceof Error ? error.message : '업무이관을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadDetail(); }, [selectedTransferId]);

  useEffect(() => () => ocrAbortController.current?.abort(), []);

  useEffect(() => {
    if (!transfer) return;
    setEditBranchName(transfer.branchName || '');
    setEditRequesterName(transfer.requesterName || '');
    setEditInspectionDate((transfer.inspectionRequestedDate || transfer.requestDate).slice(0, 10));
    setEditLocation(transfer.location);
    setEditHandoverReason(transfer.handoverReason || transfer.transferReason || '');
    setEditTapRnLocation(transfer.tapRnLocation || '');
    setEditPoleNumber(transfer.poleNumber || '');
    setEditLeadInLength(transfer.leadInLength || '');
    setEditPreActionNotes(transfer.preActionNotes || '');
    setEditDetails(transfer.requestDetails);
    setEditOcrText(transfer.ocrText || '');
    setEditUrgent(Boolean(transfer.isUrgent));
  }, [transfer?.id]);

  const handleFieldPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []).slice(0, 5) as File[];
    event.target.value = '';
    try {
      setFieldPhotos(await Promise.all(files.map(async (file) => ({ fileName: file.name, dataUrl: await readFile(file) }))));
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
      await Promise.all(fieldPhotos.map((photo) => transfersApi.addAttachment(transfer.id, {
        attachmentType: 'field_photo', fileName: photo.fileName, dataUrl: photo.dataUrl,
      })));
      setFieldActionText('');
      setFieldPhotos([]);
      showToast('현장처리가 등록되었습니다.', 'success');
      await Promise.all([loadDetail(), reloadBusinessData()]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '현장처리 등록에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (!transfer || !window.confirm('현장처리 내용을 확인하고 최종 완료하시겠습니까?')) return;
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
      || !editHandoverReason.trim() || !editDetails.trim()) return;
    setBusy(true);
    try {
      const updated = await transfersApi.update(transfer.id, {
        branchName: editBranchName, requesterName: editRequesterName.trim(),
        inspectionRequestedDate: editInspectionDate, customerAddress: editLocation.trim(),
        handoverReason: editHandoverReason.trim(), tapRnLocation: editTapRnLocation.trim(),
        poleNumber: editPoleNumber.trim(), leadInLength: editLeadInLength.trim(),
        preActionNotes: editPreActionNotes.trim(), inspectionRequestDetails: editDetails.trim(),
        ocrText: editOcrText.trim(), isUrgent: editUrgent,
      });
      setTransfer(updated);
      setEditing(false);
      showToast('업무이관 정보를 수정했습니다.', 'success');
      await reloadBusinessData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '수정에 실패했습니다.', 'error');
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
      showToast('업무이관을 삭제했습니다. 처리 이력과 첨부 참조는 보존됩니다.', 'success');
      await reloadBusinessData();
      navigateTo('transfer_list');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '삭제에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRetryOcr = async (photo: { url: string; fileName: string }) => {
    if (!transfer) return;
    ocrAbortController.current?.abort();
    const controller = new AbortController();
    ocrAbortController.current = controller;
    setBusy(true);
    try {
      const response = await fetch(apiResourceUrl(photo.url), { credentials: 'include', signal: controller.signal });
      if (!response.ok) throw new Error('저장된 증빙사진을 불러오지 못했습니다.');
      const blob = await response.blob();
      const result = await recognizeWorkTransferPhotoInBrowser(
        new File([blob], photo.fileName, { type: blob.type || 'image/jpeg' }),
        { signal: controller.signal },
      );
      if (result.status === 'succeeded') {
        setEditOcrText(result.text);
        setEditBranchName((current) => result.fields.branchName.value || current);
        setEditRequesterName((current) => result.fields.requesterName.value || current);
        if (result.fields.inspectionRequestedDate.validationStatus === 'valid') setEditInspectionDate(result.fields.inspectionRequestedDate.value);
        setEditLocation((current) => result.fields.customerAddress.value || current);
        setEditHandoverReason((current) => result.fields.handoverReason.value || current);
        setEditTapRnLocation((current) => result.fields.tapRnLocation.value || current);
        setEditPoleNumber((current) => result.fields.poleNumber.value || current);
        setEditLeadInLength((current) => result.fields.leadInLength.value || current);
        setEditPreActionNotes((current) => result.fields.preActionNotes.value || current);
        setEditDetails((current) => result.fields.inspectionRequestDetails.value || current);
        setEditing(true);
        showToast('브라우저 OCR이 완료되었습니다. 결과를 확인한 뒤 저장해 주세요.', 'success');
      } else showToast(result.errorMessage || 'OCR 재처리에 실패했습니다.', 'warning');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showToast(error instanceof Error ? error.message : 'OCR 재처리에 실패했습니다.', 'error');
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
          {canManage && transfer.workflowStatus !== 'completed' ? <button type="button" onClick={() => setEditing((value) => !value)} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"><Pencil className="w-3.5 h-3.5" />등록정보 수정</button> : null}
        </div>
      </section>

      {editing ? (
        <section className="bg-white rounded-2xl p-4 sm:p-5 border border-blue-200 shadow-sm space-y-3">
          <h2 className="text-sm font-extrabold text-[#173B57]">등록정보 수정</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block text-xs font-bold text-slate-700">지점 *<select required value={editBranchName} onChange={(event) => setEditBranchName(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50"><option value="">지점 선택</option>{HNS_BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select></label>
            <label className="block text-xs font-bold text-slate-700">요청자<input value={editRequesterName} onChange={(event) => setEditRequesterName(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
            <label className="block text-xs font-bold text-slate-700">점검요청일 *<input type="date" required value={editInspectionDate} onChange={(event) => setEditInspectionDate(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          </div>
          <label className="block text-xs font-bold text-slate-700">주소<input value={editLocation} onChange={(event) => setEditLocation(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <label className="block text-xs font-bold text-slate-700">이관사유 *<input value={editHandoverReason} onChange={(event) => setEditHandoverReason(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block text-xs font-bold text-slate-700">TAP/RN 위치<input value={editTapRnLocation} onChange={(event) => setEditTapRnLocation(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
            <label className="block text-xs font-bold text-slate-700">전주번호<input value={editPoleNumber} onChange={(event) => setEditPoleNumber(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
            <label className="block text-xs font-bold text-slate-700">인입선길이<input value={editLeadInLength} onChange={(event) => setEditLeadInLength(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          </div>
          <label className="block text-xs font-bold text-slate-700">사전조치내용<textarea rows={3} value={editPreActionNotes} onChange={(event) => setEditPreActionNotes(event.target.value)} className="mt-1 w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <label className="block text-xs font-bold text-slate-700">점검요청내용 *<textarea rows={4} value={editDetails} onChange={(event) => setEditDetails(event.target.value)} className="mt-1 w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <label className="block text-xs font-bold text-slate-700">OCR 원문<textarea rows={4} value={editOcrText} onChange={(event) => setEditOcrText(event.target.value)} className="mt-1 w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <label className="flex items-center gap-2 text-xs font-bold text-red-700"><input type="checkbox" checked={editUrgent} onChange={(event) => setEditUrgent(event.target.checked)} />긴급 건</label>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(false)} className="px-4 h-10 rounded-xl bg-slate-100 text-xs font-bold">취소</button><button type="button" disabled={busy} onClick={() => void handleSaveEdit()} className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-[#2878B5] text-white text-xs font-bold"><Save className="w-4 h-4" />저장</button></div>
        </section>
      ) : null}

      <section className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm">
        <h2 className="text-sm font-extrabold text-[#173B57] mb-3 flex items-center gap-1.5"><FileText className="w-4 h-4 text-[#2878B5]" />등록정보</h2>
        <dl className="grid grid-cols-[82px_1fr] gap-x-3 gap-y-3 text-xs">
          <dt className="font-bold text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" />점검요청일</dt><dd className="font-semibold">{transfer.inspectionRequestedDate || transfer.requestDate}</dd>
          <dt className="font-bold text-slate-500">지역</dt><dd className="font-extrabold text-[#173B57]">{transfer.regionName || '-'}</dd>
          <dt className="font-bold text-slate-500">지점</dt><dd className="font-extrabold text-[#173B57]">{transfer.branchName || '-'}</dd>
          <dt className="font-bold text-slate-500">요청자</dt><dd className="font-medium">{transfer.requesterName || '-'}</dd>
          <dt className="font-bold text-slate-500">점검업체/매체</dt><dd className="font-medium">{transfer.inspectionCompany || '유지텔레컴'} / {transfer.mediaType || 'CABLE'}</dd>
          <dt className="font-bold text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />주소</dt><dd className="font-medium">{transfer.location}</dd>
          <dt className="font-bold text-slate-500">이관사유</dt><dd className="font-medium whitespace-pre-wrap">{transfer.handoverReason || transfer.transferReason}</dd>
          <dt className="font-bold text-slate-500">TAP/RN 위치</dt><dd className="font-medium">{transfer.tapRnLocation || '-'}</dd>
          <dt className="font-bold text-slate-500">전주번호</dt><dd className="font-medium">{transfer.poleNumber || '-'}</dd>
          <dt className="font-bold text-slate-500">인입선길이</dt><dd className="font-medium">{transfer.leadInLength || '-'}</dd>
          <dt className="font-bold text-slate-500">사전조치내용</dt><dd className="font-medium whitespace-pre-wrap">{transfer.preActionNotes || '-'}</dd>
          <dt className="font-bold text-slate-500">점검요청내용</dt><dd className="font-medium whitespace-pre-wrap">{transfer.inspectionRequestDetails || transfer.requestDetails}</dd>
        </dl>
      </section>

      <section className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-extrabold text-[#173B57] flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-[#F28C28]" />접수 사진 및 OCR 원문</h2><span className="text-[11px] text-slate-500">{transfer.ocrStatus === 'succeeded' ? '추출 완료' : transfer.ocrStatus === 'failed' ? '추출 실패' : '대기'}</span></div>
        {requestPhotos.length > 0 ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{requestPhotos.map((photo) => <div key={photo.id} className="space-y-1"><img src={apiResourceUrl(photo.url)} alt={photo.fileName} className="w-full aspect-video object-cover rounded-xl border border-slate-200" />{canManage ? <button type="button" disabled={busy} onClick={() => void handleRetryOcr(photo)} className="w-full h-8 inline-flex items-center justify-center gap-1 text-[11px] font-bold bg-blue-50 text-blue-700 rounded-lg"><RefreshCw className="w-3 h-3" />브라우저 OCR 재검사</button> : null}</div>)}</div> : <p className="text-xs text-slate-400">접수 증빙사진이 없습니다.</p>}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs whitespace-pre-wrap text-slate-700">{transfer.ocrText || '저장된 OCR 원문이 없습니다.'}</div>
      </section>

      <section className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E7EB] shadow-sm space-y-3">
        <h2 className="text-sm font-extrabold text-[#173B57] flex items-center gap-1.5"><Wrench className="w-4 h-4 text-[#F28C28]" />현장처리 정보</h2>
        {transfer.fieldActions?.length ? <div className="space-y-2">{transfer.fieldActions.map((action) => <div key={action.id} className="p-3 rounded-xl bg-blue-50/60 border border-blue-100 text-xs"><div className="flex items-center justify-between gap-2 mb-1"><strong className="flex items-center gap-1"><User className="w-3 h-3" />{action.processedByName}</strong><span className="text-slate-500">{action.processedAt}</span></div><p className="whitespace-pre-wrap">{action.actionText}</p></div>)}</div> : <p className="text-xs text-slate-400">등록된 현장처리가 없습니다.</p>}
        {actionPhotos.length > 0 ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{actionPhotos.map((photo) => <img key={photo.id} src={apiResourceUrl(photo.url)} alt={photo.fileName} className="w-full aspect-video object-cover rounded-xl border border-slate-200" />)}</div> : null}
        {transfer.workflowStatus !== 'completed' ? (
          <form onSubmit={handleFieldAction} className="pt-3 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2"><label className="text-xs font-bold text-slate-700">처리일시<input type="datetime-local" value={processedAt} onChange={(event) => setProcessedAt(event.target.value)} className="mt-1 w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50" /></label><label className="text-xs font-bold text-slate-700">현장 처리내용 *<textarea required rows={3} value={fieldActionText} onChange={(event) => setFieldActionText(event.target.value)} className="mt-1 w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label></div>
            <label className="h-16 border border-dashed border-slate-300 rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-slate-600 cursor-pointer"><ImagePlus className="w-4 h-4" />처리 사진 추가 (선택)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void handleFieldPhotos(event)} className="sr-only" /></label>
            {fieldPhotos.length > 0 ? <div className="flex gap-2 overflow-x-auto">{fieldPhotos.map((photo) => <img key={photo.fileName} src={photo.dataUrl} alt={photo.fileName} className="w-20 h-16 object-cover rounded-lg" />)}</div> : null}
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
    </div>
  );
};
