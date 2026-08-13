import React, { useEffect, useMemo, useRef, useState } from 'react';
import type OpenSeadragon from 'openseadragon';
import { ArrowLeft, LocateFixed, Maximize2, Minimize2, RefreshCw, Search, ZoomIn, ZoomOut } from 'lucide-react';
import type { StraightMapMetadata, StraightMapSearchResult } from '../../types';
import { catvApi } from '../../features/cells/api';
import { ApiClientError } from '../../shared/api/client';

type Props = {
  searchKeys: Array<string | undefined>;
  stationName?: string;
  mapName?: string;
  mapNames?: Array<string | undefined>;
  matchLength?: 5 | 6;
  title?: string;
  onBack?: () => void;
};

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
  const [viewerReady, setViewerReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const openSeadragonRef = useRef<typeof OpenSeadragon | null>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);

  const runSearch = async (queries: string[], keepInput = false) => {
    setLoading(true);
    setMessage('');
    setResults([]);
    setSelected(null);
    setMetadata(null);
    try {
      let found: StraightMapSearchResult[] = [];
      let usedQuery = queries[0] || '';
      const eligibleQueries = queries.filter((candidate) => Array.from(candidate.replace(/\s+/g, '')).length >= effectiveMatchLength);
      for (const candidate of eligibleQueries) {
        const scopedMaps = candidateMaps.length ? candidateMaps : [''];
        const scopedResults = await Promise.all(scopedMaps.map((scope) => catvApi.searchStraightMap(candidate, stationName, scope, effectiveMatchLength)));
        found = [...new Map<string, StraightMapSearchResult>(scopedResults.flat().map((result) => [result.id, result])).values()]
          .sort((left, right) => left.matchRank - right.matchRank || left.label.length - right.label.length);
        if (found.length) { usedQuery = candidate; break; }
      }
      if (!keepInput) setQuery(usedQuery);
      if (!found.length) {
        setMessage('직선도에서 해당 위치를 찾을 수 없습니다.');
        return;
      }
      setResults(found);
      setSelected(found[0]);
    } catch {
      setMessage('직선도 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void runSearch(initialKeys); }, [keySignature, stationName, mapSignature, effectiveMatchLength]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setLoading(true);
    setMessage('');
    catvApi.getStraightMap(selected.mapId)
      .then((value) => { if (active) setMetadata(value); })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiClientError && error.code === 'STRAIGHT_MAP_PROCESSING') setMessage('직선도 지도를 생성 중입니다. 기존 ACTIVE 지도가 준비되면 자동으로 제공됩니다.');
        else if (error instanceof ApiClientError && error.code === 'STRAIGHT_MAP_NOT_FOUND') setMessage('등록된 직선도 지도가 없습니다.');
        else setMessage('직선도 지도를 불러오지 못했습니다.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected?.mapId]);

  useEffect(() => {
    if (!metadata || !containerRef.current) return;
    setViewerReady(false);
    viewerRef.current?.destroy();
    const tileSource = {
      width: metadata.width,
      height: metadata.height,
      tileSize: metadata.tileSize,
      minLevel: 0,
      maxLevel: metadata.maxZoom,
      getTileUrl: (level: number, x: number, y: number) => metadata.tileUrl
        .replace('{level}', String(level)).replace('{x}', String(x)).replace('{y}', String(y)),
    };
    let disposed = false;
    let viewer: OpenSeadragon.Viewer | null = null;
    void import('openseadragon').then(({ default: OpenSeadragonModule }) => {
      if (disposed || !containerRef.current) return;
      openSeadragonRef.current = OpenSeadragonModule;
      viewer = OpenSeadragonModule({
        element: containerRef.current,
        tileSources: tileSource,
        showNavigationControl: false,
        gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false, dblClickToZoom: true, pinchToZoom: true, flickEnabled: true },
        gestureSettingsTouch: { scrollToZoom: false, clickToZoom: false, dblClickToZoom: true, pinchToZoom: true, flickEnabled: true },
        animationTime: 0.5,
        blendTime: 0.15,
        // Limit blurry over-zoom while still allowing tiny Excel labels to
        // reach a readable on-screen size from the high-DPI tile pyramid.
        maxZoomPixelRatio: 2.25,
        visibilityRatio: 0.15,
        constrainDuringPan: true,
        immediateRender: false,
      });
      viewerRef.current = viewer;
      setViewerReady(true);
    });
    return () => {
      disposed = true;
      viewer?.destroy();
      viewerRef.current = null;
      markerRef.current = null;
    };
  }, [metadata]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !selected || !metadata) return;
    const focus = () => {
      if (!viewer.world.getItemCount()) return;
      if (markerRef.current) viewer.removeOverlay(markerRef.current);
      const marker = document.createElement('div');
      marker.className = 'straight-map-marker';
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', `${selected.label} 검색 위치`);
      marker.innerHTML = '<span class="straight-map-marker__pulse"></span><span class="straight-map-marker__dot"></span>';
      markerRef.current = marker;
      const point = viewer.viewport.imageToViewportCoordinates(selected.xRatio * metadata.width, selected.yRatio * metadata.height);
      viewer.addOverlay({ element: marker, location: point, placement: openSeadragonRef.current?.Placement.CENTER });
      const readableZoom = viewer.viewport.imageToViewportZoom(1.25);
      const targetZoom = Math.min(viewer.viewport.getMaxZoom(), Math.max(viewer.viewport.getHomeZoom() * 8, readableZoom));
      viewer.viewport.zoomTo(targetZoom, undefined, true);
      viewer.viewport.panTo(point, true);
      viewer.viewport.applyConstraints();
    };
    if (viewer.world.getItemCount()) focus(); else viewer.addOnceHandler('open', focus);
  }, [metadata, selected, viewerReady]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const timer = window.setTimeout(() => { viewer.viewport.resize(); viewer.viewport.applyConstraints(); }, 50);
    return () => window.clearTimeout(timer);
  }, [fullscreen]);

  const zoom = (factor: number) => {
    const viewport = viewerRef.current?.viewport;
    if (!viewport) return;
    viewport.zoomBy(factor);
    viewport.applyConstraints();
  };

  return (
    <div className={fullscreen ? 'fixed inset-0 z-[80] flex flex-col bg-slate-100 p-3 sm:p-5' : 'space-y-3'}>
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          {onBack ? <button type="button" onClick={onBack} className="rounded-lg p-2 text-[#173B57] hover:bg-slate-100" aria-label="직선도 닫기"><ArrowLeft className="h-4 w-4" /></button> : null}
          <div><h2 className="font-black text-[#173B57]">{title}</h2><p className="text-[11px] font-semibold text-slate-500">{stationName || metadata?.mapName || '고해상도 Excel 직선도'}</p></div>
        </div>
        <form className="flex min-w-0 flex-1 gap-2 sm:max-w-md" onSubmit={(event) => { event.preventDefault(); if (query.trim()) void runSearch([query.trim()], true); }}>
          <label className="sr-only" htmlFor="straight-map-search">직선도 검색</label>
          <input id="straight-map-search" value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#2878B5] focus:ring-2 focus:ring-blue-100" placeholder="직선도 검색" />
          <button type="submit" className="inline-flex h-10 items-center gap-1 rounded-xl bg-[#173B57] px-3 text-xs font-bold text-white"><Search className="h-4 w-4" />검색</button>
        </form>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => zoom(0.75)} className="rounded-lg border border-slate-200 p-2 text-slate-600" aria-label="축소"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" onClick={() => zoom(1.35)} className="rounded-lg border border-slate-200 p-2 text-slate-600" aria-label="확대"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" onClick={() => viewerRef.current?.viewport.goHome()} className="rounded-lg border border-slate-200 p-2 text-slate-600" aria-label="전체 지도 맞춤"><RefreshCw className="h-4 w-4" /></button>
          <button type="button" onClick={() => selected && setSelected({ ...selected })} className="rounded-lg border border-slate-200 p-2 text-orange-600" aria-label="검색 위치로 이동"><LocateFixed className="h-4 w-4" /></button>
          <button type="button" onClick={() => setFullscreen((value) => !value)} className="rounded-lg bg-[#173B57] p-2 text-white" aria-label={fullscreen ? '전체화면 닫기' : '전체화면'}>{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
        </div>
      </div>

      {results.length > 1 ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
          <p className="mb-2 text-xs font-extrabold text-orange-800">검색 결과 {results.length}개 · 이동할 위치를 선택하세요.</p>
          <div className="max-h-44 space-y-1.5 overflow-y-auto">{results.map((result) => (
            <button key={result.id} type="button" onClick={() => setSelected(result)} className={`flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-xs hover:border-orange-300 ${selected?.id === result.id ? 'border-orange-400 ring-1 ring-orange-200' : 'border-orange-100'}`}>
              <span><strong className="text-[#173B57]">{result.label}</strong><small className="ml-2 text-slate-500">{result.mapName}</small></span><span className="font-bold text-orange-600">이동</span>
            </button>
          ))}</div>
        </div>
      ) : null}

      <div className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white ${fullscreen ? 'min-h-0 flex-1' : 'h-[min(68vh,720px)] min-h-[360px]'}`}>
        <div ref={containerRef} className="h-full w-full touch-none bg-white" aria-label="직선도 지도" />
        {loading ? <div className="absolute inset-0 grid place-items-center bg-white/90 text-sm font-bold text-[#173B57]">직선도를 불러오는 중입니다.</div> : null}
        {!loading && message ? <div role="status" className="absolute inset-0 grid place-items-center bg-white p-6 text-center text-sm font-bold text-amber-700">{message}</div> : null}
      </div>
      {selected && metadata ? <div className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs shadow-sm"><strong className="text-orange-700">{selected.label}</strong><span className="ml-2 text-slate-500">{metadata.mapName} · 버전 {metadata.version}</span></div> : null}
    </div>
  );
};
