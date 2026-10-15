export type ManualKind = 'video' | 'photo' | 'pdf' | 'thumbnail';
export const MANUAL_LIMITS = {
  video: { count: 4, bytes: 200 * 1024 * 1024, mime: ['video/mp4'] },
  photo: { count: 30, bytes: 10 * 1024 * 1024, mime: ['image/jpeg', 'image/png', 'image/webp'] },
  pdf: { count: 10, bytes: 20 * 1024 * 1024, mime: ['application/pdf'] },
  thumbnail: { count: 8, bytes: 2 * 1024 * 1024, mime: ['image/jpeg', 'image/png', 'image/webp'] },
} as const;
export interface ManualCategory { id: string; name: string; description: string; imageUrl: string | null }
export interface ManualModel {
  id: string; categoryId: string; categoryName: string; name: string; manufacturer: string;
  description: string; body: string; tips: string; version: number; imageUrl: string | null;
}
export interface ManualAsset {
  purpose: 'manual' | 'model-cover';
  id: string; modelId: string; kind: ManualKind; title: string; fileName: string;
  mime: string; bytes: number; url: string; posterId: string | null; posterUrl: string | null;
}
export interface ManualDetail { model: ManualModel; assets: ManualAsset[]; canManage: boolean }
export interface ModelInput { categoryId: string; name: string; manufacturer: string; description: string }
