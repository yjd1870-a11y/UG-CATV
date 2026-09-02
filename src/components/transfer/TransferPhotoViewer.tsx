import React from 'react';
import { InteractivePhotoViewer } from '../common/InteractivePhotoViewer';

export type TransferViewerPhoto = { id: string; url: string; fileName: string };

type Props = {
  photos: TransferViewerPhoto[];
  initialIndex: number;
  onClose: () => void;
};

export const TransferPhotoViewer: React.FC<Props> = ({ photos, initialIndex, onClose }) => (
  <InteractivePhotoViewer
    photos={photos.map((photo) => ({ id: photo.id, url: photo.url, label: photo.fileName }))}
    initialIndex={initialIndex}
    title="업무이관 사진"
    ariaLabel="업무이관 사진 확대"
    onClose={onClose}
  />
);
