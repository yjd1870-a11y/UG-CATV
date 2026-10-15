import React, { useRef, useState } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { manualResourceUrl, manualFileUrl } from '../../features/manual/api';
import type { ManualAsset } from '../../features/manual/types';
import { InteractivePhotoViewer } from '../common/InteractivePhotoViewer';

export const ManualImage: React.FC<{ url: string | null; label: string; className?: string }> = ({ url, label, className = '' }) => {
  const [failed, setFailed] = useState(false);
  if (!url) return <div className={`flex items-center justify-center bg-teal-50 text-teal-600 ${className}`}><ImageIcon size={32} aria-label="사진 미등록" /></div>;
  if (failed) return <span className={`flex items-center justify-center bg-slate-100 p-2 text-xs text-slate-600 ${className}`}>사진을 불러올 수 없습니다</span>;
  return <img loading="lazy" alt={label} src={manualResourceUrl(url)} onError={() => setFailed(true)} className={`object-cover ${className}`} />;
};

const ManualVideo: React.FC<{ videos: ManualAsset[] }> = ({ videos }) => {
  const [selected, setSelected] = useState(videos[0]?.id || ''); const [error, setError] = useState(false); const [retry, setRetry] = useState(0);
  const [resume, setResume] = useState(0); const videoRef = useRef<HTMLVideoElement>(null);
  const active = videos.find((v) => v.id === selected) || videos[0];
  if (!active) return <p className="rounded-xl border border-dashed p-5 text-sm text-slate-500">등록된 동영상이 없습니다.</p>;
  return <section aria-label="동영상" className="space-y-3">
    <h2 className="text-lg font-extrabold text-[#173B57]">사용방법 동영상</h2>
    {videos.length > 1 && <label className="block text-sm font-bold text-[#173B57]">동영상 선택<select aria-label="동영상 선택" value={active.id} onChange={(e) => { setSelected(e.target.value); setError(false); setResume(0); setRetry(0); }} className="mt-2 min-h-11 w-full rounded-lg border bg-white p-3">{videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>}
    <video key={`${active.id}-${retry}`} ref={videoRef} controls playsInline preload="none" poster={active.posterUrl ? manualResourceUrl(active.posterUrl) : undefined}
      src={`${manualResourceUrl(active.url)}${retry ? `?retry=${retry}` : ''}`} aria-label={active.title}
      onError={() => setError(true)} onLoadedMetadata={(e) => { if (resume) e.currentTarget.currentTime = Math.min(resume, e.currentTarget.duration || resume); }}
      className="aspect-video w-full rounded-xl bg-slate-900" />
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">영상을 불러오지 못했습니다. 연결 상태와 파일 형식을 확인해주세요.
      <button className="ml-2 min-h-11 underline" onClick={() => { setResume(videoRef.current?.currentTime || 0); setError(false); setRetry((n) => n + 1); }}>재시도</button></div>}
  </section>;
};

export const ManualMedia: React.FC<{ assets: ManualAsset[] }> = ({ assets }) => {
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const photos = assets.filter((a) => a.kind === 'photo' && a.purpose !== 'model-cover'); const videos = assets.filter((a) => a.kind === 'video'); const pdfs = assets.filter((a) => a.kind === 'pdf');
  return <div className="space-y-6">
    <ManualVideo videos={videos} />
    <section aria-label="장비 사진"><h2 className="mb-3 text-lg font-extrabold text-[#173B57]">장비 사진</h2>
      {!photos.length ? <p className="text-sm text-slate-500">등록된 사진이 없습니다.</p> : <><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((p, i) => <div key={p.id} className="min-w-0">
        <button onClick={() => setViewIndex(i)} aria-label={`${p.title} 확대`} className="w-full overflow-hidden rounded-lg border"><ManualImage url={p.url} label={p.title} className="aspect-video w-full" /></button><p className="mt-1 break-words text-sm [overflow-wrap:anywhere]">{p.title}</p>
      </div>)}</div><p className="mt-2 text-xs text-slate-500">사진을 누르면 크게 볼 수 있어요.</p></>}
    </section>
    <section aria-label="PDF 설명서"><h2 className="mb-3 text-lg font-extrabold text-[#173B57]">PDF 설명서</h2>
      {!pdfs.length ? <p className="text-sm text-slate-500">등록된 PDF가 없습니다.</p> : <div className="space-y-2">{pdfs.map((p) => <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-teal-50 p-3">
        <FileText className="shrink-0 text-red-600" /><div className="min-w-0 flex-1"><p className="break-words font-bold text-[#173B57] [overflow-wrap:anywhere]">{p.title}</p><p className="break-all text-xs text-slate-500">{p.fileName}</p></div>
        <a href={manualFileUrl(p.id)} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center rounded-lg border bg-white px-4 font-bold text-sm">열기</a>
        <a href={manualFileUrl(p.id, true)} className="flex min-h-11 items-center rounded-lg border bg-white px-4 font-bold text-sm">다운로드</a>
      </div>)}</div>}
    </section>
    {viewIndex !== null && <InteractivePhotoViewer photos={photos.map((p) => ({ id: p.id, url: manualResourceUrl(p.url), label: p.title }))} initialIndex={viewIndex} title="장비 사진" ariaLabel="매뉴얼 장비 사진 확대" onClose={() => setViewIndex(null)} />}
  </div>;
};
