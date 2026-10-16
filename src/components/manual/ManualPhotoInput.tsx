import React, { useEffect, useRef, useState } from 'react';
import { compressManualPhoto, PhotoCompressionError, type CompressedPhoto } from '../../features/manual/photo-compression';

const size = (bytes: number) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / 1048576).toFixed(2)}MB`;
export const ManualPhotoInput: React.FC<{ label: string; maxSide: number; maxBytes: number; disabled?: boolean; onReady: (file: File | null) => void; onProcessingChange?: (working: boolean) => void }> = ({ label, maxSide, maxBytes, disabled, onReady, onProcessingChange }) => {
  const [result, setResult] = useState<CompressedPhoto | null>(null); const [working, setWorking] = useState(false);
  const [error, setError] = useState(''); const [fallback, setFallback] = useState<File | null>(null); const [preview, setPreview] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!result) { setPreview(''); return; }
    const url = URL.createObjectURL(result.file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [result]);
  const select = async (file: File | null) => {
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    onReady(null); setResult(null); setError(''); setFallback(null); setWorking(Boolean(file));
    onProcessingChange?.(Boolean(file));
    if (!file) return;
    try {
      const compressed = await compressManualPhoto(file, maxSide, next.signal);
      if (next.signal.aborted) return;
      if (compressed.file.size > maxBytes) throw new PhotoCompressionError(`처리 후 파일이 ${size(maxBytes)}를 초과합니다. 더 작은 사진을 선택해주세요.`);
      setResult(compressed); onReady(compressed.file);
    } catch (e) {
      if (next.signal.aborted) return;
      setError(e instanceof Error ? e.message : '사진을 처리하지 못했습니다.');
      if (e instanceof PhotoCompressionError && e.allowOriginal && file.size <= maxBytes) setFallback(file);
    } finally { if (!next.signal.aborted) { setWorking(false); onProcessingChange?.(false); } }
  };
  return <div className="space-y-2 min-w-0">
    <label className="block text-sm">{label}<input type="file" accept=".jpg,.jpeg,.png,.webp" disabled={disabled} onChange={(e) => void select(e.target.files?.[0] || null)} className="mt-1 min-h-11 w-full max-w-full rounded-lg border bg-white p-3 text-sm" /></label>
    <p className="text-xs text-slate-600">JPG·PNG·WebP · 원본 최대 10MB / 4천만 화소 / 한 변 16384px · 긴 변 {maxSide}px, 품질 0.85로 자동 압축 · 업로드 최대 {size(maxBytes)}</p>
    {working && <p role="status" className="text-sm text-teal-800">사진 압축 중…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {fallback && <button type="button" disabled={disabled} onClick={() => { setResult({ original: fallback, file: fallback, width: 0, height: 0 }); onReady(fallback); setFallback(null); setError(''); }} className="min-h-11 rounded-lg border bg-white px-4 text-sm">원본으로 업로드 준비</button>}
    {result && <div className="rounded-lg border border-teal-300 bg-white p-3"><p role="status" className="break-all text-sm text-teal-900">{result.file.name} · {size(result.original.size)} → {size(result.file.size)} · {Math.round((1 - result.file.size / result.original.size) * 100)}% 감소{result.file === result.original ? ' (원본 유지)' : ''}</p>{preview && <img src={preview} alt="업로드할 사진 미리보기" className="mt-2 max-h-48 max-w-full rounded object-contain" />}<p className="mt-2 text-xs text-slate-600">글씨가 잘 보이는지 확인한 후 등록해주세요.</p></div>}
  </div>;
};
