import type {MinimapFrame, MinimapMarker} from './minimap-marker-policy.ts';

export class MinimapRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly mapImage = new Image();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    mapImageUrl: string,
    private readonly worldWidth: number,
    private readonly worldHeight: number
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Minimap canvas context is unavailable.');
    this.context = context;
    this.mapImage.src = mapImageUrl;
  }

  render(frame: MinimapFrame, timeMs: number): void {
    const {context, canvas} = this;
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const worldScale = width / (frame.range * 2);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#101416';
    context.fillRect(0, 0, width, height);

    if (this.mapImage.complete && this.mapImage.naturalWidth > 0) {
      const imageScaleX = worldScale * this.worldWidth / this.mapImage.naturalWidth;
      const imageScaleY = worldScale * this.worldHeight / this.mapImage.naturalHeight;
      context.save();
      context.globalAlpha = 0.78;
      context.filter = 'saturate(0.55) brightness(0.72) contrast(1.18)';
      context.drawImage(
        this.mapImage,
        centerX - frame.originX * worldScale,
        centerY - frame.originY * worldScale,
        this.mapImage.naturalWidth * imageScaleX,
        this.mapImage.naturalHeight * imageScaleY
      );
      context.restore();
    }

    context.fillStyle = 'rgba(3, 8, 10, 0.2)';
    context.fillRect(0, 0, width, height);
    for (const marker of frame.markers) {
      const position = projectMarker(marker, frame, width, height, worldScale);
      drawMarker(context, marker, position.x, position.y, position.clamped, timeMs);
    }

    context.strokeStyle = 'rgba(255, 255, 255, 0.68)';
    context.lineWidth = 2;
    context.strokeRect(1, 1, width - 2, height - 2);
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#000000';
    context.lineWidth = 3;
    context.font = '900 15px Inter, Arial, sans-serif';
    context.textAlign = 'center';
    context.strokeText('N', centerX, 19);
    context.fillText('N', centerX, 19);
    this.canvas.setAttribute(
      'aria-label',
      `District minimap, ${frame.markers.length} markers, range ${Math.round(frame.range)}`
    );
  }
}

function projectMarker(
  marker: MinimapMarker,
  frame: MinimapFrame,
  width: number,
  height: number,
  worldScale: number
): {x: number; y: number; clamped: boolean} {
  const offsetX = (marker.x - frame.originX) * worldScale;
  const offsetY = (marker.y - frame.originY) * worldScale;
  const limitX = width / 2 - 13;
  const limitY = height / 2 - 13;
  const factor = Math.min(
    1,
    offsetX === 0 ? 1 : limitX / Math.abs(offsetX),
    offsetY === 0 ? 1 : limitY / Math.abs(offsetY)
  );
  return {
    x: width / 2 + offsetX * factor,
    y: height / 2 + offsetY * factor,
    clamped: marker.clamped || factor < 1
  };
}

function drawMarker(
  context: CanvasRenderingContext2D,
  marker: MinimapMarker,
  x: number,
  y: number,
  clamped: boolean,
  timeMs: number
): void {
  const color = markerColor(marker.kind, timeMs);
  const size = marker.kind === 'local-player' ? 10 : (marker.kind === 'objective' ? 9 : 7);
  context.save();
  context.translate(x, y);
  context.rotate(marker.angle + Math.PI / 2);
  context.globalAlpha = clamped ? 0.66 : 1;
  context.fillStyle = color;
  context.strokeStyle = '#050708';
  context.lineWidth = 3;
  context.beginPath();
  if (marker.kind === 'local-player' || marker.kind === 'remote-player') {
    context.moveTo(0, -size);
    context.lineTo(size * 0.72, size * 0.75);
    context.lineTo(0, size * 0.42);
    context.lineTo(-size * 0.72, size * 0.75);
    context.closePath();
  } else if (marker.kind === 'objective') {
    context.rotate(Math.PI / 4);
    context.rect(-size * 0.65, -size * 0.65, size * 1.3, size * 1.3);
  } else if (marker.kind === 'police' || marker.kind === 'hostile') {
    context.rect(-size * 0.72, -size * 0.72, size * 1.44, size * 1.44);
  } else {
    context.arc(0, 0, size * 0.75, 0, Math.PI * 2);
  }
  context.stroke();
  context.fill();
  if (clamped) {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, size + 4, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function markerColor(kind: MinimapMarker['kind'], timeMs: number): string {
  if (kind === 'local-player') return '#ffffff';
  if (kind === 'remote-player') return '#62d7ff';
  if (kind === 'police') return Math.floor(timeMs / 180) % 2 === 0 ? '#ff4455' : '#4d7cff';
  if (kind === 'hostile') return '#ff5e4d';
  if (kind === 'objective') return '#f2c94c';
  if (kind === 'contact') return '#ff9d3f';
  if (kind === 'shop') return '#63df8a';
  return '#d979ff';
}
