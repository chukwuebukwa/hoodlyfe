import type {MinimapFrame, MinimapMarker} from './minimap-marker-policy.ts';

type LocationMarkerKind = Extract<
  MinimapMarker['kind'],
  'ammunition' | 'clothing' | 'hospital' | 'repair'
>;

const LOCATION_ICON_URLS: Readonly<Record<LocationMarkerKind, string>> = Object.freeze({
  ammunition: '/assets/custom/minimap/location-ammunition.png',
  clothing: '/assets/custom/minimap/location-clothing.png',
  hospital: '/assets/custom/minimap/location-hospital.png',
  repair: '/assets/custom/minimap/location-repair.png'
});

export class MinimapRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly mapImage = new Image();
  private readonly locationIcons = new Map<LocationMarkerKind, HTMLImageElement>();

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
    for (const [kind, url] of Object.entries(LOCATION_ICON_URLS) as Array<[LocationMarkerKind, string]>) {
      const icon = new Image();
      icon.src = url;
      this.locationIcons.set(kind, icon);
    }
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
      drawMarker(
        context,
        marker,
        position.x,
        position.y,
        position.clamped,
        timeMs,
        this.locationIcons
      );
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
  const edgeMargin = asLocationKind(marker.kind) ? 26 : 13;
  const limitX = width / 2 - edgeMargin;
  const limitY = height / 2 - edgeMargin;
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
  timeMs: number,
  locationIcons: ReadonlyMap<LocationMarkerKind, HTMLImageElement>
): void {
  const color = markerColor(marker.kind, timeMs, marker.color);
  const size = marker.kind === 'local-player'
    ? 10
    : marker.kind === 'contact'
      ? 12
      : marker.kind === 'objective'
        ? 9
        : 8;
  context.save();
  context.translate(x, y);
  if (isDirectional(marker.kind)) context.rotate(marker.angle + Math.PI / 2);
  context.globalAlpha = clamped ? 0.66 : 1;
  const locationKind = asLocationKind(marker.kind);
  const locationIcon = locationKind ? locationIcons.get(locationKind) : undefined;
  if (locationKind && locationIcon?.complete && locationIcon.naturalWidth > 0) {
    context.imageSmoothingEnabled = false;
    context.globalAlpha = 1;
    context.drawImage(locationIcon, -24, -24, 48, 48);
    context.restore();
    return;
  }
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
  drawContactLetter(context, marker, size);
  drawLocationGlyph(context, marker.kind, size);
  drawClampedRing(context, color, clamped, size + 4);
  context.restore();
}

function drawContactLetter(
  context: CanvasRenderingContext2D,
  marker: MinimapMarker,
  size: number
): void {
  if (marker.kind !== 'contact' || !marker.label) return;
  context.fillStyle = '#050708';
  context.font = `900 ${Math.round(size * 1.25)}px Inter, Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(marker.label, 0, 1);
}

function drawClampedRing(
  context: CanvasRenderingContext2D,
  color: string,
  clamped: boolean,
  radius: number
): void {
  if (!clamped) return;
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.stroke();
}

function asLocationKind(kind: MinimapMarker['kind']): LocationMarkerKind | undefined {
  return kind === 'ammunition' || kind === 'clothing' || kind === 'hospital' || kind === 'repair'
    ? kind
    : undefined;
}

function drawLocationGlyph(
  context: CanvasRenderingContext2D,
  kind: MinimapMarker['kind'],
  size: number
): void {
  if (!['ammunition', 'clothing', 'hospital', 'repair'].includes(kind)) return;
  context.strokeStyle = '#050708';
  context.lineWidth = 2;
  context.beginPath();
  if (kind === 'hospital') {
    context.moveTo(-size * 0.45, 0);
    context.lineTo(size * 0.45, 0);
    context.moveTo(0, -size * 0.45);
    context.lineTo(0, size * 0.45);
  } else if (kind === 'ammunition') {
    context.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    context.moveTo(-size * 0.62, 0);
    context.lineTo(size * 0.62, 0);
    context.moveTo(0, -size * 0.62);
    context.lineTo(0, size * 0.62);
  } else if (kind === 'clothing') {
    context.moveTo(-size * 0.56, size * 0.38);
    context.lineTo(0, -size * 0.15);
    context.lineTo(size * 0.56, size * 0.38);
    context.moveTo(0, -size * 0.15);
    context.arc(0, -size * 0.42, size * 0.22, Math.PI / 2, Math.PI * 2.2);
  } else {
    context.moveTo(-size * 0.45, size * 0.45);
    context.lineTo(size * 0.45, -size * 0.45);
    context.arc(size * 0.38, -size * 0.38, size * 0.22, Math.PI * 0.2, Math.PI * 1.3);
  }
  context.stroke();
}

function isDirectional(kind: MinimapMarker['kind']): boolean {
  return kind === 'local-player' || kind === 'remote-player' || kind === 'police' || kind === 'hostile';
}

function markerColor(
  kind: MinimapMarker['kind'],
  timeMs: number,
  override?: number
): string {
  if (override !== undefined) return `#${override.toString(16).padStart(6, '0')}`;
  if (kind === 'local-player') return '#ffffff';
  if (kind === 'remote-player') return '#62d7ff';
  if (kind === 'police') return Math.floor(timeMs / 180) % 2 === 0 ? '#ff4455' : '#4d7cff';
  if (kind === 'hostile') return '#ff5e4d';
  if (kind === 'objective') return '#f2c94c';
  if (kind === 'contact') return '#ff9d3f';
  if (kind === 'shop') return '#63df8a';
  if (kind === 'ammunition') return '#f2c94c';
  if (kind === 'clothing') return '#ff7fb6';
  if (kind === 'hospital') return '#63df8a';
  if (kind === 'repair') return '#55d6ff';
  if (kind === 'pickup') return '#ffd75a';
  if (kind === 'cash') return '#55e58b';
  return '#d979ff';
}
