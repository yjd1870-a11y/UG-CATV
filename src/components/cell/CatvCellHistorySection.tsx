import React, { useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Clock3, History, ImagePlus, Maximize2, Pencil, Plus, Trash2, Upload, UserRound, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { cellsApi } from '../../features/cells/api';
import type { CellWorkHistory } from '../../types';

interface CatvCellHistorySectionProps {
  cellId: string;
  cellName: string;
  history: CellWorkHistory[];
  onChanged: () => Promise<void>;
}

const todayInKorea = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

const samplePhoto = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
    <rect width="900" height="600" fill="#e9eff5"/>
    <rect x="250" y="120" width="400" height="360" rx="24" fill="#173B57"/>
    <circle cx="450" cy="285" r="85" fill="#f28c28"/>
    <path d="M380 390h140l-70-100z" fill="#fff" opacity=".9"/>
    <text x="450" y="535" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="700" fill="#173B57">현장 샘플 사진</text>
  </svg>
`)}`;

export const CatvCellHistorySection: React.FC<CatvCellHistorySectionProps> = ({
  cellId,
  cellName,
  history,
  onChanged,
}) => {
  const { currentUser, showToast } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [workDate, setWorkDate] = useState(todayInKorea());
  const [worker, setWorker] = useState(currentUser?.name || '');
  const [summary, setSummary] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragTarget, setDragTarget] = useState<'add' | 'edit' | null>(null);
  const [editingHistory, setEditingHistory] = useState<CellWorkHistory | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editWorkDate, setEditWorkDate] = useState('');
  const [editWorker, setEditWorker] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editPhotos, setEditPhotos] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ photos: string[]; index: number; title: string } | null>(null);

  const openModal = () => {
    setTitle('');
    setWorkDate(todayInKorea());
    setWorker(currentUser?.name || '');
    setSummary('');
    setPhotos([]);
    setOpen(true);
  };

  const readPhotos = async (files: FileList | File[], currentCount: number) => {
    const available = Math.max(0, 3 - currentCount);
    const selected = Array.from(files).filter((file) => file.type.startsWith('image/')).slice(0, available);
    const oversized = selected.find((file) => file.size > 5 * 1024 * 1024);
    if (oversized) {
      showToast('사진은 한 장당 5MB 이하만 등록할 수 있습니다.', 'warning');
      return [];
    }
    try {
      return await Promise.all(selected.map(readFile));
    } catch {
      showToast('사진을 불러오지 못했습니다.', 'error');
      return [];
    }
  };

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const loadedPhotos = await readPhotos(files, photos.length);
    setPhotos((current) => [...current, ...loadedPhotos].slice(0, 3));
  };

  const handleEditFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const loadedPhotos = await readPhotos(files, editPhotos.length);
    setEditPhotos((current) => [...current, ...loadedPhotos].slice(0, 3));
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>, target: 'add' | 'edit') => {
    event.preventDefault();
    setDragTarget(null);
    if (target === 'add') void handleFiles(event.dataTransfer.files);
    else void handleEditFiles(event.dataTransfer.files);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !workDate || !worker.trim() || !summary.trim()) return;
    setSaving(true);
    try {
      await cellsApi.addHistory(cellId, {
        title: title.trim(),
        type: '현장작업',
        date: workDate,
        worker: worker.trim(),
        summary: summary.trim(),
        status: '완료',
        photos,
      });
      await onChanged();
      setOpen(false);
      showToast('작업이력이 저장되었습니다.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '작업이력을 저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (historyId: string) => {
    if (!window.confirm('이 작업이력을 삭제하시겠습니까?')) return;
    try {
      await cellsApi.deleteHistory(cellId, historyId);
      await onChanged();
      showToast('작업이력이 삭제되었습니다.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '작업이력을 삭제하지 못했습니다.', 'error');
    }
  };

  const openEdit = (item: CellWorkHistory) => {
    setEditingHistory(item);
    setEditTitle(item.title || item.type || '');
    setEditWorkDate(item.date || todayInKorea());
    setEditWorker(item.worker || currentUser?.name || '');
    setEditSummary(item.summary || '');
    setEditPhotos([...(item.photos || [])]);
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingHistory || !editTitle.trim() || !editWorkDate || !editWorker.trim() || !editSummary.trim()) return;
    setSaving(true);
    try {
      await cellsApi.updateHistory(cellId, editingHistory.id, {
        title: editTitle.trim(), type: '현장작업', date: editWorkDate, worker: editWorker.trim(),
        summary: editSummary.trim(), status: editingHistory.status || '완료', photos: editPhotos,
      });
      await onChanged();
      setEditingHistory(null);
      showToast('작업이력이 수정되었습니다.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '작업이력을 수정하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const canEdit = (item: CellWorkHistory) => currentUser?.role === 'admin'
    || currentUser?.role === 'team_leader' || item.worker === currentUser?.name;

  return (
    <section id="catv-cell-history" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-black text-[#173B57] sm:text-lg">
          <span className="h-2.5 w-2.5 rounded-full bg-[#173B57]" />
          작업이력
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-extrabold text-slate-500">
            총 {history.length}건
          </span>
        </h2>
        <button type="button" onClick={openModal} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#F28C28] px-4 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#dd7b1d]">
          <Plus className="h-4 w-4" /> 작업이력 등록
        </button>
      </div>

      {history.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
          <History className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-2 text-sm font-bold text-[#173B57]">등록된 작업이력이 없습니다.</p>
          <p className="mt-1 text-xs text-slate-500">기존 비고 내용 대신 현장 작업을 날짜별 이력으로 남겨보세요.</p>
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          {history.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black text-[#173B57] sm:text-base">{item.title || item.type || '작업이력'}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                    <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{item.worker}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{item.date}</span>
                  </div>
                </div>
                {canEdit(item) ? <div className="flex items-center gap-1">
                  <button type="button" onClick={() => openEdit(item)} className="rounded-lg p-2 text-slate-400 transition hover:bg-blue-50 hover:text-[#2878B5]" aria-label={`${item.title || '작업이력'} 수정`}><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => void handleDelete(item.id)} className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500" aria-label={`${item.title || '작업이력'} 삭제`}><Trash2 className="h-4 w-4" /></button>
                </div> : null}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-slate-700">{item.summary}</p>
              {item.photos?.length ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {item.photos.map((photo, index) => (
                    <button type="button" key={`${item.id}-${index}`} onClick={() => setPreview({ photos: item.photos || [], index, title: item.title || item.type || '작업이력' })} className="group relative overflow-hidden rounded-xl border border-slate-200" aria-label={`${item.title || '작업이력'} 현장 사진 ${index + 1} 확대`}>
                      <img src={photo} alt={`${item.title || '작업이력'} 현장 사진 ${index + 1}`} className="aspect-4/3 w-full object-cover transition group-hover:scale-105" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white transition group-hover:bg-black/25"><Maximize2 className="h-5 w-5 opacity-0 transition group-hover:opacity-100" /></span>
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {open ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="catv-history-modal-title">
          <div className="w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h3 id="catv-history-modal-title" className="flex items-center gap-2 text-lg font-black text-[#173B57] sm:text-xl">
                <History className="h-6 w-6 text-[#F28C28]" /> {cellName} 작업이력 등록
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="작업이력 등록 닫기"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <label className="block text-xs font-bold text-slate-700">
                제목 *
                <input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="예: 노이즈 측정 및 정비 / 단자함 점검" className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-[#173B57] outline-none transition focus:border-[#2878B5] focus:bg-white focus:ring-2 focus:ring-blue-100" />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-bold text-slate-700">
                  작업 일자 *
                  <input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} required className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-[#173B57] outline-none focus:border-[#2878B5] focus:bg-white focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-xs font-bold text-slate-700">
                  작업자 *
                  <input value={worker} onChange={(event) => setWorker(event.target.value)} required className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-[#173B57] outline-none focus:border-[#2878B5] focus:bg-white focus:ring-2 focus:ring-blue-100" />
                </label>
              </div>

              <label className="block text-xs font-bold text-slate-700">
                작업내용 *
                <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required rows={4} placeholder="예: 전주 분기기 교체 후 RF 출력레벨 +38dBmV 정상 측정 완료" className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none focus:border-[#2878B5] focus:bg-white focus:ring-2 focus:ring-blue-100" />
              </label>

              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold text-[#173B57]">
                    <Camera className="h-4 w-4" /> 현장 사진 등록
                    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px]">최대 3장 ({photos.length}/3)</span>
                  </div>
                  <button type="button" disabled={photos.length >= 3} onClick={() => setPhotos((current) => [...current, samplePhoto].slice(0, 3))} className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] font-bold text-orange-600 disabled:cursor-not-allowed disabled:opacity-40">
                    + 샘플사진 추가
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleFiles(event.target.files)} />
                {photos.length < 3 ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={(event) => { event.preventDefault(); setDragTarget('add'); }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setDragTarget(null)}
                    onDrop={(event) => handleDrop(event, 'add')}
                    className={`mt-3 flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 text-center transition ${dragTarget === 'add' ? 'border-[#2878B5] bg-blue-50' : 'border-slate-300 bg-white hover:border-[#2878B5] hover:bg-blue-50/30'}`}
                  >
                    <Upload className="h-7 w-7 text-slate-400" />
                    <span className="mt-2 text-xs font-bold text-slate-700">클릭하거나 사진을 여기에 드래그 (최대 3장)</span>
                    <span className="mt-1 text-[11px] text-slate-400">JPG, PNG, GIF 이미지 지원 · 첫 번째 사진이 대표사진으로 표시됩니다</span>
                  </button>
                ) : null}
                {photos.length ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {photos.map((photo, index) => (
                      <div key={`${photo.slice(0, 32)}-${index}`} className="group relative overflow-hidden rounded-xl border border-slate-200">
                        <img src={photo} alt={`첨부 사진 ${index + 1}`} className="aspect-4/3 w-full object-cover" />
                        <button type="button" onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))} className="absolute right-1.5 top-1.5 rounded-full bg-red-600 p-1 text-white shadow" aria-label={`첨부 사진 ${index + 1} 삭제`}><X className="h-3.5 w-3.5" /></button>
                        {index === 0 ? <span className="absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white">대표사진</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="h-12 rounded-2xl bg-slate-100 text-sm font-extrabold text-slate-700 hover:bg-slate-200">취소</button>
                <button type="submit" disabled={saving} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#F28C28] text-sm font-extrabold text-white shadow-sm hover:bg-[#dd7b1d] disabled:opacity-60">
                  <ImagePlus className="h-4 w-4" /> {saving ? '저장 중...' : '작업이력 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingHistory ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="catv-history-edit-title">
          <div className="w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h3 id="catv-history-edit-title" className="flex items-center gap-2 text-lg font-black text-[#173B57]"><Pencil className="h-5 w-5 text-[#F28C28]" />작업이력 수정</h3>
              <button type="button" onClick={() => setEditingHistory(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="작업이력 수정 닫기"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="mt-5 space-y-4">
              <label className="block text-xs font-bold text-slate-700">제목 *<input required value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-[#2878B5]" /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-bold text-slate-700">작업 일자 *<input required type="date" value={editWorkDate} onChange={(event) => setEditWorkDate(event.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold" /></label>
                <label className="block text-xs font-bold text-slate-700">작업자 *<input required value={editWorker} onChange={(event) => setEditWorker(event.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold" /></label>
              </div>
              <label className="block text-xs font-bold text-slate-700">작업내용 *<textarea required rows={4} value={editSummary} onChange={(event) => setEditSummary(event.target.value)} className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 outline-none focus:border-[#2878B5]" /></label>
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-extrabold text-[#173B57]"><Camera className="h-4 w-4" />현장 사진 수정 ({editPhotos.length}/3)</span></div>
                <input type="file" accept="image/*" multiple className="hidden" ref={fileInputRef} onChange={(event) => void handleEditFiles(event.target.files)} />
                {editPhotos.length < 3 ? <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(event) => { event.preventDefault(); setDragTarget('edit'); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragTarget(null)}
                  onDrop={(event) => handleDrop(event, 'edit')}
                  className={`mt-3 flex min-h-24 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed transition ${dragTarget === 'edit' ? 'border-[#2878B5] bg-blue-50' : 'border-slate-300 bg-white hover:border-[#2878B5]'}`}
                ><Upload className="h-6 w-6 text-slate-400" /><span className="mt-2 text-xs font-bold text-slate-700">클릭하거나 사진을 여기에 드래그</span></button> : null}
                {editPhotos.length ? <div className="mt-3 grid grid-cols-3 gap-2">{editPhotos.map((photo, index) => <div key={`${photo.slice(0, 32)}-${index}`} className="relative overflow-hidden rounded-xl border border-slate-200"><img src={photo} alt={`수정 사진 ${index + 1}`} className="aspect-4/3 w-full object-cover" /><button type="button" onClick={() => setEditPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))} className="absolute right-1.5 top-1.5 rounded-full bg-red-600 p-1 text-white" aria-label={`수정 사진 ${index + 1} 삭제`}><X className="h-3.5 w-3.5" /></button></div>)}</div> : null}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2"><button type="button" onClick={() => setEditingHistory(null)} className="h-12 rounded-2xl bg-slate-100 text-sm font-extrabold text-slate-700">취소</button><button type="submit" disabled={saving} className="h-12 rounded-2xl bg-[#173B57] text-sm font-extrabold text-white disabled:opacity-60">{saving ? '수정 중...' : '수정 완료'}</button></div>
            </form>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="작업이력 사진 확대">
          <div className="w-full max-w-5xl">
            <div className="mb-3 flex items-center justify-between text-white"><strong className="text-sm">{preview.title} · {preview.index + 1}/{preview.photos.length}</strong><button type="button" onClick={() => setPreview(null)} className="rounded-full bg-white/10 p-2" aria-label="확대 사진 닫기"><X className="h-5 w-5" /></button></div>
            <div className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-2xl bg-black">
              <img src={preview.photos[preview.index]} alt={`${preview.title} 확대 사진 ${preview.index + 1}`} className="max-h-[78vh] max-w-full object-contain" />
              {preview.photos.length > 1 ? <>
                <button type="button" onClick={() => setPreview((current) => current ? { ...current, index: (current.index - 1 + current.photos.length) % current.photos.length } : null)} className="absolute left-3 rounded-full bg-black/60 p-3 text-white" aria-label="이전 사진"><ChevronLeft className="h-6 w-6" /></button>
                <button type="button" onClick={() => setPreview((current) => current ? { ...current, index: (current.index + 1) % current.photos.length } : null)} className="absolute right-3 rounded-full bg-black/60 p-3 text-white" aria-label="다음 사진"><ChevronRight className="h-6 w-6" /></button>
              </> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
