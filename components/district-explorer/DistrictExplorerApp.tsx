'use client';

import Link from 'next/link';
import {ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Map, Move} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {districtDefinition, type DistrictDefinition} from '../../shared/content/district-catalog.ts';
import {
  DistrictExplorerController,
  type DistrictExplorerStatus
} from '../../src/tools/district-explorer/district-explorer-controller.ts';

export function DistrictExplorerApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<DistrictExplorerController | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<DistrictExplorerStatus>();
  const [district, setDistrict] = useState<DistrictDefinition>();

  useEffect(() => {
    setDistrict(districtDefinition(new URLSearchParams(location.search).get('district')));
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !district) return;
    const controller = new DistrictExplorerController(host, district, setStatus);
    controllerRef.current = controller;
    void controller.start().catch((reason: unknown) => {
      controller.destroy();
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.destroy();
  }, [district]);

  if (!district) return <main id="district-explorer"><p className="district-explorer__loading">Loading district preview</p></main>;

  function directionButton(direction: 'up' | 'down' | 'left' | 'right', Icon: typeof ArrowUp) {
    const release = () => controllerRef.current?.setDirection(direction, false);
    return (
      <button
        type="button"
        aria-label={`Move ${direction}`}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); controllerRef.current?.setDirection(direction, true); }}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
      ><Icon size={20} /></button>
    );
  }

  return (
    <main id="district-explorer">
      <div ref={hostRef} className="district-explorer__viewport" />
      <header className="district-explorer__header">
        <div><strong>{district.label}</strong><span>LOCAL WALK PREVIEW</span></div>
        <Link href={`/editor?district=${district.id}`}><Map size={16} /> Editor</Link>
      </header>
      {status && (
        <aside className="district-explorer__status">
          <strong><Move size={14} /> {Math.round(status.x)}, {Math.round(status.y)}</strong>
          <span>{status.loadedChunks}/{status.totalChunks} chunks</span>
          <span>{status.triangles.toLocaleString()} triangles</span>
        </aside>
      )}
      <div className="district-explorer__controls" aria-label="Movement controls">
        <i />{directionButton('up', ArrowUp)}<i />
        {directionButton('left', ArrowLeft)}{directionButton('down', ArrowDown)}{directionButton('right', ArrowRight)}
      </div>
      <p className="district-explorer__hint">WASD or arrow keys to move</p>
      {error && <section className="district-explorer__error"><strong>District preview unavailable</strong><p>{error}</p><Link href="/editor">Return to editor</Link></section>}
    </main>
  );
}
