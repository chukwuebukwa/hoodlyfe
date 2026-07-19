'use client';

import {AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info, X} from 'lucide-react';
import type {ValidationIssue, ValidationReport} from '../../src/tools/level-editor/level-validation.ts';

interface LevelEditorValidationPanelProps {
  report: ValidationReport;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelectIssue(issue: ValidationIssue): void;
}

export function LevelEditorValidationPanel({report, open, onOpenChange, onSelectIssue}: LevelEditorValidationPanelProps) {
  const total = report.issues.length;
  return (
    <section className={`le-validation ${open ? 'is-open' : ''}`} aria-label="Level validation results">
      <button className="le-validation__summary" type="button" onClick={() => onOpenChange(!open)} aria-expanded={open}>
        {report.counts.error > 0 ? <AlertCircle size={16} /> : total > 0 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
        <strong>Validation</strong>
        <span className="is-error">{report.counts.error} errors</span>
        <span className="is-warning">{report.counts.warning} warnings</span>
        <span>{report.counts.info} info</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="le-validation__drawer">
          <header><strong>{total === 0 ? 'No validation issues' : `${total} validation issue${total === 1 ? '' : 's'}`}</strong><button className="le-icon-button" type="button" onClick={() => onOpenChange(false)} aria-label="Close validation"><X size={16} /></button></header>
          {total === 0 ? (
            <p className="le-empty-state">The editor document passed structural and placement checks.</p>
          ) : (
            <ol>
              {report.issues.map((issue) => (
                <li key={issue.id}>
                  <button type="button" onClick={() => onSelectIssue(issue)}>
                    <IssueIcon severity={issue.severity} />
                    <span><strong>{issue.code}</strong>{issue.message}</span>
                    <small>{issue.entityId ?? issue.entityKind}</small>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function IssueIcon({severity}: Pick<ValidationIssue, 'severity'>) {
  if (severity === 'error') return <AlertCircle size={16} />;
  if (severity === 'warning') return <AlertTriangle size={16} />;
  return <Info size={16} />;
}
