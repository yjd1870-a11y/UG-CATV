import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Maximize2, Minimize2, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import type { CellInfo, CatvFloorPlanResult } from '../../types';
import { catvApi } from '../../features/cells/api';
import { apiResourceUrl, ApiClientError } from '../../shared/api/client';
import { pinchView, pointCenter, pointDistance, zoomViewAt, type GesturePoint, type PanZoomView } from '../../shared/gestures/pan-zoom';

interface FloorPlanViewerProps {
  cell?: CellInfo;
  stationName?: string;
  target?: string;
  type?: 'node' | 'rack';
  equipment?: string;
}

type Size = { width: number; height: number };

export const FloorPlanViewer: React.FC<FloorPlanViewerProps> = ({
  cell,
  stationName: suppliedStation,
  target = '',
  type: targetType = 'node',
  equipment = '',
}) => {
  const stationName = suppliedStation || cell?.stationDetails?.stationName || cell?.stationInfo || '';
  const [result, setResult] = useState<CatvFloorPlanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingPlanId, setSwitchingPlanId] = useState('');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [viewerSize, setViewerSize] = useState<Size>({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState<Size>({ width: 0, height: 0 });
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<PanZoomView>({ scale: 1, x: 0, y: 0 });
  const pointersRef = useRef(new Map<number, GesturePoint>());
  const gestureRef = useRef<{
    kind: 'pan' | 'pinch'; startView: PanZoomView; pointerId?: number; startPoint?: GesturePoint;
    startCenter?: GesturePoint; startDistance?: number;
  } | null>(null);

  const applyView = useCallback((view: PanZoomView) => {
    viewRef.current = view;
    setScale(view.scale);
    setOffset({ x: view.x, y: view.y });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setResult(null);
    catvApi.getFloorPlan(stationName, target, targetType as 'node' | 'rack', equipment)
      .then((data) => { if (active) setResult(data); })
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof ApiClientError && requestError.code === 'FLOOR_PLAN_NOT_FOUND') setError(requestError.message);
        else setError('국사 평면도를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [stationName, target, targetType, equipment]);

  const selectPlan = async (planId: string) => {
    if (!result || planId === result.floorPlan.id || switchingPlanId) return;
    setSwitchingPlanId(planId);
    setError('');
    try {
      setResult(await catvApi.getFloorPlan(stationName, target, targetType as 'node' | 'rack', equipment, planId));
    } catch {
      setError('선택한 도면을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSwitchingPlanId('');
    }
  };

  useEffect(() => {
    const element = viewerRef.current;
    if (!element) return;
    const updateSize = () => setViewerSize({ width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result, fullscreen]);

  useEffect(() => {
    applyView({ scale: 1, x: 0, y: 0 });
  }, [result, fullscreen, applyView]);

  const fittedSize = useMemo(() => {
    if (!viewerSize.width || !viewerSize.height || !imageSize.width || !imageSize.height) return { width: 0, height: 0 };
    const padding = fullscreen ? 24 : 16;
    const availableWidth = Math.max(1, viewerSize.width - padding * 2);
    const availableHeight = Math.max(1, viewerSize.height - padding * 2);
    const ratio = Math.min(availableWidth / imageSize.width, availableHeight / imageSize.height);
    return { width: imageSize.width * ratio, height: imageSize.height * ratio };
  }, [fullscreen, imageSize, viewerSize]);

  const resetView = () => {
    applyView({ scale: 1, x: 0, y: 0 });
  };

  const beginGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    gestureRef.current = points.length >= 2
      ? { kind: 'pinch', startView: viewRef.current, startCenter: pointCenter(points[0], points[1]), startDistance: pointDistance(points[0], points[1]) }
      : { kind: 'pan', startView: viewRef.current, pointerId: event.pointerId, startPoint: points[0] };
  };

  const moveGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    const points = [...pointersRef.current.values()];
    if (gesture?.kind === 'pinch' && points.length >= 2 && gesture.startCenter && gesture.startDistance) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const center = pointCenter(points[0], points[1]);
      applyView(pinchView(
        gesture.startView,
        { x: gesture.startCenter.x - bounds.left - bounds.width / 2, y: gesture.startCenter.y - bounds.top - bounds.height / 2 },
        { x: center.x - bounds.left - bounds.width / 2, y: center.y - bounds.top - bounds.height / 2 },
        pointDistance(points[0], points[1]) / gesture.startDistance,
        0.5,
        4,
      ));
    } else if (gesture?.kind === 'pan' && gesture.pointerId === event.pointerId && gesture.startPoint) {
      applyView({ ...gesture.startView, x: gesture.startView.x + event.clientX - gesture.startPoint.x, y: gesture.startView.y + event.clientY - gesture.startPoint.y });
    }
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    const remaining = [...pointersRef.current.entries()];
    if (remaining.length === 1) {
      gestureRef.current = { kind: 'pan', startView: viewRef.current, pointerId: remaining[0][0], startPoint: remaining[0][1] };
    } else if (!remaining.length) gestureRef.current = null;
  };

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-600">국사 평면도를 불러오는 중입니다.</div>;
  if (error) return <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm font-semibold text-amber-800">{error}</div>;
  if (!result) return null;

  const viewer = (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${fullscreen ? 'h-[calc(100vh-7rem)]' : 'h-[min(68vh,680px)] min-h-[320px] sm:min-h-[460px]'}`}>
      <div
        ref={viewerRef}
        className="relative h-full w-full cursor-grab touch-none bg-white active:cursor-grabbing"
        onPointerDown={beginGesture}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onWheel={(event) => {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          applyView(zoomViewAt(
            viewRef.current,
            event.deltaY < 0 ? 1.12 : 0.89,
            { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 },
            0.5,
            4,
          ));
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 select-none"
          style={{
            width: fittedSize.width || 'auto',
            height: fittedSize.height || 'auto',
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
            transformOrigin: 'center',
          }}
        >
          <img
            className="block h-full w-full rounded-lg bg-white object-contain shadow-2xl"
            draggable={false}
            src={apiResourceUrl(result.floorPlan.imageUrl)}
            alt={`${result.floorPlan.stationName} 국사 평면도`}
            onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          />
          {result.target ? (
            <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${result.target.xRatio * 100}%`, top: `${result.target.yRatio * 100}%` }}>
              <span className="absolute -inset-4 animate-ping rounded-full bg-red-500/60" />
              <span className="relative block h-5 w-5 rounded-full border-4 border-white bg-red-600 shadow-[0_0_0_3px_rgba(220,38,38,.65)]" />
              <span className="absolute left-1/2 top-7 min-w-max -translate-x-1/2 rounded-lg bg-red-700 px-2.5 py-1.5 text-center text-[11px] font-black text-white shadow-xl">
                {result.target.label}<small className="mt-0.5 block font-semibold text-red-100">{equipment || '선택 위치'}</small>
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className={fullscreen ? 'fixed inset-0 z-[70] overflow-auto bg-slate-100 p-3 sm:p-6' : 'space-y-3'}>
      <div className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#173B57]"><Building2 className="h-4 w-4" />{result.floorPlan.stationName} 국사 평면도</h2>
          <p className="mt-0.5 text-xs text-slate-500">{result.floorPlan.displayName} · {result.floorPlan.fileName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600" onClick={() => applyView(zoomViewAt(viewRef.current, .86, { x: 0, y: 0 }, .5, 4))} aria-label="축소"><ZoomOut className="h-4 w-4" /></button>
          <span className="min-w-12 text-center text-xs font-bold text-slate-600">{Math.round(scale * 100)}%</span>
          <button type="button" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600" onClick={() => applyView(zoomViewAt(viewRef.current, 1.16, { x: 0, y: 0 }, .5, 4))} aria-label="확대"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700" onClick={resetView}><RefreshCw className="h-4 w-4" />전체 맞춤</button>
          <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-[#173B57] px-2.5 py-2 text-xs font-bold text-white" onClick={() => setFullscreen((current) => !current)}>{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}{fullscreen ? '닫기' : '전체화면'}</button>
        </div>
      </div>
      {result.plans.length > 1 ? (
        <div className="flex max-w-full gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2" aria-label="국사 도면 선택">
          {result.plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              disabled={Boolean(switchingPlanId)}
              onClick={() => void selectPlan(plan.id)}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-extrabold transition ${plan.id === result.floorPlan.id ? 'bg-[#173B57] text-white shadow' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {switchingPlanId === plan.id ? '불러오는 중...' : plan.displayName}
            </button>
          ))}
        </div>
      ) : null}
      {result.matches.length > 1 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          “{target}” Rack이 여러 도면에 등록되어 있습니다. 위 도면 버튼을 눌러 위치를 확인해주세요.
        </div>
      ) : null}
      {viewer}
      {!result.target && target ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          {result.floorPlan.stationName} 평면도는 등록되어 있지만 “{target}” 위치 좌표가 없습니다. 전체 평면도를 확인하거나 DB 관리에서 좌표를 추가해주세요.
        </div>
      ) : null}
    </div>
  );
};
