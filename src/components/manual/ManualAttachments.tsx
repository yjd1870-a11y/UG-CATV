import React, { useRef, useState } from 'react';
import { manualApi } from '../../features/manual/api';
import { MANUAL_LIMITS, type ManualAsset, type ManualDetail, type ManualKind } from '../../features/manual/types';
import { ManualModelThumbnail } from './ManualModelThumbnail';
import { ManualPhotoInput } from './ManualPhotoInput';
import { compressManualPhoto } from '../../features/manual/photo-compression';
const field = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white p-3';
const labels = { video: '동영상', photo: '사진', pdf: 'PDF', thumbnail: '썸네일' };
const accept = { video: '.mp4', photo: '.jpg,.jpeg,.png,.webp', pdf: '.pdf', thumbnail: '.jpg,.jpeg,.png,.webp' };

const capturePoster = (file: File): Promise<File | null> => new Promise((resolve) => {
  const url = URL.createObjectURL(file); const video = document.createElement('video'); video.muted = true; video.preload = 'metadata';
  let finished = false;
  const finish = (result: File | null) => { if (finished) return; finished = true; clearTimeout(timeout); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); resolve(result); };
  const timeout = window.setTimeout(() => finish(null), 12000);
  video.onloadedmetadata = () => { video.currentTime = Math.min(0.5, video.duration / 2); };
  video.onseeked = () => {
    try {
      const canvas = document.createElement('canvas'); const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight)); canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.height > 1280) { finish(null); return; }
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => finish(blob ? new File([blob], 'video-thumbnail.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.85);
    } catch { finish(null); }
  };
  video.onerror = () => finish(null); video.src = url;
});

const AssetEditor: React.FC<{ asset: ManualAsset; images: ManualAsset[]; refresh: () => Promise<void> }> = ({ asset, images, refresh }) => {
  const [title, setTitle] = useState(asset.title); const [posterId, setPosterId] = useState(asset.posterId || '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const action = async (remove: boolean) => {
    if (remove && !window.confirm(`‘${asset.title}’ 자료를 삭제할까요?`)) return;
    setBusy(true); setError('');
    try { if (remove) await manualApi.deleteAsset(asset.id); else await manualApi.editAsset(asset.id, title, posterId || null); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '변경하지 못했습니다.'); } finally { setBusy(false); }
  };
  return <div className="rounded-lg border bg-white p-3"><p className="mb-2 break-all text-xs text-slate-500">{labels[asset.kind]} · {asset.fileName} · {(asset.bytes / 1048576).toFixed(1)}MB</p>
    {asset.kind !== 'thumbnail' && <label className="block text-sm">자료 제목<input aria-label={`${asset.title} 제목`} className={field} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>}
    {asset.kind === 'video' && <label className="mt-2 block text-sm">썸네일<select className={field} value={posterId} onChange={(e) => setPosterId(e.target.value)}><option value="">기본 재생 아이콘</option>{asset.posterId && !images.some((p) => p.id === asset.posterId) && <option value={asset.posterId}>기존 썸네일 유지</option>}{images.map((p) => <option key={p.id} value={p.id}>{p.fileName}</option>)}</select></label>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<div className="mt-2 flex justify-end gap-2"><button disabled={busy} onClick={() => void action(false)} className="min-h-11 rounded-lg border px-4">변경 저장</button><button disabled={busy} onClick={() => void action(true)} className="min-h-11 rounded-lg border px-4 text-red-700">삭제</button></div>
  </div>;
};

