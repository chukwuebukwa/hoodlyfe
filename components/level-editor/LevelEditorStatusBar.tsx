'use client';

import type {PointerReadout, ViewportReadout} from '../../src/tools/level-editor/editor-ui.ts';

interface LevelEditorStatusBarProps {
  status: string;
  pointer: PointerReadout;
  viewport: ViewportReadout;
}

export function LevelEditorStatusBar({status, pointer, viewport}: LevelEditorStatusBarProps) {
  return (
    <footer className="le-statusbar">
      <span className="le-statusbar__message">{status}</span>
      <span>World <b>{Math.round(pointer.world.x)}, {Math.round(pointer.world.y)}</b></span>
      <span>Tile <b>{pointer.tile.x}, {pointer.tile.y}</b></span>
      <span>Zoom <b>{Math.round(viewport.zoom * 100)}%</b></span>
      <span>View <b>{Math.round(viewport.visibleWorld.minX)}, {Math.round(viewport.visibleWorld.minY)}</b></span>
    </footer>
  );
}
