import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Pencil, X } from 'lucide-react';
import { CC_PARTICIPATION_TITLE, type CcParticipationDocument } from '../../features/home/cc-participation-process';
import { ccParticipationApi } from '../../features/home/cc-participation-api';
import { apiResourceUrl } from '../../shared/api/client';
import { CcParticipationProcessEditor } from './CcParticipationProcessEditor';
import { InteractivePhotoViewer, type InteractiveViewerPhoto } from '../common/InteractivePhotoViewer';

const PhotoDialog: React.FC<{ photos: InteractiveViewerPhoto[]; initialIndex: number; onClose: () => void }> = ({ photos, initialIndex, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialogRef} aria-label="CC 참여 프로세스 사진 확대" className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0"
    onKeyDownCapture={(event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <InteractivePhotoViewer photos={photos} initialIndex={initialIndex} title={CC_PARTICIPATION_TITLE} ariaLabel="CC 참여 프로세스 사진 보기" onClose={onClose} />
  </dialog>;
};

export const CcParticipationProcessDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Set<string>>(() => new Set());
  const [detail, setDetail] = useState<CcParticipationDocument | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const photos = (detail?.sections || []).flatMap((section) => section.photo && !failedPhotos.has(section.id)
    ? [{ id: section.id, url: apiResourceUrl(section.photo.url), label: section.photo.alt }]
    : []);
  const requestClose = useCallback(() => {
    if (busy || (dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 닫을까요?'))) return;
    onClose();
  }, [busy, dirty, onClose]);
  const cancelEditing = () => {
    if (dirty && !window.confirm('수정한 내용을 취소할까요?')) return;
    setEditing(false); setDirty(false);
  };
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    ccParticipationApi.get(controller.signal).then((data) => { if (!controller.signal.aborted) setDetail(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '자료를 불러오지 못했습니다.'); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialogRef} id="cc-participation-dialog" aria-labelledby="cc-participation-title" aria-describedby="cc-participation-introduction"
    className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-[#1F2937] shadow-2xl backdrop:bg-slate-950/60 sm:w-[94vw]"
    onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      requestClose();
    }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
    }}>
    <div className="flex max-h-[92dvh] min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="home-notice-category home-notice-category--important">중요</span>
          <h2 id="cc-participation-title" className="text-base font-extrabold text-[#173B57] sm:text-lg">{CC_PARTICIPATION_TITLE}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {detail?.canManage && !editing ? <button type="button" onClick={() => { setEditing(true); setNotice(''); }} className="flex min-h-11 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 text-xs font-bold text-[#2878B5] sm:px-3"><Pencil className="h-3.5 w-3.5" />등록·수정</button> : null}
          <button type="button" autoFocus disabled={busy} onClick={requestClose} aria-label="CC 참여 프로세스 닫기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5" tabIndex={0} role="region" aria-label="CC 참여 프로세스 사진과 설명">
        <p id="cc-participation-introduction" className="sr-only">CC 참여 관련 사진과 설명 안내</p>
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}<button type="button" className="ml-2 min-h-11 underline" onClick={() => setReload((value) => value + 1)}>다시 불러오기</button></p> : !detail ? <p role="status" className="py-8 text-center text-sm text-slate-500">자료를 불러오는 중…</p> : null}
        {notice ? <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p> : null}
        {detail && editing ? <CcParticipationProcessEditor document={detail} onBusyChange={setBusy} onDirtyChange={setDirty} onCancel={cancelEditing} onSaved={(data) => { setDetail(data); setEditing(false); setDirty(false); setFailedPhotos(new Set()); setNotice('CC 참여 자료를 저장했습니다.'); }} /> : detail ? <>
        {detail.introduction ? <p style={{ color: detail.introductionColor }} className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{detail.introduction}</p> : null}
        {!detail.sections.length && !detail.bottomText ? <p className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">아직 등록된 자료가 없습니다.{detail.canManage ? ' 상단의 등록·수정 버튼으로 자료를 추가해주세요.' : ''}</p> : null}
        <div className="mt-5 space-y-5">
          {detail.sections.map((section, index) => <section key={section.id} aria-label={section.title || `자료 ${index + 1}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {section.photo && !failedPhotos.has(section.id) ? <button type="button" aria-label={`${section.title} 사진 확대`} className="group relative block w-full bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-red-600" onClick={() => setViewIndex(photos.findIndex((photo) => photo.id === section.id))}>
              <img src={apiResourceUrl(section.photo.url)} alt={section.photo.alt} loading="lazy" className="block h-auto w-full object-contain" onError={() => setFailedPhotos((current) => new Set(current).add(section.id))} />
              <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-slate-900/75 px-2 py-1 text-xs text-white"><Maximize2 className="h-3.5 w-3.5" />확대</span>
            </button> : section.photo ? <p className="bg-slate-50 p-4 text-xs text-slate-500">사진을 불러올 수 없습니다.</p> : null}
            {section.description ? <p className="whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 text-slate-600 [overflow-wrap:anywhere] sm:px-4">{section.description}</p> : null}
          </section>)}
        </div>
        {detail.bottomText ? <section aria-label="하단 공통 텍스트" className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="mb-2 text-sm font-bold text-[#173B57]">안내사항</h3><p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 [overflow-wrap:anywhere]">{detail.bottomText}</p></section> : null}
        </> : null}
      </div>
    </div>
    {viewIndex !== null ? <PhotoDialog photos={photos} initialIndex={viewIndex} onClose={() => setViewIndex(null)} /> : null}
  </dialog>;
};
