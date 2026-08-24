import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, LocateFixed, Maximize2, Minimize2, RefreshCw, Search, ZoomIn, ZoomOut } from 'lucide-react';
import type { StraightMapMetadata, StraightMapSearchResult } from '../../types';
import { catvApi } from '../../features/cells/api';
import { apiResourceUrl, ApiClientError } from '../../shared/api/client';
import { pinchView, pointCenter, pointDistance, zoomViewAt, type GesturePoint } from '../../shared/gestures/pan-zoom';

type Props = {
  searchKeys: Array<string | undefined>; stationName?: string; mapName?: string;
  mapNames?: Array<string | undefined>; matchLength?: 5 | 6; title?: string; onBack?: () => void;
};
type View = { scale: number; x: number; y: number };
type PdfLoadingTask = ReturnType<(typeof import('pdfjs-dist'))['getDocument']>;
type PdfDocument = Awaited<PdfLoadingTask['promise']>;
type LoadedPdf = { document: PdfDocument; loadingTask: PdfLoadingTask };

const uniqueKeys = (keys: Array<string | undefined>) => [...new Set(keys.map((key) => key?.trim()).filter((key): key is string => Boolean(key)))];
export const StraightMapViewer: React.FC<Props> = ({ searchKeys, stationName = '', mapName = '', mapNames = [], matchLength = 6, title = '직선도', onBack }) => {
  const effectiveMatchLength: 5 | 6 = matchLength === 5 ? 5 : 6;
  const keySignature = searchKeys.join('\u001f');
  const mapSignature = [mapName, ...mapNames].join('\u001f');
  const initialKeys = useMemo(() => uniqueKeys(keySignature.split('\u001f')), [keySignature]);
  const candidateMaps = useMemo(() => uniqueKeys(mapSignature.split('\u001f')), [mapSignature]);
  const [query, setQuery] = useState(initialKeys[0] || '');
  const [results, setResults] = useState<StraightMapSearchResult[]>([]);
  const [selected, setSelected] = useState<StraightMapSearchResult | null>(null);
  const [metadata, setMetadata] = useState<StraightMapMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [renderView, setRenderView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [publishedView, setPublishedView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [pdfReadyKey, setPdfReadyKey] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<LoadedPdf | null>(null);
  const viewRef = useRef<View>(view);
  const animationRef = useRef<number | null>(null);
  const pointersRef = useRef(new Map<number, GesturePoint>());
  const gestureRef = useRef<{
    kind: 'pan' | 'pinch'; startView: View; pointerId?: number; startPoint?: GesturePoint;
    startCenter?: GesturePoint; startDistance?: number;
  } | null>(null);

  const applyView = useCallback((next: View) => {
    viewRef.current = next;
    setView(next);
  }, []);
  const animateView = useCallback((target: View, duration = 160) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const start = viewRef.current;
    const startedAt = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      applyView({
        scale: start.scale + (target.scale - start.scale) * eased,
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
      });
      if (progress < 1) animationRef.current = requestAnimationFrame(frame);
      else animationRef.current = null;
    };
    animationRef.current = requestAnimationFrame(frame);
  }, [applyView]);

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setRenderView(view), 70);
    return () => window.clearTimeout(timer);
  }, [view]);

  const homeView = useCallback((map: StraightMapMetadata, size = canvasSize): View => {
    const scale = Math.max(0.01, Math.min(size.width / map.contentBounds.widthPoints, size.height / map.contentBounds.heightPoints) * 0.94);
    return { scale, x: (size.width - map.contentBounds.widthPoints * scale) / 2 - map.contentBounds.xPoints * scale,
      y: (size.height - map.contentBounds.heightPoints * scale) / 2 - map.contentBounds.yPoints * scale };
  }, [canvasSize]);
  const searchView = useCallback((map: StraightMapMetadata, result: StraightMapSearchResult, size = canvasSize): View => {
    const targetScale = Math.max(homeView(map, size).scale * 7, 1.25);
    return { scale: targetScale, x: size.width / 2 - result.worldXPoints * targetScale,
      y: size.height / 2 - result.worldYPoints * targetScale };
  }, [canvasSize, homeView]);

  const runSearch = async (queries: string[], keepInput = false) => {
    setLoading(true); setMessage(''); setResults([]); setSelected(null); setMetadata(null);
    try {
      let found: StraightMapSearchResult[] = []; let usedQuery = queries[0] || '';
      for (const candidate of queries.filter((value) => Array.from(value.replace(/\s+/g, '')).length >= effectiveMatchLength)) {
        const scopedResults = await Promise.all((candidateMaps.length ? candidateMaps : ['']).map((scope) => catvApi.searchStraightMap(candidate, stationName, scope, effectiveMatchLength)));
        found = [...new Map<string, StraightMapSearchResult>(scopedResults.flat().map((result) => [result.id, result] as const)).values()]
          .sort((left, right) => left.matchRank - right.matchRank || left.label.length - right.label.length);
        if (found.length) { usedQuery = candidate; break; }
      }
      if (!keepInput) setQuery(usedQuery);
      if (!found.length) { setMessage('직선도에서 해당 위치를 찾을 수 없습니다.'); return; }
      setResults(found); setSelected(found[0]);
    } catch { setMessage('직선도 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void runSearch(initialKeys); }, [keySignature, stationName, mapSignature, effectiveMatchLength]);
  useEffect(() => {
    if (!selected) return;
    let active = true; setLoading(true); setMessage('');
    catvApi.getStraightMap(selected.mapId).then((value) => { if (active) setMetadata(value); }).catch((error) => {
      if (!active) return;
      if (error instanceof ApiClientError && error.code === 'STRAIGHT_MAP_PROCESSING') setMessage('직선도 지도를 생성 중입니다.');
      else if (error instanceof ApiClientError && error.code === 'STRAIGHT_MAP_NOT_FOUND') setMessage('등록된 직선도 지도가 없습니다.');
      else setMessage('직선도 지도를 불러오지 못했습니다.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected?.mapId]);

  useEffect(() => {
    const element = containerRef.current; if (!element) return;
    const resize = () => setCanvasSize({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) });
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    return () => { window.document.body.style.overflow = previousOverflow; };
  }, [fullscreen]);

  useEffect(() => {
    if (!metadata) return;
    let disposed = false; setLoading(true);
    void import('pdfjs-dist').then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const loadingTask = pdfjs.getDocument({
        url: apiResourceUrl(metadata.pdfUrl),
        withCredentials: metadata.pdfRequiresCredentials,
        // R2 URLs are short-lived; download the compact vector PDF once so a
        // later pan does not depend on an expired range-request signature.
        disableRange: !metadata.pdfRequiresCredentials,
      });
      const document = await loadingTask.promise;
      if (disposed) { await loadingTask.destroy(); return; }
      pdfRef.current = { document, loadingTask };
      setPdfReadyKey(`${metadata.mapId}:${metadata.version}`);
      if (!selected) applyView(homeView(metadata));
      setLoading(false);
    }).catch(() => { if (!disposed) { setMessage('벡터 PDF를 불러오지 못했습니다.'); setLoading(false); } });
    return () => { disposed = true; setPdfReadyKey(''); const current = pdfRef.current; pdfRef.current = null; if (current) void current.loadingTask.destroy(); };
  }, [metadata?.mapId, metadata?.version]);

  useEffect(() => {
    if (!metadata || !selected || !pdfReadyKey || !canvasSize.width) return;
    applyView(searchView(metadata, selected));
  }, [metadata?.mapId, selected?.id, pdfReadyKey, canvasSize.width, canvasSize.height, searchView]);

  useEffect(() => {
    const canvas = canvasRef.current; const loadedPdf = pdfRef.current;
    if (!canvas || !loadedPdf || !metadata) return;
    const document = loadedPdf.document;
    let cancelled = false;
    let activeTask: { promise: Promise<void>; cancel: () => void } | null = null;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const pixelWidth = Math.ceil(canvasSize.width * dpr); const pixelHeight = Math.ceil(canvasSize.height * dpr);
    // Build a complete frame off-screen and publish it atomically. A pan,
    // zoom, resize, or search can cancel an older render without allowing
    // that stale render to clear the visible canvas after the newer frame.
    const frame = window.document.createElement('canvas'); frame.width = pixelWidth; frame.height = pixelHeight;
    const frameContext = frame.getContext('2d', { alpha: false }); if (!frameContext) return;
    frameContext.fillStyle = '#fff'; frameContext.fillRect(0, 0, pixelWidth, pixelHeight);
    // PDF.js clears its target canvas at the start of every page render. Draw
    // each visible page into a viewport-sized transparent scratch canvas and
    // composite it onto the shared map canvas so later pages do not erase the
    // earlier pages. The scratch canvas stays bounded to the visible viewport,
    // even at maximum zoom.
    const scratch = window.document.createElement('canvas'); scratch.width = pixelWidth; scratch.height = pixelHeight;
    const scratchContext = scratch.getContext('2d', { alpha: false }); if (!scratchContext) return;
    const visible = metadata.pagePlacements.filter((page) => {
      const left = renderView.x + page.xPoints * renderView.scale; const top = renderView.y + page.yPoints * renderView.scale;
      return left < canvasSize.width && top < canvasSize.height && left + page.widthPoints * renderView.scale > 0 && top + page.heightPoints * renderView.scale > 0;
    });
    void (async () => {
      for (const placement of visible) {
        if (cancelled) return;
        const page = await document.getPage(placement.pageIndex + 1);
        if (cancelled) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: renderView.scale * dpr });
        scratchContext.setTransform(1, 0, 0, 1, 0, 0); scratchContext.fillStyle = '#fff'; scratchContext.fillRect(0, 0, pixelWidth, pixelHeight);
        const task = page.render({ canvas: scratch, canvasContext: scratchContext, viewport,
          transform: [1, 0, 0, 1, (renderView.x + placement.xPoints * renderView.scale) * dpr, (renderView.y + placement.yPoints * renderView.scale) * dpr] });
        activeTask = task;
        try {
          await task.promise;
          if (cancelled) return;
          frameContext.save(); frameContext.globalCompositeOperation = 'multiply'; frameContext.drawImage(scratch, 0, 0); frameContext.restore();
        }
        finally { page.cleanup(); if (activeTask === task) activeTask = null; }
      }
      if (cancelled) return;
      canvas.width = pixelWidth; canvas.height = pixelHeight;
      canvas.style.width = `${canvasSize.width}px`; canvas.style.height = `${canvasSize.height}px`;
      const context = canvas.getContext('2d', { alpha: false }); if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0); context.drawImage(frame, 0, 0);
      setPublishedView(renderView);
    })().catch(() => { if (!cancelled) setMessage('현재 화면 영역을 렌더링하지 못했습니다.'); });
    return () => { cancelled = true; activeTask?.cancel(); };
  }, [metadata, renderView, canvasSize]);

  const zoomAt = (factor: number, centerX = canvasSize.width / 2, centerY = canvasSize.height / 2, smooth = true) => {
    const next = zoomViewAt(viewRef.current, factor, { x: centerX, y: centerY }, 0.01, 30);
    if (smooth) animateView(next); else applyView(next);
  };
  const beginGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
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
        { x: gesture.startCenter.x - bounds.left, y: gesture.startCenter.y - bounds.top },
        { x: center.x - bounds.left, y: center.y - bounds.top },
        pointDistance(points[0], points[1]) / gesture.startDistance,
        0.01,
        30,
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
  const markerStyle = selected ? { left: view.x + selected.worldXPoints * view.scale, top: view.y + selected.worldYPoints * view.scale } : undefined;
  const canvasTransformScale = view.scale / publishedView.scale;
  const canvasTransform = `translate(${view.x - publishedView.x * canvasTransformScale}px, ${view.y - publishedView.y * canvasTransformScale}px) scale(${canvasTransformScale})`;

  const viewer = (
    <div className={fullscreen ? 'fixed inset-0 z-[80] flex flex-col bg-slate-100 p-3 sm:p-5' : 'space-y-3'}>
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">{onBack ? <button type="button" onClick={onBack} className="rounded-lg p-2 text-[#173B57] hover:bg-slate-100" aria-label="직선도 닫기"><ArrowLeft className="h-4 w-4" /></button> : null}<div><h2 className="font-black text-[#173B57]">{title}</h2><p className="text-[11px] font-semibold text-slate-500">{stationName || metadata?.mapName || '벡터 PDF 직선도'}</p></div></div>
        <form className="flex min-w-0 flex-1 gap-2 sm:max-w-md" onSubmit={(event) => { event.preventDefault(); if (query.trim()) void runSearch([query.trim()], true); }}><label className="sr-only" htmlFor="straight-map-search">직선도 검색</label><input id="straight-map-search" value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#2878B5]" placeholder="직선도 검색" /><button type="submit" className="inline-flex h-10 items-center gap-1 rounded-xl bg-[#173B57] px-3 text-xs font-bold text-white"><Search className="h-4 w-4" />검색</button></form>
        <div className="flex items-center gap-1.5"><button type="button" onClick={() => zoomAt(0.84)} className="rounded-lg border border-slate-200 p-2" aria-label="축소"><ZoomOut className="h-4 w-4" /></button><button type="button" onClick={() => zoomAt(1.18)} className="rounded-lg border border-slate-200 p-2" aria-label="확대"><ZoomIn className="h-4 w-4" /></button><button type="button" onClick={() => metadata && animateView(homeView(metadata))} className="rounded-lg border border-slate-200 p-2" aria-label="전체 지도 맞춤"><RefreshCw className="h-4 w-4" /></button><button type="button" onClick={() => metadata && selected && animateView(searchView(metadata, selected))} className="rounded-lg border border-slate-200 p-2 text-orange-600" aria-label="검색 위치로 이동"><LocateFixed className="h-4 w-4" /></button><button type="button" onClick={() => setFullscreen((value) => !value)} className="rounded-lg bg-[#173B57] p-2 text-white" aria-label={fullscreen ? '전체화면 닫기' : '전체화면'}>{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button></div>
      </div>
      {results.length > 1 && !fullscreen ? <div className="max-h-36 overflow-y-auto rounded-xl border border-orange-200 bg-orange-50 p-2">{results.map((result) => <button key={result.id} type="button" onClick={() => setSelected(result)} className="m-1 rounded-lg border border-orange-100 bg-white px-3 py-2 text-xs"><strong>{result.label}</strong><span className="ml-2 text-slate-500">{result.mapName}</span></button>)}</div> : null}
      <div ref={containerRef} className={`relative touch-none overflow-hidden rounded-2xl border border-slate-200 bg-white ${fullscreen ? 'min-h-0 flex-1' : 'h-[min(68vh,720px)] min-h-[360px]'}`}
        onWheel={(event) => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); zoomAt(event.deltaY < 0 ? 1.18 : 0.84, event.clientX - bounds.left, event.clientY - bounds.top); }}
        onPointerDown={beginGesture}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}>
        <canvas ref={canvasRef} className="absolute inset-0 touch-none will-change-transform" style={{ transform: canvasTransform, transformOrigin: '0 0' }} aria-label="벡터 PDF 직선도 지도" />
        {markerStyle ? <div className="straight-map-marker pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={markerStyle}><span className="straight-map-marker__pulse"/><span className="straight-map-marker__dot"/></div> : null}
        {loading ? <div className="absolute inset-0 grid place-items-center bg-white/90 text-sm font-bold text-[#173B57]">직선도를 불러오는 중입니다.</div> : null}
        {!loading && message ? <div role="status" className="absolute inset-0 grid place-items-center bg-white p-6 text-center text-sm font-bold text-amber-700">{message}</div> : null}
      </div>
      {selected && metadata && !fullscreen ? <div className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs"><strong className="text-orange-700">{selected.label}</strong><span className="ml-2 text-slate-500">{metadata.mapName} · PDF v3 · 버전 {metadata.version}</span></div> : null}
    </div>
  );
  // Several application shells use transforms for mobile transitions, which
  // turn position:fixed into an ancestor-relative box. Portalling the viewer
  // to body makes fullscreen truly viewport-sized on desktop and mobile.
  return fullscreen ? createPortal(viewer, window.document.body) : viewer;
};