export const ManualAttachments: React.FC<{ detail: ManualDetail; refresh: () => Promise<void>; onClose: () => void }> = ({ detail, refresh, onClose }) => {
  const [selection, setSelection] = useState(0);
  const [kind, setKind] = useState<ManualKind>('photo'); const [title, setTitle] = useState(''); const [file, setFile] = useState<File | null>(null); const [posterId, setPosterId] = useState('');
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(detail.model.name); const [manufacturer, setManufacturer] = useState(detail.model.manufacturer); const [description, setDescription] = useState(detail.model.description);
  const images = detail.assets.filter((a) => a.kind === 'thumbnail');
  const upload = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); const limit = MANUAL_LIMITS[kind];
    if (!file || (kind !== 'thumbnail' && !title.trim())) { setError('자료 제목과 파일을 선택해주세요.'); return; }
    if (!(limit.mime as readonly string[]).includes(file.type) || file.size <= 0 || file.size > limit.bytes) { setError('파일 형식이나 용량을 확인해주세요.'); return; }
    setBusy(true); setProgress(0); let generated: string | null = null; let uploaded = false;
    try {
      if (kind === 'video' && !posterId) { const poster = await capturePoster(file); if (poster) generated = await manualApi.upload(detail.model.id, (await compressManualPhoto(poster, 800)).file, 'thumbnail', `${title} 썸네일`, null, () => {}); }
      await manualApi.upload(detail.model.id, file, kind, kind === 'thumbnail' ? file.name : title, posterId || generated, setProgress);
      uploaded = true;
      setFile(null); setSelection((value) => value + 1); setTitle(''); setPosterId(''); if (fileRef.current) fileRef.current.value = ''; setNotice('자료를 등록했습니다.'); await refresh();
    } catch (e) { if (generated && !uploaded) await manualApi.deleteAsset(generated).catch(() => {}); setError(uploaded ? '자료는 등록됐지만 목록을 갱신하지 못했습니다. 새로고침해주세요.' : e instanceof Error ? e.message : '등록하지 못했습니다.'); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const saveInfo = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await manualApi.model(detail.model.id, { categoryId: detail.model.categoryId, name, manufacturer, description }); await refresh(); setNotice('모델 정보를 저장했습니다.'); }
    catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다.'); } finally { setBusy(false); }
  };
  const removeModel = async () => {
    if (!window.confirm('이 모델과 연결된 모든 매뉴얼 자료를 삭제할까요?')) return;
    setBusy(true); setError('');
    try { await manualApi.deleteModel(detail.model.id); window.location.assign(`/manual?category=${encodeURIComponent(detail.model.categoryId)}`); }
    catch (e) { setError(e instanceof Error ? e.message : '삭제하지 못했습니다.'); setBusy(false); }
  };
  return <section className="space-y-5 rounded-xl border-2 border-teal-400 bg-teal-100 p-4 shadow-sm sm:p-6" aria-label="자료 관리"><h2 className="text-lg font-extrabold text-[#173B57]">모델 및 첨부자료 관리</h2>
    <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-60"><form onSubmit={saveInfo} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">모델명<input className={field} value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} /></label><label className="text-sm">제조사<input className={field} value={manufacturer} maxLength={100} onChange={(e) => setManufacturer(e.target.value)} /></label></div>
      <label className="block text-sm">짧은 설명<input className={field} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} /></label><div className="flex flex-wrap justify-between gap-2"><button type="button" onClick={() => void removeModel()} className="min-h-11 rounded-lg border bg-white px-4 text-sm text-red-700">모델 삭제</button><button className="min-h-11 rounded-lg border bg-white px-4 text-sm font-bold">모델 정보 저장</button></div></form>
      <ManualModelThumbnail detail={detail} refresh={refresh} /><form onSubmit={upload} className="space-y-3 border-t border-teal-300 pt-4"><h3 className="font-bold">첨부자료 추가</h3><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">자료 유형<select className={field} value={kind} onChange={(e) => { setKind(e.target.value as ManualKind); setFile(null); setSelection((value) => value + 1); if (fileRef.current) fileRef.current.value = ''; }}><option value="photo">매뉴얼 장비사진</option><option value="thumbnail">동영상 썸네일</option><option value="video">동영상</option><option value="pdf">PDF</option></select></label>{kind !== 'thumbnail' && <label className="text-sm">자료 제목<input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="예: 측정 화면 확인" /></label>}</div>
        <p className="text-sm text-slate-600">{kind === 'video' ? 'MP4 / H.264·AAC 권장 · 파일당 최대 200MB · 모델당 4개. 약 3분으로 압축한 파일을 등록하세요.' : kind === 'photo' ? 'JPG·PNG·WebP · 파일당 최대 10MB · 모델당 30장. 매뉴얼 설명용으로만 사용하며 목록 썸네일과 별도로 저장합니다.' : kind === 'thumbnail' ? '동영상 전용 썸네일 · JPG·PNG·WebP · 최대 2MB · 파일명만 표시합니다.' : 'PDF · 파일당 최대 20MB · 모델당 10개.'}</p>
        <>{kind === 'photo' || kind === 'thumbnail' ? <ManualPhotoInput key={`${kind}-${selection}`} label="파일" maxSide={kind === 'photo' ? 2000 : 800} maxBytes={MANUAL_LIMITS[kind].bytes} disabled={busy} onReady={setFile} /> : <label className="block text-sm">파일<input ref={fileRef} type="file" accept={accept[kind]} className={`${field} max-w-full text-sm`} onChange={(e) => setFile(e.target.files?.[0] || null)} required /></label>}</>
        {kind === 'video' && <label className="block text-sm">썸네일<select className={field} value={posterId} onChange={(e) => setPosterId(e.target.value)}><option value="">영상에서 자동 추출</option>{images.map((p) => <option key={p.id} value={p.id}>{p.fileName}</option>)}</select></label>}<button disabled={!file || busy} className="min-h-11 rounded-lg bg-teal-600 px-5 font-bold text-white disabled:opacity-50">자료 등록</button>
      </form><div className="space-y-3">{detail.assets.filter((a) => a.purpose !== 'model-cover').map((a) => <AssetEditor key={`${a.id}-${a.title}-${a.posterId}`} asset={a} images={images} refresh={refresh} />)}</div>
    </fieldset>{busy && <p role="status" className="text-sm text-teal-700">처리 중… {progress > 0 ? `${progress}% · 전송 후 파일을 검증합니다.` : ''}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-teal-700">{notice}</p>}<button type="button" onClick={onClose} className="min-h-11 rounded-lg border bg-white px-5 font-bold text-[#173B57]">자료 관리 닫기</button>
  </section>;
};
