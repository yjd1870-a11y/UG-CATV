import React, { useState } from 'react';
import { manualApi } from '../../features/manual/api';
import { MANUAL_LIMITS, type ManualDetail } from '../../features/manual/types';
import { ManualPhotoInput } from './ManualPhotoInput';

export const ManualModelThumbnail: React.FC<{ detail: ManualDetail; refresh: () => Promise<void> }> = ({ detail, refresh }) => {
  const existing = detail.assets.find((a) => a.purpose === 'model-cover');
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [selection, setSelection] = useState(0);
  const remove = async () => {
    if (!existing || !window.confirm('모델 목록 썸네일을 삭제할까요?')) return;
    setBusy(true); setError('');
    try { await manualApi.deleteAsset(existing.id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '삭제하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!file || !(MANUAL_LIMITS.photo.mime as readonly string[]).includes(file.type) || file.size <= 0 || file.size > MANUAL_LIMITS.photo.bytes) { setError('JPG·PNG·WebP, 10MB 이하 파일을 선택해주세요.'); return; }
    setBusy(true); let id: string | null = null; let assigned = false;
    try {
      id = await manualApi.upload(detail.model.id, file, 'photo', file.name, null, () => {}, 'model-cover');
      await manualApi.image(detail.model.id, id); assigned = true;
      setFile(null); setSelection((value) => value + 1); await refresh();
    } catch (e) { if (id && !assigned) await manualApi.deleteAsset(id).catch(() => {}); setError(e instanceof Error ? e.message : '썸네일을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className="space-y-3 border-t border-teal-200 pt-4"><h3 className="font-bold">모델 목록 썸네일</h3>
    <p className="text-sm text-slate-600">모델 선택 목록에만 표시하는 사진입니다. 매뉴얼 장비사진 및 동영상 썸네일과 별도로 저장합니다.</p>
    <p className="break-all rounded-lg border bg-white p-3 text-sm">{existing ? existing.fileName : '등록된 썸네일 파일이 없습니다.'}</p>
    <ManualPhotoInput key={selection} label="썸네일 파일" maxSide={800} maxBytes={MANUAL_LIMITS.photo.bytes} disabled={busy} onReady={setFile} />
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex flex-wrap gap-2"><button disabled={busy || !file} className="min-h-11 rounded-lg bg-teal-600 px-5 font-bold text-white disabled:opacity-50">{busy ? '저장 중…' : '썸네일 저장'}</button>{existing && <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 rounded-lg border bg-white px-4 text-red-700">썸네일 삭제</button>}</div>
  </form>;
};
