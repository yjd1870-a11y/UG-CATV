export type PanZoomView = { scale: number; x: number; y: number };
export type GesturePoint = { x: number; y: number };

export const clampZoom = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const zoomViewAt = (
  view: PanZoomView,
  factor: number,
  center: GesturePoint,
  minimum: number,
  maximum: number,
): PanZoomView => {
  const scale = clampZoom(view.scale * factor, minimum, maximum);
  return {
    scale,
    x: center.x - (center.x - view.x) * scale / view.scale,
    y: center.y - (center.y - view.y) * scale / view.scale,
  };
};

export const pinchView = (
  startView: PanZoomView,
  startCenter: GesturePoint,
  currentCenter: GesturePoint,
  scaleFactor: number,
  minimum: number,
  maximum: number,
): PanZoomView => {
  const scale = clampZoom(startView.scale * scaleFactor, minimum, maximum);
  const worldX = (startCenter.x - startView.x) / startView.scale;
  const worldY = (startCenter.y - startView.y) / startView.scale;
  return {
    scale,
    x: currentCenter.x - worldX * scale,
    y: currentCenter.y - worldY * scale,
  };
};

export const pointDistance = (left: GesturePoint, right: GesturePoint) =>
  Math.hypot(right.x - left.x, right.y - left.y);

export const pointCenter = (left: GesturePoint, right: GesturePoint): GesturePoint => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
});

export const horizontalSwipeDirection = (
  start: GesturePoint,
  end: GesturePoint,
  threshold = 50,
): -1 | 0 | 1 => {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return 0;
  return deltaX < 0 ? 1 : -1;
};
