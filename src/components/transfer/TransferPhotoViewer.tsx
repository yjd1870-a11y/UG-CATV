import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { InteractivePhotoViewer } from '../common/InteractivePhotoViewer';

export type TransferViewerPhoto = { id: string; url: string; fileName: string };

type Props = {
  photos: TransferViewerPhoto[];
  initialIndex: number;
  onClose: () => void;
  desktopFloating?: boolean;
  targetWindow?: Window | null;
  onPopupClosed?: () => void;
};

type PopupPortalProps = {
  targetWindow: Window;
  onPopupClosed: () => void;
  children: React.ReactNode;
};

const PopupPortal: React.FC<PopupPortalProps> = ({ targetWindow, onPopupClosed, children }) => {
  const container = useMemo(() => targetWindow.document.createElement('div'), [targetWindow]);
  const onPopupClosedRef = useRef(onPopupClosed);
  onPopupClosedRef.current = onPopupClosed;

  useEffect(() => {
    const popupDocument = targetWindow.document;
    container.id = 'catv-photo-popup-root';
    popupDocument.title = '업무이관 사진';
    popupDocument.documentElement.lang = 'ko';
    popupDocument.body.style.margin = '0';
    popupDocument.body.style.overflow = 'hidden';
    popupDocument.body.replaceChildren(container);
    popupDocument.head.querySelectorAll('[data-catv-popup-style]').forEach((node) => node.remove());
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.setAttribute('data-catv-popup-style', 'true');
      popupDocument.head.appendChild(clone);
    });
    const handleClosed = () => onPopupClosedRef.current();
    targetWindow.addEventListener('beforeunload', handleClosed);
    targetWindow.focus();
    return () => {
      targetWindow.removeEventListener('beforeunload', handleClosed);
      container.remove();
    };
  }, [container, targetWindow]);

  return createPortal(children, container);
};

export const TransferPhotoViewer: React.FC<Props> = ({
  photos,
  initialIndex,
  onClose,
  desktopFloating = false,
  targetWindow,
  onPopupClosed = onClose,
}) => {
  const viewerPhotos = useMemo(() => photos.map((photo) => ({ id: photo.id, url: photo.url, label: photo.fileName })), [photos]);
  const viewer = <InteractivePhotoViewer
    photos={viewerPhotos}
    initialIndex={initialIndex}
    title="업무이관 사진"
    ariaLabel="업무이관 사진 확대"
    onClose={onClose}
    desktopFloating={desktopFloating}
    hostWindow={targetWindow || undefined}
  />;

  return targetWindow
    ? <PopupPortal targetWindow={targetWindow} onPopupClosed={onPopupClosed}>{viewer}</PopupPortal>
    : viewer;
};
