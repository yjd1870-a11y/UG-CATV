import React, { useEffect, useState } from 'react';
import { MapPin, Pencil, Save, Trash2, Upload, X } from 'lucide-react';
import { adminDbApi, straightMapAdminApi, type AdminDbAsset } from '../../features/admin/api';
import { useApp } from '../../context/AppContext';
import { apiResourceUrl } from '../../shared/api/client';
import { parseB2CLineBookMatrix } from '../../utils/b2c-workbook';

const panelClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5';
const inputClass = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#2878B5] focus:ring-2 focus:ring-blue-100';
const secondaryButtonClass = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#2878B5] px-4 text-xs font-bold text-white transition hover:bg-[#1f6396] disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonClass = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50';

type Props = {
  type: 'floor_plan' | 'b2c';
  title: string;
  description: string;
  accept: string;
  icon: React.ReactNode;
  assets: AdminDbAsset[];
  activeStraightMapFilenames?: string[];
  onChanged: () => Promise<void>;
};

type CoordinatePoint = { label: string; xRatio: number; yRatio: number };

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return bytes.toLocaleString('ko-KR') + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
};

const readWorkbookRows = async (file: File) => {
  const XLSX = await import('@e965/xlsx');
  const csv = /\.csv$/i.test(file.name);
  const source = csv ? await file.text() : await file.arrayBuffer();
  const workbook = XLSX.read(source, csv ? { type: 'string', codepage: 65001 } : { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
};

const readB2CWorkbookRows = async (file: File) => {
  const XLSX = await import('@e965/xlsx');
  const csv = /\.csv$/i.test(file.name);
  const source = csv ? await file.text() : await file.arrayBuffer();
  const workbook = XLSX.read(source, csv ? { type: 'string', codepage: 65001 } : { type: 'array' });
  const records: Array<Record<string, unknown>> = [];
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false, blankrows: false });
    records.push(...parseB2CLineBookMatrix(sheetName, matrix));
  }
  if (!records.length) throw new Error('선번장 시트에서 D열 노드명, H열 코어, L~P열 검색 데이터를 찾지 못했습니다.');
  return records;
};

const parseCoordinates = (text: string): CoordinatePoint[] => {
  try {
    const parsed = text.trim() ? JSON.parse(text) as Record<string, Record<string, unknown>> : {};
    return Object.entries(parsed).flatMap(([key, point]) => {
      const kind = String(point?.type || point?.kind).toLowerCase();
      const rackName = String(point?.rackName || '').trim();
      if (kind && kind !== 'rack' && !rackName) return [];
      const xRatio = Number(point?.xRatio ?? point?.x);
      const yRatio = Number(point?.yRatio ?? point?.y);
      if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) return [];
      return [{
        label: rackName || String(point.label || key),
        xRatio: xRatio > 1 ? xRatio / 100 : xRatio,
        yRatio: yRatio > 1 ? yRatio / 100 : yRatio,
      }];
    });
  } catch {
    return [];
  }
};

const rackCoordinatesOnly = (input: Record<string, unknown>) => Object.fromEntries(
  parseCoordinates(JSON.stringify(input)).map((point) => [
    point.label,
    { label: point.label, rackName: point.label, type: 'rack', xRatio: point.xRatio, yRatio: point.yRatio },
  ])
);

const adminStationKey = (value: string) => {
  let key = value.trim().toLowerCase()
    .replace(/\.(xlsx|xls|png|jpe?g|webp)$/i, '')
    .replace(/[()[\]{}]/g, '')
    .replace(/평면도/g, '')
    .replace(/\s+/g, '')
    .replace(/[_/\\:>]+$/g, '');
  if (key.endsWith('국사') && key.length > 2) key = key.slice(0, -2);
  return key.split(/[_/\\:>]+/).filter(Boolean).at(-1) || key;
};

