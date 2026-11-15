export interface FloatingPosition {
  x: number;
  y: number;
}

export function snapFloatingPosition(
  x: number,
  y: number,
  containerWidth: number,
  containerHeight: number,
  buttonSize: number,
  pad = 14
): FloatingPosition {
  const safeW = Math.max(containerWidth, buttonSize + pad * 2);
  const safeH = Math.max(containerHeight, buttonSize + pad * 2);
  const minEdge = pad;
  const maxX = Math.max(minEdge, safeW - buttonSize - pad);
  const maxY = Math.max(minEdge, safeH - buttonSize - pad);

  const clampedX = Math.min(maxX, Math.max(minEdge, x));
  const clampedY = Math.min(maxY, Math.max(minEdge, y));
  const centerX = clampedX + buttonSize / 2;

  return {
    x: centerX < safeW / 2 ? minEdge : maxX,
    y: Math.round(clampedY),
  };
}
