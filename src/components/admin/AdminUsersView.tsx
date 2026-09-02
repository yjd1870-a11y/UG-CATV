import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Cable,
  Database,
  FileSpreadsheet,
  History,
  KeyRound,
  LockKeyhole,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRoundCog,
  X,
} from 'lucide-react';
import * as XLSX from '@e965/xlsx';
import { parseB2CLineBookMatrix } from '../../utils/b2c-workbook';
import {
  adminApi,
  adminDbApi,
  straightMapAdminApi,
  type AdminCellRecord,
  type AdminDbAsset,
  type AdminUser,
  type CellImportRecord,
  type DbUploadHistory,
  type DbUploadValidation,
  type StraightMapJob,
} from '../../features/admin/api';
import { cellsApi } from '../../features/cells/api';
import { useApp } from '../../context/AppContext';
import { apiResourceUrl } from '../../shared/api/client';
import {
  isValidPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '../../shared/auth/password-policy';

const panelClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5';
const inputClass = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#2878B5] focus:ring-2 focus:ring-blue-100';
const secondaryButtonClass = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#2878B5] px-4 text-xs font-bold text-white transition hover:bg-[#1f6396] disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonClass = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50';

const cellColumnDefinitions = [
  { field: 'keyNumber', label: '키번호', aliases: ['키번호', 'keyNumber'] },
  { field: 'cellName', label: '셀명', aliases: ['셀명', 'CELL명', 'cellName'] },
  { field: 'stationName', label: '국사명', aliases: ['국사명', 'stationName'] },
  { field: 'stationAddress', label: '국사주소', aliases: ['국사주소', 'stationAddress'] },
  { field: 'otxNode', label: 'OTX 노드', aliases: ['OTX 노드', 'otxNode'] },
  { field: 'otxLineNumber', label: 'OTX 선번', aliases: ['OTX 선번', 'otxLineNumber'] },
  { field: 'orxNode', label: 'ORX 노드', aliases: ['ORX 노드', 'orxNode'] },
  { field: 'orxLineNumber', label: 'ORX 선번', aliases: ['ORX 선번', 'orxLineNumber'] },
  { field: 'spareNode', label: '예비 노드', aliases: ['예비 노드', 'spareNode'] },
  { field: 'spareLineNumber', label: '예비 선번', aliases: ['예비 선번', 'spareLineNumber'] },
  { field: 'otxRack', label: 'OTX 렉', aliases: ['OTX 렉', 'otxRack'] },
  { field: 'otxShelf', label: 'OTX 쉘프', aliases: ['OTX 쉘프', 'otxShelf'] },
  { field: 'otxPort', label: 'OTX 포트', aliases: ['OTX 포트', 'otxPort'] },
  { field: 'otxModel', label: 'OTX 모델명', aliases: ['OTX 모델명', 'otxModel'] },
  { field: 'orxRack', label: 'ORX 렉', aliases: ['ORX 렉', 'orxRack'] },
  { field: 'orxShelf', label: 'ORX 쉘프', aliases: ['ORX 쉘프', 'orxShelf'] },
  { field: 'orxPort', label: 'ORX 포트', aliases: ['ORX 포트', 'orxPort'] },
  { field: 'orxModel', label: 'ORX 모델명', aliases: ['ORX 모델명', 'orxModel'] },
  { field: 'onuLocation', label: 'ONU 위치', aliases: ['ONU 위치', 'onuLocation'] },
  { field: 'onuPhoto', label: 'ONU 현장사진', aliases: ['ONU 현장사진', 'onuPhoto'] },
  { field: 'onuPhotoList', label: 'ONU 현장사진목록', aliases: ['ONU 현장사진목록', 'onuPhotoList'] },
  { field: 'onuManufacturer', label: 'ONU 제조사', aliases: ['ONU 제조사', 'onuManufacturer'] },
  { field: 'onuModel', label: 'ONU 모델명', aliases: ['ONU 모델명', 'onuModel'] },
  { field: 'onuDivision', label: 'ONU 분할구분', aliases: ['ONU 분할구분', 'onuDivision'] },
  { field: 'onuCellConfig', label: 'ONU 셀구성', aliases: ['ONU 셀구성', 'onuCellConfig'] },
  { field: 'upsLocation', label: 'UPS 위치', aliases: ['UPS 위치', 'upsLocation'] },
  { field: 'upsPhoto', label: 'UPS 현장사진', aliases: ['UPS 현장사진', 'upsPhoto'] },
  { field: 'upsPhotoList', label: 'UPS 현장사진목록', aliases: ['UPS 현장사진목록', 'upsPhotoList'] },
  { field: 'upsManufacturer', label: 'UPS 제조사', aliases: ['UPS 제조사', 'upsManufacturer'] },
  { field: 'upsModel', label: 'UPS 모델명', aliases: ['UPS 모델명', 'upsModel'] },
  { field: 'notes', label: '비고', aliases: ['비고', 'notes', 'remarks'] },
] as const;

type CellField = typeof cellColumnDefinitions[number]['field'];

const cellEditorSections: Array<{ title: string; fields: CellField[] }> = [
  { title: '기본 정보', fields: ['keyNumber', 'cellName', 'stationName', 'stationAddress'] },
  { title: '노드 및 선번', fields: ['otxNode', 'otxLineNumber', 'orxNode', 'orxLineNumber', 'spareNode', 'spareLineNumber'] },
  { title: '송수신기 정보', fields: ['otxRack', 'otxShelf', 'otxPort', 'otxModel', 'orxRack', 'orxShelf', 'orxPort', 'orxModel'] },
  { title: 'ONU 정보', fields: ['onuLocation', 'onuPhoto', 'onuPhotoList', 'onuManufacturer', 'onuModel', 'onuDivision', 'onuCellConfig'] },
  { title: 'UPS 정보', fields: ['upsLocation', 'upsPhoto', 'upsPhotoList', 'upsManufacturer', 'upsModel'] },
  { title: '기타', fields: ['notes'] },
];

type AccountRole = 'manager' | 'guest' | 'public_official' | 'team_leader' | 'admin';
const accountRoleOptions: Array<{ value: AccountRole; label: string }> = [
  { value: 'manager', label: '매니져' },
  { value: 'guest', label: '게스트' },
  { value: 'public_official', label: '공무' },
  { value: 'team_leader', label: '팀장' },
  { value: 'admin', label: '관리자' },
];
const emptyAccount = { username: '', zone: '', name: '', role: 'manager' as AccountRole, password: '', passwordConfirm: '' };
const emptyCellRecord = Object.fromEntries(cellColumnDefinitions.map(({ field }) => [field, ''])) as CellImportRecord;
const emptyCell: AdminCellRecord = { id: '', ...emptyCellRecord, status: '정상', updatedAt: '' };

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

const firstValue = (row: Record<string, unknown>, aliases: readonly string[]) => {
  const key = aliases.find((candidate) => Object.prototype.hasOwnProperty.call(row, candidate));
  return key ? String(row[key] ?? '').replace(/_x000D_/gi, '').trim() : '';
};

const readWorkbookRows = async (file: File) => {
  const csv = /\.csv$/i.test(file.name);
  const source = csv ? await file.text() : await file.arrayBuffer();
  const workbook = XLSX.read(source, csv ? { type: 'string', codepage: 65001 } : { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
};

const readB2CWorkbookRows = async (file: File) => {
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

const normalizeCellRows = (rows: Array<Record<string, unknown>>): CellImportRecord[] => {
  if (!rows.length) return [];
  const missingColumns = cellColumnDefinitions
    .filter(({ aliases }) => !aliases.some((alias) => Object.prototype.hasOwnProperty.call(rows[0], alias)))
    .map(({ label }) => label);
  if (missingColumns.length) {
    throw new Error('Excel 필수 열이 누락되었습니다: ' + missingColumns.join(', '));
  }
  return rows.flatMap((row) => {
    const record = Object.fromEntries(
      cellColumnDefinitions.map(({ field, aliases }) => [field, firstValue(row, aliases)])
    ) as CellImportRecord;
    return record.keyNumber && record.cellName ? [record] : [];
  });
};

const cellRegion = (record: CellImportRecord) =>
  record.stationName.split('_')[0]?.trim() || record.stationName.replace(/국사$/, '').trim() || '미지정';

const toCellPayload = (record: CellImportRecord) => ({
  ...record,
  cellName: record.cellName,
  cellCode: record.keyNumber,
  nodeName: record.otxNode || '미지정',
  lineCode: record.otxLineNumber || record.keyNumber,
  stationInfo: record.stationName,
  address: record.onuLocation || record.stationAddress,
  region: cellRegion(record),
  status: '정상',
  responsibleTeam: cellRegion(record),
  memo: record.notes,
});

const exportCellRow = (record: CellImportRecord) => Object.fromEntries(
  cellColumnDefinitions.map(({ field, label }) => [label, record[field]])
);

type AssetSectionProps = {
  type: 'floor_plan' | 'b2c';
  title: string;
  description: string;
  accept: string;
  icon: React.ReactNode;
  assets: AdminDbAsset[];
  activeStraightMapFilenames?: string[];
  onChanged: () => Promise<void>;
};

const formatDuration = (milliseconds: number) => {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '-';
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}분 ${seconds % 60}초`;
};

const straightMapMetrics = (value: string) => {
  try { return JSON.parse(value || '{}') as Record<string, number>; }
  catch { return {}; }
};

type CoordinatePoint = { label: string; xRatio: number; yRatio: number };

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

const AssetSection: React.FC<AssetSectionProps> = ({ type, title, description, accept, icon, assets, activeStraightMapFilenames = [], onChanged }) => {
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
      {type === 'floor_plan' ? (
        <div className="mt-3 space-y-3">
          {previewUrl ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-3">
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

export const AdminUsersView: React.FC = () => {
  const { currentUser, showToast, reloadBusinessData, navigateTo } = useApp();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [history, setHistory] = useState<DbUploadHistory[]>([]);
  const [floorPlans, setFloorPlans] = useState<AdminDbAsset[]>([]);
  const [b2cAssets, setB2cAssets] = useState<AdminDbAsset[]>([]);
  const [dbCounts, setDbCounts] = useState({ accounts: 0, cells: 0, floorPlans: 0, b2c: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState(emptyAccount);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPasswords, setResetPasswords] = useState({ password: '', confirm: '' });
  const [cellSearch, setCellSearch] = useState('');
  const [adminCells, setAdminCells] = useState<AdminCellRecord[]>([]);
  const [cellPage, setCellPage] = useState(1);
  const [cellPagination, setCellPagination] = useState({ page: 1, limit: 100, total: 0, totalPages: 0 });
  const [cellListLoading, setCellListLoading] = useState(false);
  const [cellDraft, setCellDraft] = useState(emptyCell);
  const [cellEditorOpen, setCellEditorOpen] = useState(false);
  const [cellFile, setCellFile] = useState<File | null>(null);
  const [cellRecords, setCellRecords] = useState<CellImportRecord[]>([]);
  const [cellValidation, setCellValidation] = useState<DbUploadValidation | null>(null);
  const [cellUploadBusy, setCellUploadBusy] = useState(false);
  const [uploadResult, setUploadResult] = useState<DbUploadHistory | null>(null);
  const [straightMapJobs, setStraightMapJobs] = useState<StraightMapJob[]>([]);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userRows, status, historyRows, floorRows, b2cRows, jobRows] = await Promise.all([
        adminApi.users(),
        adminDbApi.status(),
        adminDbApi.history(),
        adminDbApi.assets('floor_plan'),
        adminDbApi.assets('b2c'),
        straightMapAdminApi.jobs(),
      ]);
      setUsers(userRows);
      setDbCounts(status.counts);
      setHistory(historyRows);
      setFloorPlans(floorRows);
      setB2cAssets(b2cRows);
      setStraightMapJobs(jobRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '관리자 DB를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdminCells = useCallback(async (query = '', page = 1) => {
    setCellListLoading(true);
    try {
      const result = await adminDbApi.cells(query, page, 100);
      setAdminCells(result.items);
      setCellPagination(result.pagination);
      setCellPage(result.pagination.page);
    } catch (loadError) {
      showToast(loadError instanceof Error ? loadError.message : 'CELL DB를 불러오지 못했습니다.', 'error');
    } finally {
      setCellListLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void loadAdminData(); }, [loadAdminData]);
  useEffect(() => {
    if (!straightMapJobs.some((job) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status))) return;
    const timer = window.setInterval(() => void straightMapAdminApi.jobs().then(setStraightMapJobs), 15_000);
    return () => window.clearInterval(timer);
  }, [straightMapJobs]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadAdminCells(cellSearch, 1), 300);
    return () => window.clearTimeout(timer);
  }, [cellSearch, loadAdminCells]);
  if (currentUser?.role !== 'admin') {
    return <div className="rounded-2xl border border-red-100 bg-white p-8 text-center text-sm text-red-700">관리자만 접근할 수 있습니다.</div>;
  }

  const refreshAll = async () => {
    await Promise.all([
      loadAdminData(),
      loadAdminCells(cellSearch, cellPage),
      reloadBusinessData(),
    ]);
  };

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidPassword(account.password)) return showToast(PASSWORD_POLICY_MESSAGE, 'warning');
    if (account.password !== account.passwordConfirm) return showToast('비밀번호 확인이 일치하지 않습니다.', 'warning');
    try {
      await adminApi.create({ username: account.username, zone: account.zone, name: account.name, role: account.role, password: account.password });
      setAccount(emptyAccount);
      setAccountOpen(false);
      showToast('계정을 생성했습니다.', 'success');
      await loadAdminData();
    } catch (createError) {
      showToast(createError instanceof Error ? createError.message : '계정을 생성하지 못했습니다.', 'error');
    }
  };

  const updateUserStatus = async (user: AdminUser) => {
    try {
      if (user.status === 'pending') await adminApi.approve(user.id);
      else if (user.status === 'disabled') await adminApi.enable(user.id);
      else await adminApi.disable(user.id);
      showToast('계정 상태를 변경했습니다.', 'success');
      await loadAdminData();
    } catch (updateError) {
      showToast(updateError instanceof Error ? updateError.message : '계정 상태를 변경하지 못했습니다.', 'error');
    }
  };

  const updateUserRole = async (user: AdminUser, role: AccountRole) => {
    try {
      await adminApi.updateRole(user.id, role);
      showToast(`${user.name} 계정 권한을 변경했습니다.`, 'success');
      await loadAdminData();
    } catch (updateError) {
      showToast(updateError instanceof Error ? updateError.message : '계정 권한을 변경하지 못했습니다.', 'error');
    }
  };

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetTarget) return;
    if (!isValidPassword(resetPasswords.password)) return showToast(PASSWORD_POLICY_MESSAGE, 'warning');
    if (resetPasswords.password !== resetPasswords.confirm) return showToast('비밀번호 확인이 일치하지 않습니다.', 'warning');
    try {
      await adminApi.resetPassword(resetTarget.id, resetPasswords.password);
      setResetTarget(null);
      setResetPasswords({ password: '', confirm: '' });
      showToast('비밀번호를 재설정했습니다.', 'success');
      await loadAdminData();
    } catch (resetError) {
      showToast(resetError instanceof Error ? resetError.message : '비밀번호를 재설정하지 못했습니다.', 'error');
    }
  };

  const removeUser = async (user: AdminUser) => {
    if (!window.confirm(`${user.username} 계정을 삭제하시겠습니까?`)) return;
    try {
      await adminApi.remove(user.id);
      showToast('계정을 삭제했습니다.', 'success');
      await loadAdminData();
    } catch (removeError) {
      showToast(removeError instanceof Error ? removeError.message : '계정을 삭제하지 못했습니다.', 'error');
    }
  };

  const prepareCellFile = async (file: File | null) => {
    setCellFile(file);
    setCellRecords([]);
    setCellValidation(null);
    setUploadResult(null);
    if (!file) return;
    setCellUploadBusy(true);
    try {
      const records = normalizeCellRows(await readWorkbookRows(file));
      if (!records.length) throw new Error('CELL명이 있는 데이터 행을 찾지 못했습니다.');
      const validation = await adminDbApi.validateCells({ fileName: file.name, fileSize: file.size, mimeType: file.type, records });
      setCellRecords(records);
      setCellValidation(validation);
      showToast('파일 분석과 서버 검증을 완료했습니다.', 'success');
    } catch (prepareError) {
      setCellFile(null);
      showToast(prepareError instanceof Error ? prepareError.message : 'CELL DB 파일을 분석하지 못했습니다.', 'error');
    } finally {
      setCellUploadBusy(false);
    }
  };

  const uploadCells = async () => {
    if (!cellValidation || !cellFile) return;
    if (!window.confirm(`CELL 데이터 DB를 업데이트하시겠습니까?\n\n현재 DB: ${cellValidation.currentCount.toLocaleString('ko-KR')}건\n업로드 DB: ${cellValidation.recordCount.toLocaleString('ko-KR')}건\n\n기존 DB는 새로운 DB로 교체됩니다.`)) return;
    setCellUploadBusy(true);
    try {
      const result = await adminDbApi.uploadCells(cellValidation.validationId);
      setUploadResult(result.history);
      setCellValidation(null);
      setCellFile(null);
      setCellRecords([]);
      showToast('CELL DB 업로드가 완료되었습니다.', 'success');
      await refreshAll();
    } catch (uploadError) {
      showToast(uploadError instanceof Error ? uploadError.message : 'CELL DB를 업로드하지 못했습니다.', 'error');
    } finally {
      setCellUploadBusy(false);
    }
  };

  const editCell = (cell: AdminCellRecord) => {
    setCellDraft({ ...cell });
    setCellEditorOpen(true);
  };

  const saveCell = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = toCellPayload(cellDraft);
      if (cellDraft.id) await cellsApi.update(cellDraft.id, payload);
      else await cellsApi.create(payload);
      setCellDraft(emptyCell);
      setCellEditorOpen(false);
      showToast('CELL 정보를 저장했습니다.', 'success');
      await refreshAll();
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : 'CELL 정보를 저장하지 못했습니다.', 'error');
    }
  };

  const removeCell = async (id: string) => {
    if (!window.confirm('선택한 CELL을 삭제하시겠습니까?')) return;
    try {
      await cellsApi.remove(id);
      showToast('CELL을 삭제했습니다.', 'success');
      await refreshAll();
    } catch (removeError) {
      showToast(removeError instanceof Error ? removeError.message : 'CELL을 삭제하지 못했습니다.', 'error');
    }
  };

  const clearCells = async () => {
    if (!window.confirm('CELL 데이터 DB 전체를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    try {
      await adminDbApi.clearCells();
      showToast('CELL DB 전체를 삭제했습니다.', 'success');
      await refreshAll();
    } catch (clearError) {
      showToast(clearError instanceof Error ? clearError.message : 'CELL DB를 삭제하지 못했습니다.', 'error');
    }
  };

  const exportCells = async () => {
    try {
      const allRows: AdminCellRecord[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const result = await adminDbApi.cells('', page, 500);
        allRows.push(...result.items);
        totalPages = result.pagination.totalPages;
        page += 1;
      } while (page <= totalPages);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(allRows.map(exportCellRow), { header: cellColumnDefinitions.map(({ label }) => label) }),
        '데이터DB'
      );
      XLSX.writeFile(workbook, 'CATV_데이터DB_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      showToast('현재 CELL DB 전체를 Excel로 저장했습니다.', 'success');
    } catch (exportError) {
      showToast(exportError instanceof Error ? exportError.message : 'CELL DB를 저장하지 못했습니다.', 'error');
    }
  };

  const cancelStraightMapRender = async (job: StraightMapJob) => {
    if (!window.confirm(`${job.filename} 직선도 작업을 취소하시겠습니까?`)) return;
    try {
      await straightMapAdminApi.cancel(job.id);
      showToast('직선도 작업 취소를 요청했습니다.', 'success');
      await loadAdminData();
    } catch (cancelError) {
      showToast(cancelError instanceof Error ? cancelError.message : '직선도 작업을 취소하지 못했습니다.', 'error');
    }
  };

  const removeStraightMapRender = async (job: StraightMapJob) => {
    if (!window.confirm(`${job.filename} 직선도 작업 기록을 삭제하시겠습니까?`)) return;
    try {
      await straightMapAdminApi.remove(job.id);
      showToast('직선도 작업 기록을 삭제했습니다.', 'success');
      await loadAdminData();
    } catch (removeError) {
      showToast(removeError instanceof Error ? removeError.message : '직선도 작업 기록을 삭제하지 못했습니다.', 'error');
    }
  };

  const activeStraightMapFilenames = straightMapJobs
    .filter((job) => !['UPLOADING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status))
    .map((job) => job.filename);
  const visibleStraightMapJobs = straightMapJobs
    .filter((job) => !['UPLOADING', 'COMPLETED'].includes(job.status));

  return (
    <div className="space-y-4 pb-24 sm:pb-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5"><Database className="h-6 w-6 text-[#2878B5]" /><div><h1 className="text-xl font-extrabold text-[#173B57]">DB 관리 / DB 업로드</h1><p className="text-xs text-slate-500">계정과 현장 DB를 관리자 권한으로 안전하게 관리합니다.</p></div></div>
        <div className="flex gap-2"><button type="button" className={secondaryButtonClass} onClick={() => navigateTo('home')}>조회화면</button><button type="button" className={secondaryButtonClass} onClick={() => void refreshAll()}><RefreshCw className="h-4 w-4" /> 새로고침</button></div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['가입 계정', dbCounts.accounts], ['CELL', dbCounts.cells], ['평면도', dbCounts.floorPlans], ['B2C', dbCounts.b2c]].map(([label, count]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm"><div className="text-lg font-black text-[#173B57]">{Number(count).toLocaleString('ko-KR')}</div><div className="text-[11px] font-bold text-slate-500">{label}</div></div>)}
      </div>

      {loading ? <div className={panelClass}>관리자 DB를 불러오는 중입니다.</div> : null}
      {error ? <div role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-5 text-sm text-red-700">{error}</div> : null}

      <section className={panelClass}>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="flex gap-2.5"><UserRoundCog className="h-5 w-5 text-[#2878B5]" /><div><h2 className="font-extrabold text-[#173B57]">가입 DB / 계정 관리</h2><p className="text-xs text-slate-500">비밀번호 원문은 표시하거나 저장하지 않습니다.</p></div></div><button type="button" className={primaryButtonClass} onClick={() => setAccountOpen((open) => !open)}><Plus className="h-4 w-4" /> 계정 생성</button></div>
        {accountOpen ? <form className="mt-4 grid gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => void createAccount(event)}>
          <input className={inputClass} value={account.username} onChange={(event) => setAccount((current) => ({ ...current, username: event.target.value }))} placeholder="아이디" required />
          <input className={inputClass} value={account.zone} onChange={(event) => setAccount((current) => ({ ...current, zone: event.target.value }))} placeholder="지역" required />
          <input className={inputClass} value={account.name} onChange={(event) => setAccount((current) => ({ ...current, name: event.target.value }))} placeholder="이름" required />
          <select aria-label="권한" className={inputClass} value={account.role} onChange={(event) => setAccount((current) => ({ ...current, role: event.target.value as AccountRole }))}>{accountRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <input className={inputClass} type="password" value={account.password} onChange={(event) => setAccount((current) => ({ ...current, password: event.target.value }))} placeholder="비밀번호 (8자 이상·영문·숫자·특수문자)" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} title={PASSWORD_POLICY_MESSAGE} required />
          <input className={inputClass} type="password" value={account.passwordConfirm} onChange={(event) => setAccount((current) => ({ ...current, passwordConfirm: event.target.value }))} placeholder="비밀번호 확인" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required />
          <button className={`${primaryButtonClass} sm:col-span-2 lg:col-span-3`} type="submit"><Save className="h-4 w-4" /> 계정 저장</button>
        </form> : null}
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{['아이디', '지역', '이름', '권한', '비밀번호', '상태', '최근 로그인', '관리'].map((label) => <th key={label} className="px-3 py-2.5">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{users.map((user) => <tr key={user.id}><td className="px-3 py-3 font-bold text-[#173B57]">{user.username}</td><td className="px-3 py-3">{user.zone || user.department}</td><td className="px-3 py-3">{user.name}</td><td className="px-3 py-3"><select aria-label={`${user.name} 권한`} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold" value={user.role} disabled={user.id === currentUser.id} onChange={(event) => void updateUserRole(user, event.target.value as AccountRole)}>{accountRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td><td className="px-3 py-3">{Boolean(user.passwordConfigured) ? '설정됨' : '미설정'}</td><td className="px-3 py-3">{user.status === 'active' ? '사용 중' : user.status === 'pending' ? '승인 대기' : '잠김'}</td><td className="px-3 py-3">{formatDate(user.lastLoginAt)}</td><td className="px-3 py-3"><div className="flex gap-1.5"><button type="button" className={secondaryButtonClass} onClick={() => setResetTarget(user)}><KeyRound className="h-3.5 w-3.5" /> 재설정</button><button type="button" className={secondaryButtonClass} disabled={user.id === currentUser.id} onClick={() => void updateUserStatus(user)}><LockKeyhole className="h-3.5 w-3.5" /> {user.status === 'active' ? '잠금' : '활성화'}</button><button type="button" className={dangerButtonClass} disabled={user.id === currentUser.id} onClick={() => void removeUser(user)}><Trash2 className="h-3.5 w-3.5" /></button></div></td></tr>)}</tbody></table>
        </div>
      </section>

      <section className={panelClass}>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="flex gap-2.5"><FileSpreadsheet className="h-5 w-5 text-[#2878B5]" /><div><h2 className="font-extrabold text-[#173B57]">CELL 데이터 DB</h2><p className="text-xs text-slate-500">키번호가 같으면 기존 데이터를 수정하고, 새 키번호만 추가합니다. 파일에 없는 기존 데이터는 유지됩니다.</p></div></div><div className="flex flex-wrap gap-2"><button className={secondaryButtonClass} type="button" onClick={() => { setCellDraft(emptyCell); setCellEditorOpen(true); }}><Plus className="h-4 w-4" /> 행 추가</button><button className={secondaryButtonClass} type="button" onClick={() => void exportCells()}><Save className="h-4 w-4" /> Excel 저장</button><button className={dangerButtonClass} type="button" onClick={() => void clearCells()}><Trash2 className="h-4 w-4" /> 전체 삭제</button></div></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(260px,1fr)_auto]">
          <label className="block text-xs font-bold text-slate-600">CELL DB 파일<input className="mt-1.5 block h-10 w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void prepareCellFile(event.target.files?.[0] || null)} /></label>
          <label className="block text-xs font-bold text-slate-600">현재 데이터 검색<div className="relative mt-1.5"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className={`${inputClass} pl-9`} value={cellSearch} onChange={(event) => setCellSearch(event.target.value)} placeholder="키번호 / 셀명 / 국사명 / 노드 / ONU·UPS 위치" /></div></label>
          <button type="button" className={`${primaryButtonClass} self-end`} disabled={!cellValidation || cellUploadBusy} onClick={() => void uploadCells()}><Upload className="h-4 w-4" /> {cellUploadBusy ? '처리 중...' : 'DB 업로드'}</button>
        </div>
        {cellFile ? <div className="mt-4 grid gap-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-xs sm:grid-cols-3"><div>선택 파일명<strong className="mt-1 block text-[#173B57]">{cellFile.name}</strong></div><div>파일 크기<strong className="mt-1 block text-[#173B57]">{formatBytes(cellFile.size)}</strong></div><div>예상 데이터 행 수<strong className="mt-1 block text-[#173B57]">{cellRecords.length.toLocaleString('ko-KR')}건</strong></div>{cellValidation ? <><div>현재 DB<strong className="mt-1 block text-[#173B57]">{cellValidation.currentCount.toLocaleString('ko-KR')}건</strong></div><div>신규 / 수정<strong className="mt-1 block text-[#173B57]">{cellValidation.newCount.toLocaleString('ko-KR')} / {cellValidation.updatedCount.toLocaleString('ko-KR')}건</strong></div><div>미포함 기존 데이터<strong className="mt-1 block text-emerald-700">그대로 유지</strong></div></> : null}</div> : null}
        {cellRecords.length ? (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
              업로드 미리보기 · Excel 원본 31개 열 · 상위 5건
            </div>
            <table className="min-w-[5200px] w-full text-left text-xs">
              <thead className="bg-slate-50">
                <tr>{cellColumnDefinitions.map(({ field, label }) => <th key={field} className="min-w-32 px-3 py-2">{label}</th>)}</tr>
              </thead>
              <tbody>
                {cellRecords.slice(0, 5).map((record, index) => (
                  <tr key={record.keyNumber + '-' + index} className="border-t border-slate-100">
                    {cellColumnDefinitions.map(({ field }) => <td key={field} className="max-w-72 px-3 py-2 align-top">{String(record[field] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}        {uploadResult ? <div className="mt-3 grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs sm:grid-cols-3"><strong className="text-emerald-800 sm:col-span-3">DB 업로드 완료</strong><span>파일명: {uploadResult.fileName}</span><span>총 데이터: {uploadResult.recordCount.toLocaleString('ko-KR')}건</span><span>업로드: {formatDate(uploadResult.uploadedAt)}</span><span>신규: {uploadResult.newCount.toLocaleString('ko-KR')}건</span><span>수정: {uploadResult.updatedCount.toLocaleString('ko-KR')}건</span><span>삭제: {uploadResult.deletedCount.toLocaleString('ko-KR')}건</span></div> : null}
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <div className="flex flex-col gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <strong>현재 CELL DB · {cellPagination.total.toLocaleString('ko-KR')}건</strong>
            <span>페이지당 100건 · 가로 스크롤로 Excel 31개 항목 전체 확인</span>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-[5200px] w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  {cellColumnDefinitions.map(({ field, label }) => <th key={field} className="min-w-32 px-3 py-2.5">{label}</th>)}
                  <th className="sticky right-0 min-w-40 bg-slate-50 px-3 py-2.5">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cellListLoading ? (
                  <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={cellColumnDefinitions.length + 1}>CELL DB를 불러오는 중입니다.</td></tr>
                ) : adminCells.length ? adminCells.map((cell) => (
                  <tr key={cell.id} className="bg-white hover:bg-blue-50/30">
                    {cellColumnDefinitions.map(({ field }) => (
                      <td key={field} className="max-w-72 px-3 py-2.5 align-top">
                        <span className={field === 'cellName' ? 'font-bold text-[#173B57]' : ''}>{String(cell[field] ?? '')}</span>
                      </td>
                    ))}
                    <td className="sticky right-0 bg-white px-3 py-2.5">
                      <div className="flex gap-1.5">
                        <button className={secondaryButtonClass} type="button" onClick={() => editCell(cell)}>수정</button>
                        <button className={dangerButtonClass} type="button" onClick={() => void removeCell(cell.id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={cellColumnDefinitions.length + 1}>검색 결과가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs">
            <span>{cellPagination.page.toLocaleString('ko-KR')} / {Math.max(1, cellPagination.totalPages).toLocaleString('ko-KR')} 페이지</span>
            <div className="flex gap-2">
              <button type="button" className={secondaryButtonClass} disabled={cellPage <= 1 || cellListLoading} onClick={() => void loadAdminCells(cellSearch, cellPage - 1)}>이전</button>
              <button type="button" className={secondaryButtonClass} disabled={cellPage >= cellPagination.totalPages || cellListLoading} onClick={() => void loadAdminCells(cellSearch, cellPage + 1)}>다음</button>
            </div>
          </div>
        </div>      </section>

      <AssetSection type="floor_plan" title="국사 평면도 DB" description="국사별 도면을 최대 3장까지 등록하고, 각 도면의 Rack 위치 좌표를 독립적으로 관리합니다." accept=".png,.jpg,.jpeg,.webp" icon={<Building2 className="h-5 w-5" />} assets={floorPlans} onChanged={loadAdminData} />
      <AssetSection type="b2c" title="B2C 선번장 / 직선도 DB" description="선번장 D/H/L~P열을 조회 DB로 교체하고, 직선도 시트는 실제 콘텐츠만 자른 벡터 PDF·정밀 좌표 지도로 생성합니다." accept=".xlsx,.xls,.csv" icon={<Cable className="h-5 w-5" />} assets={b2cAssets} activeStraightMapFilenames={activeStraightMapFilenames} onChanged={loadAdminData} />

      <section className={panelClass}>
        <div className="flex items-center gap-2.5"><Cable className="h-5 w-5 text-[#2878B5]" /><div><h2 className="font-extrabold text-[#173B57]">직선도 렌더링 작업</h2><p className="text-xs text-slate-500">진행 중이거나 확인이 필요한 작업만 표시되며, 완료된 작업은 자동으로 사라집니다.</p></div></div>
        <div className="mt-4 space-y-2">
          {visibleStraightMapJobs.length ? visibleStraightMapJobs.map((job) => {
            const metrics = straightMapMetrics(job.metricsJson);
            const uploadRate = metrics.uploadMs > 0
              ? Number(job.totalArtifactBytes || 0) / (metrics.uploadMs / 1000)
              : 0;
            return (
            <div key={job.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div><strong className="text-[#173B57]">{job.stationName} · {job.filename}</strong><p className="mt-1 text-slate-500">{job.status === 'WAITING_FOR_OFFICE_RENDERER' ? '사무실 렌더러 실행 대기 중' : job.currentStep || job.status} · {job.completedSheets}/{job.totalSheets || '-'} 시트 · {Number(job.progress).toFixed(1)}%</p></div>
                <div className="flex gap-2">
                  {['FAILED', 'RETRY_WAIT', 'CANCELLED'].includes(job.status) ? <button type="button" className={secondaryButtonClass} onClick={() => void straightMapAdminApi.retry(job.id).then(loadAdminData)}>재시도</button> : null}
                  {!['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status) ? <button type="button" className={dangerButtonClass} onClick={() => void cancelStraightMapRender(job)}>취소</button> : null}
                  {['FAILED', 'CANCELLED'].includes(job.status) ? <button type="button" className={dangerButtonClass} onClick={() => void removeStraightMapRender(job)}><Trash2 className="h-3.5 w-3.5" /> 삭제</button> : null}
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[#2878B5]" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-slate-500"><span>Heartbeat: {formatDate(job.heartbeatAt)}</span><span>시도: {job.attempt}/{job.maxAttempts}</span><span>캐시: {job.cacheHitSheets} 시트</span>{job.errorMessage ? <span className="font-bold text-red-600">{job.errorCode}: {job.errorMessage}</span> : null}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-slate-500">
                <span>다운로드 {formatDuration(metrics.downloadMs)}</span>
                <span>Excel 시작 {formatDuration(metrics.excelStartMs)} · 열기 {formatDuration(metrics.workbookOpenMs)} · PDF {formatDuration(metrics.pdfGenerationMs)}</span>
                <span>해시 {formatDuration(metrics.checksumMs)}</span>
                <span>업로드 {formatDuration(metrics.uploadMs)} · {uploadRate > 0 ? `${formatBytes(uploadRate)}/s` : '-'} · 재시도 {metrics.uploadRetryCount || 0}회</span>
                <span>검증 {formatDuration(metrics.verifyArtifactsMs)} · ACTIVE {formatDuration(metrics.activeTransitionMs)}</span>
                <span>PDF 버터 산출물 {formatBytes(Number(job.totalArtifactBytes || 0))}</span>
              </div>
            </div>
          ); }) : <p className="rounded-xl bg-slate-50 p-5 text-center text-xs text-slate-400">등록된 직선도 렌더링 작업이 없습니다.</p>}
        </div>
      </section>

      <section className={panelClass}>
        <div className="flex items-center gap-2.5"><History className="h-5 w-5 text-[#2878B5]" /><div><h2 className="font-extrabold text-[#173B57]">최근 DB 업로드</h2><p className="text-xs text-slate-500">최근 10건을 표시합니다.</p></div></div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[680px] w-full text-left text-xs"><thead className="bg-slate-50"><tr>{['업로드 일시', 'DB 종류', '파일명', '데이터', '관리자', '상태'].map((label) => <th key={label} className="px-3 py-2.5">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{history.length ? history.map((entry) => <tr key={entry.id}><td className="px-3 py-3">{formatDate(entry.uploadedAt)}</td><td className="px-3 py-3">{entry.dbType === 'cell' ? 'CELL DB' : entry.dbType === 'floor_plan' ? '국사 평면도' : 'B2C DB'}</td><td className="px-3 py-3">{entry.fileName}</td><td className="px-3 py-3">{entry.recordCount.toLocaleString('ko-KR')}건</td><td className="px-3 py-3">{entry.uploadedBy}</td><td className="px-3 py-3">{entry.status === 'success' ? '성공' : '실패'}</td></tr>) : <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={6}>업로드 이력이 없습니다.</td></tr>}</tbody></table></div>
      </section>

      {resetTarget ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"><form className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onSubmit={(event) => void resetPassword(event)}><div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-[#2878B5]" /><h2 className="font-extrabold text-[#173B57]">비밀번호 재설정</h2></div><p className="mt-2 text-xs text-slate-500">{resetTarget.username} 계정의 새 비밀번호를 지정합니다.</p><input className={`${inputClass} mt-4`} type="password" placeholder="새 비밀번호 (8자 이상·영문·숫자·특수문자)" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} title={PASSWORD_POLICY_MESSAGE} value={resetPasswords.password} onChange={(event) => setResetPasswords((current) => ({ ...current, password: event.target.value }))} required /><input className={`${inputClass} mt-3`} type="password" placeholder="새 비밀번호 확인" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={resetPasswords.confirm} onChange={(event) => setResetPasswords((current) => ({ ...current, confirm: event.target.value }))} required /><div className="mt-4 flex justify-end gap-2"><button type="button" className={secondaryButtonClass} onClick={() => setResetTarget(null)}>취소</button><button type="submit" className={primaryButtonClass}>저장</button></div></form></div> : null}

      {cellEditorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/45 p-4">
          <form className="my-6 max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onSubmit={(event) => void saveCell(event)}>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-[#2878B5]" />
              <div>
                <h2 className="font-extrabold text-[#173B57]">CELL {cellDraft.id ? '수정' : '추가'}</h2>
                <p className="text-xs text-slate-500">CATV_데이터DB.xlsx의 31개 항목 기준</p>
              </div>
            </div>
            <div className="mt-4 space-y-5">
              {cellEditorSections.map((section) => (
                <fieldset key={section.title} className="rounded-xl border border-slate-200 p-3">
                  <legend className="px-2 text-sm font-extrabold text-[#173B57]">{section.title}</legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {section.fields.map((field) => {
                      const definition = cellColumnDefinitions.find((item) => item.field === field);
                      const wide = ['stationAddress', 'onuLocation', 'upsLocation', 'notes'].includes(field);
                      return (
                        <label key={field} className={'text-xs font-bold text-slate-600 ' + (wide ? 'sm:col-span-2' : '')}>
                          {definition?.label || field}
                          <input
                            className={inputClass + ' mt-1.5'}
                            value={String(cellDraft[field] ?? '')}
                            onChange={(event) => setCellDraft((current) => ({ ...current, [field]: event.target.value }))}
                            required={['keyNumber', 'cellName', 'stationName', 'stationAddress'].includes(field)}
                          />
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="sticky bottom-0 mt-5 flex justify-end gap-2 border-t border-slate-100 bg-white pt-4">
              <button type="button" className={secondaryButtonClass} onClick={() => setCellEditorOpen(false)}>취소</button>
              <button type="submit" className={primaryButtonClass}><Save className="h-4 w-4" /> 저장</button>
            </div>
          </form>
        </div>
      ) : null}    </div>
  );
};