export const AdminAssetSection: React.FC<Props> = ({ type, title, description, accept, icon, assets, activeStraightMapFilenames = [], onChanged }) => {
  const { showToast } = useApp();
  const [stationName, setStationName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [coordinateText, setCoordinateText] = useState('');
  const [coordinateLabel, setCoordinateLabel] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AdminDbAsset | null>(null);

  useEffect(() => {
    if (file?.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(editingAsset?.imageUrl ? apiResourceUrl(editingAsset.imageUrl) : '');
  }, [editingAsset, file]);

  const resetEditor = () => {
    setEditingAsset(null);
    setStationName('');
    setFile(null);
    setCoordinateText('');
    setCoordinateLabel('');
  };

  const edit = (asset: AdminDbAsset) => {
    setEditingAsset(asset);
    setStationName(asset.stationName);
    setFile(null);
    setCoordinateLabel('');
    try {
      const coordinates = asset.coordinatesJson ? JSON.parse(asset.coordinatesJson) : {};
      setCoordinateText(JSON.stringify(rackCoordinatesOnly(coordinates), null, 2));
    } catch {
      setCoordinateText('{}');
    }
    showToast(`${asset.stationName} ${asset.displayName || '도면'} 수정 모드를 열었습니다.`, 'info');
  };

  const save = async () => {
    if (!stationName.trim() || (!file && !editingAsset)) {
      showToast('국사명과 파일을 선택해주세요.', 'warning');
      return;
    }
    const duplicateStraightMapUpload = Boolean(file && type === 'b2c' && /\.xlsx$/i.test(file.name)
      && activeStraightMapFilenames.some((name) => name.localeCompare(file.name, undefined, { sensitivity: 'accent' }) === 0));
    if (duplicateStraightMapUpload) {
      showToast('같은 이름의 직선도 파일이 이미 업로드 또는 렌더링 중입니다. 기존 작업이 끝난 뒤 다시 시도해주세요.', 'warning');
      return;
    }
    setSaving(true);
    try {
      let records: Array<Record<string, unknown>> = [];
      if (file && type === 'b2c') records = await readB2CWorkbookRows(file);
      else if (file && /\.(xlsx|xls|csv)$/i.test(file.name)) records = await readWorkbookRows(file);
      else if (file) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        records = [{ imageDataUrl: dataUrl }];
      }
      let coordinates: Record<string, unknown> = {};
      if (coordinateText.trim()) coordinates = rackCoordinatesOnly(JSON.parse(coordinateText) as Record<string, unknown>);
      const straightMapJob = !editingAsset && file && type === 'b2c' && /\.xlsx$/i.test(file.name)
        ? await straightMapAdminApi.upload(file, stationName.trim())
        : null;
      if (editingAsset) {
        await adminDbApi.updateAsset(editingAsset.id, {
          stationName: stationName.trim(),
          fileName: file?.name,
          fileSize: file?.size,
          mimeType: file?.type,
          records,
          coordinates,
        });
      } else if (file) {
        await adminDbApi.saveAsset({
          dbType: type,
          stationName: stationName.trim(),
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          records,
          coordinates,
        });
        if (straightMapJob) showToast(`XLSX를 R2에 직접 업로드했습니다. 작업 ${straightMapJob.jobId.slice(0, 8)}은 사무실 렌더러 실행을 기다립니다.`, 'info');
      }
      const completedAction = editingAsset ? '수정' : '등록';
      resetEditor();
      showToast(`${title} ${completedAction}이 완료되었습니다.`, 'success');
      await onChanged();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '파일을 등록하지 못했습니다.', 'error');
      await onChanged().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('선택한 DB 파일을 삭제하시겠습니까?')) return;
    await adminDbApi.deleteAsset(id);
    showToast('DB 파일을 삭제했습니다.', 'success');
    await onChanged();
  };

  const clear = async () => {
    if (!assets.length || !window.confirm(`${title} 전체를 삭제하시겠습니까?`)) return;
    await adminDbApi.clearAssets(type);
    showToast(`${title} 전체를 삭제했습니다.`, 'success');
    await onChanged();
  };

  const coordinatePoints = parseCoordinates(coordinateText);
  const duplicateStraightMapUpload = Boolean(file && type === 'b2c' && /\.xlsx$/i.test(file.name)
    && activeStraightMapFilenames.some((name) => name.localeCompare(file.name, undefined, { sensitivity: 'accent' }) === 0));
  const stationPlanCount = type === 'floor_plan' && stationName.trim()
    ? assets.filter((asset) => adminStationKey(asset.stationName) === adminStationKey(stationName)).length
    : 0;
  const floorPlanLimitReached = type === 'floor_plan' && !editingAsset && stationPlanCount >= 3;
  const removeCoordinate = (label: string) => {
    try {
      const current = coordinateText.trim() ? JSON.parse(coordinateText) as Record<string, unknown> : {};
      const key = Object.keys(current).find((candidate) => {
        const point = current[candidate] as Record<string, unknown> | undefined;
        return candidate === label || String(point?.label || '') === label;
      });
      if (key) delete current[key];
      setCoordinateText(JSON.stringify(current, null, 2));
    } catch {
      showToast('좌표 JSON 형식을 확인해주세요.', 'error');
    }
  };

  return (
    <section className={panelClass}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex gap-2.5">
          <span className="mt-0.5 text-[#2878B5]">{icon}</span>
          <div><h2 className="font-extrabold text-[#173B57]">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div>
        </div>
        <button type="button" className={dangerButtonClass} disabled={!assets.length} onClick={() => void clear()}><Trash2 className="h-3.5 w-3.5" /> 전체 삭제</button>
      </div>
      {editingAsset ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs">
          <span className="font-bold text-orange-700"><Pencil className="mr-1.5 inline h-4 w-4" />{editingAsset.stationName} {editingAsset.displayName || '도면'} 수정 중 · 파일을 바꾸지 않아도 Rack 좌표만 수정할 수 있습니다.</span>
          <button type="button" className={secondaryButtonClass} onClick={resetEditor}><X className="h-3.5 w-3.5" /> 수정 취소</button>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold text-slate-600">국사명<input className={`${inputClass} mt-1.5`} value={stationName} onChange={(event) => setStationName(event.target.value)} placeholder="예: 안성국사" /></label>
        <label className="text-xs font-bold text-slate-600 lg:col-span-2">{editingAsset ? '새 평면도 파일 (선택)' : '파일'}<input key={editingAsset?.id || 'new-asset'} className="mt-1.5 block h-10 w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs" type="file" accept={accept} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        <button type="button" className={`${primaryButtonClass} self-end`} disabled={saving || duplicateStraightMapUpload || floorPlanLimitReached} onClick={() => void save()}>{editingAsset ? <Save className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {saving ? '저장 중...' : duplicateStraightMapUpload ? '동일 파일 업로드 중' : floorPlanLimitReached ? '도면 3장 등록 완료' : editingAsset ? '수정 저장' : '신규 등록'}</button>
      </div>
      {floorPlanLimitReached ? <p className="mt-2 text-xs font-semibold text-amber-700">{stationName.trim()}에는 도면이 3장 등록되어 있습니다. 기존 도면을 수정하거나 삭제한 뒤 추가해주세요.</p> : null}
      {type === 'floor_plan' && previewUrl ? (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/30 p-3">
          <input className={`${inputClass} mb-2`} value={coordinateLabel} onChange={(event) => setCoordinateLabel(event.target.value)} placeholder="표시할 Rack 번호" />
          <p className="mb-3 text-[11px] font-semibold text-slate-600">Rack 번호를 입력한 뒤 이미지의 해당 위치를 클릭하세요. 등록된 Rack 좌표는 이미지 위 마커와 아래 목록에서 확인할 수 있습니다.</p>
          <div className="overflow-auto rounded-xl border border-slate-200 bg-slate-100 p-2 text-center">
            <div className="relative inline-block max-w-full align-top">
              <img src={previewUrl} alt="평면도 좌표 지정 미리보기" className="block max-h-[560px] max-w-full cursor-crosshair rounded-lg bg-white object-contain" onClick={(event) => {
                if (!coordinateLabel.trim()) { showToast('먼저 Rack 번호를 입력해주세요.', 'warning'); return; }
                let current: Record<string, unknown> = {};
                try { current = coordinateText.trim() ? JSON.parse(coordinateText) as Record<string, unknown> : {}; } catch { showToast('좌표 JSON 형식을 먼저 확인해주세요.', 'error'); return; }
                const rect = event.currentTarget.getBoundingClientRect();
                const xRatio = Number(((event.clientX - rect.left) / rect.width).toFixed(6));
                const yRatio = Number(((event.clientY - rect.top) / rect.height).toFixed(6));
                current[coordinateLabel.trim()] = { label: coordinateLabel.trim(), rackName: coordinateLabel.trim(), type: 'rack', xRatio, yRatio };
                setCoordinateText(JSON.stringify(current, null, 2));
                setCoordinateLabel('');
                showToast(`Rack ${coordinateLabel.trim()} 위치를 저장했습니다.`, 'success');
              }} />
              {coordinatePoints.map((point) => (
                <span key={`${point.label}-${point.xRatio}-${point.yRatio}`} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${point.xRatio * 100}%`, top: `${point.yRatio * 100}%` }}>
                  <span className="block h-5 w-5 rounded-full border-4 border-white bg-red-600 shadow-[0_0_0_2px_rgba(23,59,87,.7)]" />
                  <span className="absolute bottom-6 left-1/2 min-w-max -translate-x-1/2 rounded bg-[#173B57] px-2 py-0.5 text-[10px] font-black text-white shadow">{point.label}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-extrabold text-[#173B57]"><MapPin className="h-4 w-4" />등록 Rack 좌표 {coordinatePoints.length}개</div>
            {coordinatePoints.length ? (
              <div className="flex flex-wrap gap-2">{coordinatePoints.map((point) => (
                <span key={`chip-${point.label}`} className="inline-flex items-center overflow-hidden rounded-full border border-slate-300 bg-white text-xs font-bold text-[#173B57]">
                  <span className="px-3 py-1.5">{point.label}</span>
                  <button type="button" onClick={() => removeCoordinate(point.label)} className="border-l border-slate-200 bg-red-50 px-2 py-1.5 text-red-600" aria-label={`${point.label} 좌표 삭제`}><X className="h-3 w-3" /></button>
                </span>
              ))}</div>
            ) : <p className="rounded-lg bg-white p-3 text-center text-[11px] text-slate-400">아직 지정된 Rack 좌표가 없습니다.</p>}
          </div>
        </div>
      ) : null}
      <div className="mt-4 space-y-2">
        {assets.length ? assets.map((asset) => {
          const savedPoints = parseCoordinates(asset.coordinatesJson || '');
          return (
            <div key={asset.id} className={`rounded-xl border p-3 text-xs ${editingAsset?.id === asset.id ? 'border-orange-300 bg-orange-50/50' : 'border-slate-100 bg-slate-50'}`}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div><strong className="text-[#173B57]">{asset.stationName}{type === 'floor_plan' ? ` · ${asset.displayName || `도면 ${asset.planOrder || 1}`}` : ''}</strong><p className="mt-1 text-slate-500">{asset.fileName} · {formatBytes(asset.fileSize)} · Rack 좌표 {savedPoints.length}개 · {formatDate(asset.updatedAt || asset.uploadedAt)}</p></div>
                <div className="flex gap-2">
                  {type === 'floor_plan' ? <button type="button" className={secondaryButtonClass} onClick={() => edit(asset)}><Pencil className="h-3.5 w-3.5" /> 수정</button> : null}
                  <button type="button" className={dangerButtonClass} onClick={() => void remove(asset.id)}><Trash2 className="h-3.5 w-3.5" /> 삭제</button>
                </div>
              </div>
            </div>
          );
        }) : <p className="rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-400">등록된 파일이 없습니다.</p>}
      </div>
    </section>
  );
};
