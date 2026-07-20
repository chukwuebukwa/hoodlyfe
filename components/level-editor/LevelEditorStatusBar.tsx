'use client';

import {ExternalLink} from 'lucide-react';
import type {PointerReadout, ViewportReadout} from '../../src/tools/level-editor/editor-ui.ts';

interface LevelEditorStatusBarProps {
  status: string;
  playDraftUrl?: string;
  pointer: PointerReadout;
  viewport: ViewportReadout;
}

export function LevelEditorStatusBar({status, playDraftUrl, pointer, viewport}: LevelEditorStatusBarProps) {
  return (
    <footer className="le-statusbar">
      <span className="le-statusbar__message">{status}</span>
      {playDraftUrl && <a href={playDraftUrl} target="_blank" rel="noreferrer" title="Open last playtest" aria-label="Open last playtest"><ExternalLink size={13} /></a>}
      <span>World <b>{Math.round(pointer.world.x)}, {Math.round(pointer.world.y)}</b></span>
      <span>Tile <b>{pointer.tile.x}, {pointer.tile.y}</b></span>
      <span>Zoom <b>{Math.round(viewport.zoom * 100)}%</b></span>
      <span>View <b>{Math.round(viewport.visibleWorld.minX)}, {Math.round(viewport.visibleWorld.minY)}</b></span>
    </footer>
  );
}
