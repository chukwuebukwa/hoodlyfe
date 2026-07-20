'use client';

import Link from 'next/link';
import {ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Map, Move} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {districtDefinition, type DistrictDefinition} from '../../shared/content/district-catalog.ts';
import type {LocalPlaytestRevision} from '../../src/tools/level-editor/playtest-revision.ts';
import {loadLocalPlaytestRevision} from '../../src/tools/level-editor/playtest-revision-store.ts';
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
  const [revision, setRevision] = useState<LocalPlaytestRevision>();
  const [sourceReady, setSourceReady] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const selectedDistrict = districtDefinition(query.get('district'));
    const revisionId = query.get('revision');
    setDistrict(selectedDistrict);
    if (!revisionId) {
      setSourceReady(true);
      return;
    }
    void loadLocalPlaytestRevision(revisionId).then((loaded) => {
      if (!loaded) throw new Error('This local Play Draft revision is missing or expired. Return to the editor and create it again.');
      setRevision(loaded);
      setSourceReady(true);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSourceReady(true);
    });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !district || !sourceReady || error) return;
    const controller = new DistrictExplorerController(host, district, setStatus, revision);
    controllerRef.current = controller;
    void controller.start().catch((reason: unknown) => {
      controller.destroy();
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.destroy();
  }, [district, error, revision, sourceReady]);

  if (!district || !sourceReady) return <main id="district-explorer"><p className="district-explorer__loading">Loading district preview</p></main>;

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
        <div><strong>{district.label}</strong><span>{revision ? `PLAY DRAFT ${revision.revisionId.slice(0, 8)}` : 'LOCAL WALK PREVIEW'}</span></div>
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
