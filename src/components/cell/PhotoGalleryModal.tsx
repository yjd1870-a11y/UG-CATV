import React, { useState } from 'react';
import { Camera, Plus, Tag, User, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CellPhoto } from '../../types';

interface PhotoGalleryProps {
  cellId: string;
  cellName: string;
  photos: CellPhoto[];
}

export const PhotoGalleryModal: React.FC<PhotoGalleryProps> = ({
  cellId,
  cellName,
  photos,
}) => {
  const { addCellPhoto, currentUser, showToast } = useApp();
  const canWrite = currentUser?.role !== 'guest';
  const [selectedPhoto, setSelectedPhoto] = useState<CellPhoto | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Form states for new photo
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<CellPhoto['category']>('전주작업');
  const [newDesc, setNewDesc] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);

  const categories = ['전체', '전주작업', '분기기함', '증폭기', '광노드', '국사설비'];

  const filteredPhotos =
    selectedCategory === '전체'
      ? photos
      : photos.filter((p) => p.category === selectedCategory);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newFile) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(newFile.type)) {
      showToast('JPG, PNG, WEBP 사진만 등록할 수 있습니다.', 'warning');
      return;
    }
    if (newFile.size > 10 * 1024 * 1024) {
      showToast('사진 크기는 10MB 이하여야 합니다.', 'warning');
      return;
    }

    let dataUrl: string;
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(newFile);
      });
    } catch {
      showToast('사진 파일을 읽을 수 없습니다.', 'error');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    addCellPhoto(cellId, {
      title: newTitle.trim(),
      category: newCategory,
      date: today,
      author: currentUser?.name || '김현장',
      url: dataUrl,
      description: newDesc.trim() || '현장 점검 및 작업 사진',
    });

    setNewTitle('');
    setNewDesc('');
    setNewFile(null);
    setShowUploadModal(false);
  };

  return (
    <div className="space-y-4">
      {/* Category Filter & Add Photo Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-[#173B57] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {canWrite ? <button
          onClick={() => setShowUploadModal(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#F28C28] hover:bg-[#d97718] text-white text-xs font-bold rounded-xl shadow-xs transition self-start sm:self-auto cursor-pointer"
        >
          <Camera className="w-4 h-4" />
          <span>+ 현장사진 촬영/등록</span>
        </button> : null}
      </div>

      {/* Photos Grid */}
      {filteredPhotos.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-10 text-center text-slate-400">
          <Camera className="w-10 h-10 mx-auto text-slate-300 mb-2" />
          <div className="text-sm font-bold text-slate-600">
            등록된 현장사진이 없습니다.
          </div>
          <div className="text-xs mt-1">
            위의 [+ 현장사진 촬영/등록] 버튼으로 현장 작업 사진을 추가하세요.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
          {filteredPhotos.map((photo) => (
            <div
              key={photo.id}
              onClick={() => setSelectedPhoto(photo)}
              className="group bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md overflow-hidden cursor-pointer transition flex flex-col"
            >
              {/* Photo Thumbnail */}
              <div className="relative aspect-video bg-slate-900 overflow-hidden">
                <img
                  src={photo.url}
                  alt={photo.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-2 left-2">
                  <span className="bg-[#173B57]/90 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
                    {photo.category}
                  </span>
                </div>
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
                  <ZoomIn className="w-4 h-4" />
                  <span>사진 확대</span>
                </div>
              </div>

              {/* Photo Info */}
              <div className="p-3 flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-bold text-[#173B57] line-clamp-1">
                    {photo.title}
                  </h4>
                  <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">
                    {photo.description}
                  </p>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{photo.author}</span>
                  <span>{photo.date}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Photo Zoom Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative max-w-2xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-4 py-3 bg-[#173B57] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-[#2878B5] px-2 py-0.5 rounded">
                  {selectedPhoto.category}
                </span>
                <span className="font-bold text-sm truncate max-w-xs sm:max-w-md">
                  {selectedPhoto.title}
                </span>
              </div>
              <button
                onClick={() => setSelectedPhoto(null)}
                className="p-1 rounded-lg hover:bg-white/20 text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Image */}
            <div className="bg-slate-950 flex items-center justify-center max-h-[60vh] overflow-hidden">
              <img
                src={selectedPhoto.url}
                alt={selectedPhoto.title}
                referrerPolicy="no-referrer"
                className="max-h-[60vh] w-auto object-contain"
              />
            </div>

            {/* Modal Footer Description */}
            <div className="p-4 bg-slate-50 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-800">
                {selectedPhoto.description}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>촬영자: {selectedPhoto.author}</span>
                <span>촬영일자: {selectedPhoto.date}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Photo Modal */}
      {showUploadModal && canWrite && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-extrabold text-base text-[#173B57] flex items-center gap-1.5">
                <Camera className="w-5 h-5 text-[#F28C28]" />
                <span>현장사진 촬영 및 등록</span>
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">사진 파일 *</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  onChange={(event) => setNewFile(event.target.files?.[0] || null)}
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs"
                />
                <p className="mt-1 text-[10px] text-slate-400">JPG, PNG, WEBP · 최대 10MB</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  사진 제목 *
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="예: TBA #2 함체 교체 후 사진"
                  maxLength={160}
                  required
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-[#2878B5] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  카테고리 구분 *
                </label>
                <select
                  value={newCategory}
                  onChange={(e) =>
                    setNewCategory(e.target.value as CellPhoto['category'])
                  }
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-[#2878B5] outline-none"
                >
                  <option value="전주작업">전주작업 (가공선/완철/조가선)</option>
                  <option value="분기기함">분기기함 (TAP/Splitter)</option>
                  <option value="증폭기">증폭기 (TBA/LE/전원부)</option>
                  <option value="광노드">광노드 (Optical Node)</option>
                  <option value="국사설비">국사설비 (ODF/송신기)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  사진 설명 / 점검 내용
                </label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="현장 특이사항, 측정값, 조치내용 등을 입력하세요."
                  maxLength={2000}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-[#2878B5] outline-none resize-none"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-1 h-11 bg-[#F28C28] hover:bg-[#d97718] text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  사진 등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
