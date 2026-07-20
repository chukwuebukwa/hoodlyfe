'use client';

import Link from 'next/link';
import {
  Box,
  CheckCircle2,
  ChevronLeft,
  Download,
  FileJson,
  Focus,
  Gamepad2,
  Menu,
  PanelRight,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut
} from 'lucide-react';

interface LevelEditorToolbarProps {
  title: string;
  districtId: string;
  districts: Array<{id: string; label: string}>;
  canExplore: boolean;
  authoritativePlaytest: boolean;
  playDraftBusy: boolean;
  canExportBundle: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  autosaveLabel: string;
  issueCount: number;
  onUndo(): void;
  onRedo(): void;
  onFit(): void;
  onActual(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onValidate(): void;
  onImport(): void;
  onExportProject(): void;
  onExportBundle(): void;
  onPlayDraft(): void;
  onReset(): void;
  onToggleSidebar(): void;
  onToggleInspector(): void;
  onDistrictChange(id: string): void;
}

export function LevelEditorToolbar(props: LevelEditorToolbarProps) {
  return (
    <header className="le-toolbar">
      <div className="le-toolbar__identity">
        <button className="le-icon-button le-mobile-only" type="button" onClick={props.onToggleSidebar} title="Toggle tools" aria-label="Toggle tools">
          <Menu size={17} />
        </button>
        <Link href="/" className="le-icon-button" title="Return to game" aria-label="Return to game">
          <ChevronLeft size={17} />
        </Link>
        <div>
          <strong>NOCK0 LEVEL EDITOR</strong>
          <span>{props.title}</span>
        </div>
        <select
          className="le-district-select"
          value={props.districtId}
          onChange={(event) => props.onDistrictChange(event.target.value)}
          aria-label="District"
          title="Open district"
        >
          {props.districts.map((district) => <option key={district.id} value={district.id}>{district.label}</option>)}
        </select>
        <i className={props.dirty ? 'is-dirty' : ''}>{props.dirty ? 'Modified' : 'Source clean'}</i>
      </div>

      <div className="le-toolbar__group" aria-label="History">
        <button className="le-icon-button" type="button" onClick={props.onUndo} disabled={!props.canUndo} title="Undo (Cmd/Ctrl+Z)" aria-label="Undo">
          <Undo2 size={17} />
        </button>
        <button className="le-icon-button" type="button" onClick={props.onRedo} disabled={!props.canRedo} title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo">
          <Redo2 size={17} />
        </button>
      </div>

      <div className="le-toolbar__group" aria-label="Viewport">
        <button className="le-icon-button" type="button" onClick={props.onFit} title="Fit whole map (F)" aria-label="Fit whole map">
          <Focus size={17} />
        </button>
        <button className="le-icon-button" type="button" onClick={props.onActual} title="Actual pixels" aria-label="Actual pixels">
          <Box size={17} />
        </button>
        <button className="le-icon-button" type="button" onClick={props.onZoomOut} title="Zoom out" aria-label="Zoom out">
          <ZoomOut size={17} />
        </button>
        <button className="le-icon-button" type="button" onClick={props.onZoomIn} title="Zoom in" aria-label="Zoom in">
          <ZoomIn size={17} />
        </button>
      </div>

      <div className="le-toolbar__spacer" />
      <span className="le-autosave"><Save size={14} /> {props.autosaveLabel}</span>

      <div className="le-toolbar__group le-toolbar__commands" aria-label="Project commands">
        <button type="button" onClick={props.onValidate} className={props.issueCount > 0 ? 'has-issues' : ''}>
          <CheckCircle2 size={16} /> Validate {props.issueCount > 0 ? `(${props.issueCount})` : ''}
        </button>
        <button type="button" onClick={props.onImport}><Upload size={16} /> Import</button>
        <button type="button" onClick={props.onExportProject}><FileJson size={16} /> Project</button>
        <button type="button" className="is-primary" onClick={props.onExportBundle} disabled={!props.canExportBundle} title={props.canExportBundle ? 'Export apply-ready game artifacts' : 'Only the active multiplayer district can export an apply-ready bundle'}><Download size={16} /> Game bundle</button>
        <button className="le-icon-button" type="button" onClick={props.onReset} title="Reset to repository source" aria-label="Reset to repository source">
          <RotateCcw size={17} />
        </button>
        <button
          className="le-icon-button"
          type="button"
          onClick={props.onPlayDraft}
          disabled={!props.canExplore || props.playDraftBusy}
          title={props.authoritativePlaytest
            ? 'Run the current immutable draft in the authoritative multiplayer game'
            : 'Walk the current immutable draft in the geometry preview'}
          aria-label="Play current draft"
        ><Gamepad2 size={17} /></button>
        <button className="le-icon-button le-mobile-only" type="button" onClick={props.onToggleInspector} title="Toggle inspector" aria-label="Toggle inspector">
          <PanelRight size={17} />
        </button>
      </div>
    </header>
  );
}
