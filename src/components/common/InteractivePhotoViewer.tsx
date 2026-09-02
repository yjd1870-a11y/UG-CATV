import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  horizontalSwipeDirection,
  pinchView,
  pointCenter,
  pointDistance,
  zoomViewAt,
  type GesturePoint,
  type PanZoomView,
} from '../../shared/gestures/pan-zoom';

export type InteractiveViewerPhoto = {
  id: string;
  url: string;
  label: string;
};

type Props = {
  photos: InteractiveViewerPhoto[];
  initialIndex?: number;
  title: string;
  ariaLabel: string;
  onClose: () => void;
};

type Gesture =
  | { kind: 'pan'; pointerId: number; startPoint: GesturePoint; startView: PanZoomView }
  | { kind: 'swipe'; pointerId: number; startPoint: GesturePoint; lastPoint: GesturePoint }
  | { kind: 'pinch'; startCenter: GesturePoint; startDistance: number; startView: PanZoomView };

const defaultView: PanZoomView = { scale: 1, x: 0, y: 0 };

export const InteractivePhotoViewer: React.FC<Props> = ({
  photos,
  initialIndex = 0,
  title,
  ariaLabel,
  onClose,
}) => {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), Math.max(photos.length - 1, 0)));
  const [view, setView] = useState<PanZoomView>(defaultView);
  const viewRef = useRef<PanZoomView>(defaultView);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, GesturePoint>());
  const gestureRef = useRef<Gesture | null>(null);
  const photo = photos[index];

  const applyView = useCallback((next: PanZoomView) => {
    const normalized = next.scale <= 1 ? defaultView : next;
    viewRef.current = normalized;
    setView(normalized);
  }, []);

  const resetView = useCallback(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    applyView(defaultView);
  }, [applyView]);

  const move = useCallback((direction: -1 | 1) => {
    if (photos.length < 2) return;
    setIndex((current) => (current + direction + photos.length) % photos.length);
    resetView();
  }, [photos.length, resetView]);

  const zoomAt = useCallback((factor: number, point: GesturePoint = { x: 0, y: 0 }) => {
    applyView(zoomViewAt(viewRef.current, factor, point, 1, 5));
  }, [applyView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [move, onClose]);

  if (!photo) return null;

  const relativePoint = (clientX: number, clientY: number): GesturePoint => {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clientX - bounds.left - bounds.width / 2,
      y: clientY - bounds.top - bounds.height / 2,
    };
  };

  return (
    <div className="fixed inset-0 z-70 flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 bg-[#173B57] px-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="truncate text-[10px] text-blue-100">{photo.label} · {index + 1} / {photos.length}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="사진 확대 닫기" className="rounded-lg p-2 hover:bg-white/15"><X className="h-5 w-5" /></button>
      </div>

      <div
        ref={viewportRef}
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden touch-none select-none ${view.scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onWheel={(event) => {
          event.preventDefault();
          zoomAt(event.deltaY < 0 ? 1.18 : 0.84, relativePoint(event.clientX, event.clientY));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = relativePoint(event.clientX, event.clientY);
          pointersRef.current.set(event.pointerId, point);
          const points = [...pointersRef.current.values()];
          if (points.length >= 2) {
            gestureRef.current = {
              kind: 'pinch',
              startCenter: pointCenter(points[0], points[1]),
              startDistance: Math.max(pointDistance(points[0], points[1]), 1),
              startView: viewRef.current,
            };
          } else if (viewRef.current.scale > 1) {
            gestureRef.current = { kind: 'pan', pointerId: event.pointerId, startPoint: point, startView: viewRef.current };
          } else {
            gestureRef.current = { kind: 'swipe', pointerId: event.pointerId, startPoint: point, lastPoint: point };
          }
        }}
        onPointerMove={(event) => {
          if (!pointersRef.current.has(event.pointerId)) return;
          const point = relativePoint(event.clientX, event.clientY);
          pointersRef.current.set(event.pointerId, point);
          const gesture = gestureRef.current;
          const points = [...pointersRef.current.values()];
          if (gesture?.kind === 'pinch' && points.length >= 2) {
            applyView(pinchView(
              gesture.startView,
              gesture.startCenter,
              pointCenter(points[0], points[1]),
              pointDistance(points[0], points[1]) / gesture.startDistance,
              1,
              5,
            ));
          } else if (gesture?.kind === 'pan' && gesture.pointerId === event.pointerId) {
            applyView({
              ...gesture.startView,
              x: gesture.startView.x + point.x - gesture.startPoint.x,
              y: gesture.startView.y + point.y - gesture.startPoint.y,
            });
          } else if (gesture?.kind === 'swipe' && gesture.pointerId === event.pointerId) {
            gestureRef.current = { ...gesture, lastPoint: point };
          }
        }}
        onPointerUp={(event) => {
          const gesture = gestureRef.current;
          const point = pointersRef.current.get(event.pointerId) || relativePoint(event.clientX, event.clientY);
          pointersRef.current.delete(event.pointerId);
          if (gesture?.kind === 'swipe' && gesture.pointerId === event.pointerId) {
            const direction = horizontalSwipeDirection(gesture.startPoint, point);
            if (direction) move(direction);
          }
          const remaining = [...pointersRef.current.entries()];
          if (remaining.length === 1 && viewRef.current.scale > 1) {
            const [pointerId, startPoint] = remaining[0];
            gestureRef.current = { kind: 'pan', pointerId, startPoint, startView: viewRef.current };
          } else {
            gestureRef.current = null;
          }
        }}
        onPointerCancel={(event) => {
          pointersRef.current.delete(event.pointerId);
          gestureRef.current = null;
        }}
      >
        <div className="absolute left-1/2 top-1/2 will-change-transform" style={{ transform: `translate(${view.x}px, ${view.y}px)` }}>
          <img
            src={photo.url}
            alt={photo.label}
            draggable={false}
            className="max-h-[calc(100vh-7.5rem)] max-w-[100vw] -translate-x-1/2 -translate-y-1/2 object-contain will-change-transform"
            style={{ transform: `translate(-50%, -50%) scale(${view.scale})`, transformOrigin: 'center' }}
          />
        </div>

        {photos.length > 1 ? <>
          <button type="button" onClick={() => move(-1)} aria-label="이전 사진" className="absolute left-2 rounded-full bg-black/55 p-2 text-white hover:bg-black/75"><ChevronLeft className="h-6 w-6" /></button>
          <button type="button" onClick={() => move(1)} aria-label="다음 사진" className="absolute right-2 rounded-full bg-black/55 p-2 text-white hover:bg-black/75"><ChevronRight className="h-6 w-6" /></button>
        </> : null}
      </div>

      <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-center gap-2 bg-black/70 px-3 py-2 text-white">
        <button type="button" onClick={() => zoomAt(0.75)} disabled={view.scale <= 1} aria-label="축소" className="rounded-xl bg-white/10 p-2 disabled:opacity-40"><ZoomOut className="h-5 w-5" /></button>
        <span className="w-14 text-center text-xs font-bold">{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoomAt(1.25)} disabled={view.scale >= 5} aria-label="확대" className="rounded-xl bg-white/10 p-2 disabled:opacity-40"><ZoomIn className="h-5 w-5" /></button>
        <button type="button" onClick={resetView} aria-label="원본 크기" className="rounded-xl bg-white/10 p-2"><Maximize2 className="h-5 w-5" /></button>
        <span className="basis-full text-center text-[10px] text-slate-300 sm:basis-auto sm:pl-2">모바일: 두 손가락 확대 · 좌우 밀어 사진 전환 / PC: 마우스 휠 확대·축소</span>
      </div>
    </div>
  );
};
