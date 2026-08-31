import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';

export type TransferViewerPhoto = { id: string; url: string; fileName: string };

type Props = {
  photos: TransferViewerPhoto[];
  initialIndex: number;
  onClose: () => void;
};

type Point = { x: number; y: number };

export const TransferPhotoViewer: React.FC<Props> = ({ photos, initialIndex, onClose }) => {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; origin: Point; offset: Point } | null>(null);
  const photo = photos[index];

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    drag.current = null;
  };

  const move = (direction: -1 | 1) => {
    setIndex((current) => (current + direction + photos.length) % photos.length);
    resetView();
  };

  const zoom = (delta: number) => {
    setScale((current) => {
      const next = Math.min(5, Math.max(1, Number((current + delta).toFixed(2))));
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && photos.length > 1) move(-1);
      if (event.key === 'ArrowRight' && photos.length > 1) move(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [photos.length]);

  if (!photo) return null;

  return (
    <div className="fixed inset-0 z-70 flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="업무이관 사진 확대">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 bg-[#173B57] px-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{photo.fileName}</p>
          <p className="text-[10px] text-blue-100">{index + 1} / {photos.length}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="사진 확대 닫기" className="rounded-lg p-2 hover:bg-white/15"><X className="h-5 w-5" /></button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
        onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 0.25 : -0.25); }}
        onPointerDown={(event) => {
          if (scale <= 1) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY }, offset };
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          setOffset({
            x: active.offset.x + event.clientX - active.origin.x,
            y: active.offset.y + event.clientY - active.origin.y,
          });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <img
          src={photo.url}
          alt={photo.fileName}
          draggable={false}
          className={`max-h-full max-w-full select-none object-contain ${scale > 1 ? 'cursor-grab' : ''}`}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: 'center' }}
        />
        {photos.length > 1 ? <>
          <button type="button" onClick={() => move(-1)} aria-label="이전 사진" className="absolute left-2 rounded-full bg-black/55 p-2 text-white hover:bg-black/75"><ChevronLeft className="h-6 w-6" /></button>
          <button type="button" onClick={() => move(1)} aria-label="다음 사진" className="absolute right-2 rounded-full bg-black/55 p-2 text-white hover:bg-black/75"><ChevronRight className="h-6 w-6" /></button>
        </> : null}
      </div>

      <div className="flex h-16 shrink-0 items-center justify-center gap-2 bg-black/70 px-3 text-white">
        <button type="button" onClick={() => zoom(-0.5)} disabled={scale <= 1} aria-label="축소" className="rounded-xl bg-white/10 p-2 disabled:opacity-40"><ZoomOut className="h-5 w-5" /></button>
        <span className="w-14 text-center text-xs font-bold">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => zoom(0.5)} disabled={scale >= 5} aria-label="확대" className="rounded-xl bg-white/10 p-2 disabled:opacity-40"><ZoomIn className="h-5 w-5" /></button>
        <button type="button" onClick={resetView} aria-label="원본 크기" className="ml-2 rounded-xl bg-white/10 p-2"><Maximize2 className="h-5 w-5" /></button>
      </div>
    </div>
  );
};
