'use client';

import {
  ArrowLeft,
  CarFront,
  Check,
  CircleAlert,
  CircleDot,
  Copy,
  ImagePlus,
  LoaderCircle,
  PanelLeft,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Upload,
  Wrench
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode
} from 'react';
import {
  VEHICLE_SOURCE_FRAMES,
  type VehicleBuildReport,
  type VehicleCandidate,
  type VehicleSourceFrame,
  type VehicleWorkshopCatalogResponse,
  type VehicleWorkshopManifest,
  type VehicleWorkshopRecord
} from '../../shared/content/vehicle-workshop.ts';
import {VehicleTestDrive} from './VehicleTestDrive.tsx';

type StageId = 'brief' | 'closed' | 'doors' | 'fit' | 'tune' | 'build';

const STAGES: readonly {id: StageId; label: string; hint: string}[] = [
  {id: 'brief', label: 'Describe', hint: 'Name the car and describe what it should look like.'},
  {id: 'closed', label: 'Create', hint: 'Generate or upload the initial closed car.'},
  {id: 'doors', label: 'Doors', hint: 'Create and review its four open-door states.'},
  {id: 'fit', label: 'Fit', hint: 'Align the artwork with its collision footprint.'},
  {id: 'tune', label: 'Drive', hint: 'Set handling and ambient traffic behavior.'},
  {id: 'build', label: 'Finish', hint: 'Validate and compile the car into the game.'}
];

export function VehicleWorkshopApp() {
  const [catalog, setCatalog] = useState<VehicleWorkshopCatalogResponse>();
  const [selectedId, setSelectedId] = useState('');
  const [stage, setStage] = useState<StageId>('brief');
  const [frame, setFrame] = useState<VehicleSourceFrame>('closed');
  const [candidate, setCandidate] = useState<VehicleCandidate>();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('Loading vehicle source...');
  const [error, setError] = useState('');
  const [buildReport, setBuildReport] = useState<VehicleBuildReport>();
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [testDriveOpen, setTestDriveOpen] = useState(false);

  const refresh = useCallback(async (preferredId?: string) => {
    const next = await requestJson<VehicleWorkshopCatalogResponse>('/api/vehicles');
    setCatalog(next);
    setSelectedId((current) => {
      const desired = preferredId || current;
      return next.vehicles.some((vehicle) => vehicle.manifest.id === desired)
        ? desired
        : next.vehicles[0]?.manifest.id ?? '';
    });
    setNotice(`${next.vehicles.length} vehicle sources loaded.`);
  }, []);

  useEffect(() => {
    void refresh().catch((loadError: unknown) => {
      setError(messageFrom(loadError));
      setNotice('Vehicle Workshop unavailable.');
    });
  }, [refresh]);

  const selected = catalog?.vehicles.find((vehicle) => vehicle.manifest.id === selectedId);
  const selectedClosedFrame = selected?.frames.find((item) => item.name === 'closed' && item.exists);
  useEffect(() => {
    setCandidate(undefined);
    setFrame('closed');
  }, [selectedId]);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError('');
    setNotice(label);
    try {
      await action();
    } catch (actionError) {
      setError(messageFrom(actionError));
      setNotice(`${label} failed.`);
    } finally {
      setBusy('');
    }
  }, []);

  if (!catalog) {
    return (
      <main className="vw-load-state" aria-live="polite">
        <LoaderCircle aria-hidden="true" />
        <strong>Opening Vehicle Workshop</strong>
        <span>{error || notice}</span>
      </main>
    );
  }

  return (
    <main id="vehicle-workshop">
      <WorkshopToolbar
        generatorConfigured={catalog.generatorConfigured}
        busy={busy}
        notice={notice}
        error={error}
        canTestDrive={Boolean(selectedClosedFrame?.url)}
        onLibrary={() => setLibraryOpen((open) => !open)}
        onRefresh={() => void run('Refreshing source...', () => refresh())}
        onTestDrive={() => setTestDriveOpen(true)}
        onNew={() => {
          setLibraryOpen(true);
          setNewDraftOpen(true);
        }}
      />

      <PipelineRail selected={selected} stage={stage} onStage={setStage} />

      <VehicleLibrary
        vehicles={catalog.vehicles}
        selectedId={selectedId}
        open={libraryOpen}
        newDraftOpen={newDraftOpen}
        busy={busy}
        onSelect={(id) => {
          setSelectedId(id);
          setLibraryOpen(false);
        }}
        onNewDraftOpen={setNewDraftOpen}
        onCreate={(input) => void run('Creating vehicle draft...', async () => {
          const manifest = await requestJson<VehicleWorkshopManifest>('/api/vehicles', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(input)
          });
          setNewDraftOpen(false);
          setStage('brief');
          await refresh(manifest.id);
        })}
      />

      {selected ? (
        <>
          <VehicleStage
            vehicle={selected}
            stage={stage}
            frame={frame}
            candidate={candidate}
            onFrame={setFrame}
            onCandidate={setCandidate}
          />
          <VehicleInspector
            vehicle={selected}
            stage={stage}
            frame={frame}
            candidate={candidate}
            generatorConfigured={catalog.generatorConfigured}
            busy={busy}
            buildReport={buildReport}
            onManifest={(manifest) => void run('Saving vehicle manifest...', async () => {
              await requestJson(`/api/vehicles/${encodeURIComponent(selected.manifest.id)}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(manifest)
              });
              await refresh(selected.manifest.id);
              setNotice('Vehicle manifest saved.');
            })}
            onGenerate={(frames) => void run(
              frames.length === 1 && frames[0] === 'closed'
                ? 'Generating closed car...'
                : 'Generating door variants...',
              async () => {
                const response = await requestJson<{candidates: VehicleCandidate[]}>(
                  `/api/vehicles/${encodeURIComponent(selected.manifest.id)}/generate`,
                  {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({frames, prompt: selected.manifest.generation.prompt})
                  }
                );
                await refresh(selected.manifest.id);
                const matching = response.candidates.find((item) => item.frame === frame) ?? response.candidates[0];
                if (matching) {
                  setFrame(matching.frame);
                  setCandidate(matching);
                }
              }
            )}
            onAccept={(accepted) => void run('Accepting processed frame...', async () => {
              await requestJson(`/api/vehicles/${encodeURIComponent(selected.manifest.id)}/accept`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({candidateId: accepted.id, frame: accepted.frame})
              });
              setFrame(accepted.frame);
              setCandidate(undefined);
              await refresh(selected.manifest.id);
              setNotice(`${frameLabel(accepted.frame)} accepted.`);
            })}
            onDuplicate={() => void run('Creating playable door placeholders...', async () => {
              await requestJson(`/api/vehicles/${encodeURIComponent(selected.manifest.id)}/duplicate-doors`, {
                method: 'POST'
              });
              await refresh(selected.manifest.id);
            })}
            onUpload={(uploadFrame, file) => void run(`Processing ${frameLabel(uploadFrame)}...`, async () => {
              const form = new FormData();
              form.append('frame', uploadFrame);
              form.append('file', file);
              const response = await requestJson<{candidate: {frame: VehicleSourceFrame; url: string}}>(
                `/api/vehicles/${encodeURIComponent(selected.manifest.id)}/upload`,
                {method: 'POST', body: form}
              );
              await refresh(selected.manifest.id);
              const latest = await requestJson<VehicleWorkshopCatalogResponse>('/api/vehicles');
              const record = latest.vehicles.find((item) => item.manifest.id === selected.manifest.id);
              const uploaded = record?.candidates.find((item) => item.url === response.candidate.url);
              if (uploaded) {
                setFrame(uploadFrame);
                setCandidate(uploaded);
              }
            })}
            onBuild={() => void run('Compiling vehicles...', async () => {
              const report = await requestJson<VehicleBuildReport>('/api/vehicles/build', {method: 'POST'});
              setBuildReport(report);
              setNotice(`Build complete: ${report.vehicles.join(', ')}.`);
              await refresh(selected.manifest.id);
            })}
          />
        </>
      ) : (
        <section className="vw-empty-workspace">
          <CarFront aria-hidden="true" />
          <strong>Create the first vehicle draft</strong>
        </section>
      )}

      {selected && selectedClosedFrame?.url && testDriveOpen ? (
        <VehicleTestDrive
          manifest={selected.manifest}
          spriteUrl={selectedClosedFrame.url}
          onClose={() => setTestDriveOpen(false)}
        />
      ) : null}

    </main>
  );
}

function WorkshopToolbar(props: {
  generatorConfigured: boolean;
  busy: string;
  notice: string;
  error: string;
  canTestDrive: boolean;
  onLibrary: () => void;
  onRefresh: () => void;
  onTestDrive: () => void;
  onNew: () => void;
}) {
  return (
    <header className="vw-toolbar">
      <a href="/editor" className="vw-icon-button" title="Back to level editor" aria-label="Back to level editor">
        <ArrowLeft aria-hidden="true" />
      </a>
      <div className="vw-toolbar__identity">
        <strong>NOCK0 Vehicle Workshop</strong>
      </div>
      <div
        className="vw-toolbar__status"
        data-ready={props.generatorConfigured && !props.error}
        data-error={Boolean(props.error)}
        title={props.notice}
      >
        {props.busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : props.error ? <CircleAlert aria-hidden="true" /> : <CircleDot aria-hidden="true" />}
        {props.error || props.busy || (props.generatorConfigured ? 'AI ready' : 'Upload mode')}
      </div>
      <span className="vw-toolbar__spacer" />
      <button
        className="vw-icon-button vw-library-toggle"
        type="button"
        onClick={props.onLibrary}
        title="Vehicle source library"
        aria-label="Vehicle source library"
      >
        <PanelLeft aria-hidden="true" />
      </button>
      <button className="vw-icon-button" type="button" onClick={props.onRefresh} disabled={Boolean(props.busy)} title="Refresh vehicle library" aria-label="Refresh vehicle library">
        <RefreshCw aria-hidden="true" />
      </button>
      <button className="vw-command" type="button" onClick={props.onTestDrive} disabled={!props.canTestDrive || Boolean(props.busy)}>
        <Play aria-hidden="true" /> Test drive
      </button>
      <button className="vw-command is-primary" type="button" onClick={props.onNew} disabled={Boolean(props.busy)}>
        <Plus aria-hidden="true" /> New vehicle
      </button>
    </header>
  );
}

function PipelineRail(props: {
  selected?: VehicleWorkshopRecord;
  stage: StageId;
  onStage: (stage: StageId) => void;
}) {
  const statuses = props.selected ? stageStatuses(props.selected) : {};
  return (
    <nav className="vw-pipeline" aria-label="Vehicle production pipeline">
      {STAGES.map((item, index) => {
        const complete = statuses[item.id] === true;
        return (
          <div className="vw-pipeline__segment" key={item.id}>
            <button
              type="button"
              className={props.stage === item.id ? 'is-active' : ''}
              data-complete={complete}
              onClick={() => props.onStage(item.id)}
            >
              <span>{complete ? <Check aria-hidden="true" /> : index + 1}</span>
              <b>{item.label}</b>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

function VehicleLibrary(props: {
  vehicles: VehicleWorkshopRecord[];
  selectedId: string;
  open: boolean;
  newDraftOpen: boolean;
  busy: string;
  onSelect: (id: string) => void;
  onNewDraftOpen: (open: boolean) => void;
  onCreate: (input: {id: string; label: string; prompt: string}) => void;
}) {
  return (
    <aside className={`vw-library${props.open ? ' is-open' : ''}`}>
      <header>
        <div><strong>Vehicle source</strong><span>{props.vehicles.length} records</span></div>
        <button
          type="button"
          className="vw-icon-button"
          title="New vehicle"
          aria-label="New vehicle"
          onClick={() => props.onNewDraftOpen(!props.newDraftOpen)}
        >
          <Plus aria-hidden="true" />
        </button>
      </header>
      {props.newDraftOpen ? (
        <NewVehicleForm
          busy={props.busy}
          onCancel={() => props.onNewDraftOpen(false)}
          onCreate={props.onCreate}
        />
      ) : null}
      <div className="vw-library__list">
        {props.vehicles.map((vehicle) => {
          const closed = vehicle.frames.find((item) => item.name === 'closed');
          const complete = vehicle.issues.length === 0;
          return (
            <button
              type="button"
              key={vehicle.manifest.id}
              className={props.selectedId === vehicle.manifest.id ? 'is-selected' : ''}
              onClick={() => props.onSelect(vehicle.manifest.id)}
            >
              <span className="vw-library__thumb">
                {closed?.url ? <img src={`${closed.url}?v=${vehicle.manifest.generation.updatedAt ?? 'source'}`} alt="" /> : <CarFront aria-hidden="true" />}
              </span>
              <span className="vw-library__copy">
                <strong>{vehicle.manifest.label}</strong>
                <small>{vehicle.manifest.id}</small>
              </span>
              <i data-ready={complete} aria-label={complete ? 'Ready' : vehicle.manifest.status}>
                {complete ? '' : 'Draft'}
              </i>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function NewVehicleForm(props: {
  busy: string;
  onCancel: () => void;
  onCreate: (input: {id: string; label: string; prompt: string}) => void;
}) {
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [prompt, setPrompt] = useState('');
  return (
    <form className="vw-new-vehicle" onSubmit={(event) => {
      event.preventDefault();
      props.onCreate({id, label, prompt});
    }}>
      <label>Vehicle id<input value={id} onChange={(event) => setId(slug(event.target.value))} placeholder="delivery-van" required /></label>
      <label>Display name<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Delivery Van" required /></label>
      <label>First brief<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Beige urban delivery van..." rows={3} required /></label>
      <div>
        <button type="button" className="vw-command" onClick={props.onCancel}>Cancel</button>
        <button type="submit" className="vw-command is-primary" disabled={Boolean(props.busy)}>
          <Plus aria-hidden="true" /> Create draft
        </button>
      </div>
    </form>
  );
}

function VehicleStage(props: {
  vehicle: VehicleWorkshopRecord;
  stage: StageId;
  frame: VehicleSourceFrame;
  candidate?: VehicleCandidate;
  onFrame: (frame: VehicleSourceFrame) => void;
  onCandidate: (candidate?: VehicleCandidate) => void;
}) {
  const accepted = props.vehicle.frames.find((item) => item.name === props.frame);
  const imageUrl = props.candidate?.url ?? accepted?.url;
  const manifest = props.vehicle.manifest;
  const frameOffset = manifest.presentation.offsets[props.frame];
  const stageIndex = STAGES.findIndex((item) => item.id === props.stage);
  const activeStage = STAGES[stageIndex];
  const showFrames = props.stage === 'doors' || props.stage === 'fit';
  return (
    <section className={`vw-stage${showFrames ? ' has-frames' : ''}`}>
      <header>
        <div>
          <span>Step {stageIndex + 1} of {STAGES.length}</span>
          <strong>{activeStage.label}</strong>
          <small>{activeStage.hint}</small>
        </div>
        <div className="vw-stage__readout">
          <span>{manifest.label}</span>
          <b>{props.candidate ? 'Candidate' : frameLabel(props.frame)}</b>
        </div>
      </header>
      <div className={`vw-stage__canvas${props.stage === 'fit' ? ' is-fit' : ''}`}>
        <div className="vw-stage__vehicle">
          {imageUrl ? (
            <img
              key={imageUrl}
              src={`${imageUrl}?v=${manifest.generation.updatedAt ?? Date.now()}`}
              alt={`${manifest.label}, ${frameLabel(props.frame)}`}
              style={props.candidate ? undefined : {
                transform: `translate(${frameOffset.x / 0.96}%, ${-frameOffset.y / 0.96}%)`
              }}
            />
          ) : (
            <div className="vw-stage__missing"><ImagePlus aria-hidden="true" /><span>No accepted frame</span></div>
          )}
          {!props.candidate && imageUrl && props.stage === 'fit' ? (
            <div
              className="vw-stage__collision"
              style={{
                width: `${manifest.collision.width * 3}px`,
                height: `${manifest.collision.length * 3}px`
              }}
            />
          ) : null}
        </div>
        {props.stage === 'fit' ? <><span className="vw-axis is-x" /><span className="vw-axis is-y" /></> : null}
      </div>
      {showFrames ? <div className="vw-frame-strip">
        {VEHICLE_SOURCE_FRAMES.map((sourceFrame) => {
          const source = props.vehicle.frames.find((item) => item.name === sourceFrame);
          return (
            <button
              type="button"
              key={sourceFrame}
              className={props.frame === sourceFrame ? 'is-selected' : ''}
              data-ready={source?.exists}
              onClick={() => {
                props.onFrame(sourceFrame);
                props.onCandidate(undefined);
              }}
            >
              <span>{source?.url ? <img src={source.url} alt="" /> : <ImagePlus aria-hidden="true" />}</span>
              <small>{frameShortLabel(sourceFrame)}</small>
            </button>
          );
        })}
      </div> : null}
    </section>
  );
}

function VehicleInspector(props: {
  vehicle: VehicleWorkshopRecord;
  stage: StageId;
  frame: VehicleSourceFrame;
  candidate?: VehicleCandidate;
  generatorConfigured: boolean;
  busy: string;
  buildReport?: VehicleBuildReport;
  onManifest: (manifest: VehicleWorkshopManifest) => void;
  onGenerate: (frames: VehicleSourceFrame[]) => void;
  onAccept: (candidate: VehicleCandidate) => void;
  onDuplicate: () => void;
  onUpload: (frame: VehicleSourceFrame, file: File) => void;
  onBuild: () => void;
}) {
  return (
    <aside className="vw-inspector">
      <header>
        <div><strong>{props.vehicle.manifest.label}</strong><span>{props.vehicle.manifest.id}</span></div>
        <StageHealth vehicle={props.vehicle} stage={props.stage} />
      </header>
      <div className="vw-inspector__body">
        {props.stage === 'brief' ? <BriefPanel {...props} /> : null}
        {props.stage === 'closed' ? <ClosedPanel {...props} /> : null}
        {props.stage === 'doors' ? <DoorsPanel {...props} /> : null}
        {props.stage === 'fit' ? <FitPanel {...props} /> : null}
        {props.stage === 'tune' ? <TunePanel {...props} /> : null}
        {props.stage === 'build' ? <BuildPanel {...props} /> : null}
      </div>
    </aside>
  );
}

function BriefPanel(props: InspectorProps) {
  const [draft, setDraft] = useState(props.vehicle.manifest);
  useEffect(() => setDraft(props.vehicle.manifest), [props.vehicle.manifest]);
  return (
    <PanelSection title="Generation brief" description="This prompt follows the vehicle through closed-car and door generation.">
      <label className="vw-field">Display name<input value={draft.label} onChange={(event) => setDraft({...draft, label: event.target.value})} /></label>
      <label className="vw-field">Vehicle description<textarea rows={8} value={draft.generation.prompt} onChange={(event) => setDraft({
        ...draft,
        generation: {...draft.generation, prompt: event.target.value}
      })} /></label>
      <label className="vw-field">Class<select value={draft.class} onChange={(event) => setDraft({
        ...draft,
        class: event.target.value as VehicleWorkshopManifest['class']
      })}><option value="civilian">Civilian</option><option value="service">Service</option><option value="emergency">Emergency</option></select></label>
      <button type="button" className="vw-wide-command is-primary" onClick={() => props.onManifest(draft)} disabled={Boolean(props.busy)}>
        <Save aria-hidden="true" /> Save brief
      </button>
    </PanelSection>
  );
}

function ClosedPanel(props: InspectorProps) {
  return (
    <>
      <PanelSection title="Create the source" description="Generate a fresh candidate or process an uploaded image through the same cleanup stage.">
        <GeneratorState configured={props.generatorConfigured} />
        <button
          type="button"
          className="vw-wide-command is-primary"
          onClick={() => props.onGenerate(['closed'])}
          disabled={!props.generatorConfigured || Boolean(props.busy)}
        >
          <Sparkles aria-hidden="true" /> Generate closed car
        </button>
        <UploadButton frame="closed" busy={props.busy} onUpload={props.onUpload} />
      </PanelSection>
      <CandidatePanel vehicle={props.vehicle} frame="closed" selected={props.candidate} onAccept={props.onAccept} />
    </>
  );
}

function DoorsPanel(props: InspectorProps) {
  const doors = VEHICLE_SOURCE_FRAMES.filter((item) => item !== 'closed');
  return (
    <>
      <PanelSection title="Door variants" description="The closed frame is used as the identity reference. Review every generated side separately.">
        <button
          type="button"
          className="vw-wide-command is-primary"
          onClick={() => props.onGenerate(doors)}
          disabled={!props.generatorConfigured || Boolean(props.busy) || !frameExists(props.vehicle, 'closed')}
        >
          <Sparkles aria-hidden="true" /> Generate four doors
        </button>
        <button
          type="button"
          className="vw-wide-command"
          onClick={props.onDuplicate}
          disabled={Boolean(props.busy) || !frameExists(props.vehicle, 'closed')}
        >
          <Copy aria-hidden="true" /> Duplicate closed as placeholders
        </button>
      </PanelSection>
      <PanelSection title={frameLabel(props.frame)} description="Upload and process an individual correction without regenerating the set.">
        <UploadButton frame={props.frame} busy={props.busy} onUpload={props.onUpload} />
      </PanelSection>
      <CandidatePanel vehicle={props.vehicle} frame={props.frame} selected={props.candidate} onAccept={props.onAccept} />
    </>
  );
}

function FitPanel(props: InspectorProps) {
  const [draft, setDraft] = useState(props.vehicle.manifest);
  useEffect(() => setDraft(props.vehicle.manifest), [props.vehicle.manifest]);
  const offset = draft.presentation.offsets[props.frame];
  return (
    <>
      <PanelSection title="Collision envelope" description="The orange box on the preview is the authoritative physics footprint.">
        <NumberGrid>
          <NumberField label="Length" value={draft.collision.length} onChange={(length) => setDraft({...draft, collision: {...draft.collision, length}})} />
          <NumberField label="Width" value={draft.collision.width} onChange={(width) => setDraft({...draft, collision: {...draft.collision, width}})} />
          <NumberField label="Radius" value={draft.radius} onChange={(radius) => setDraft({...draft, radius})} />
          <NumberField label="Seats" value={draft.seats} step={1} onChange={(seats) => setDraft({...draft, seats})} />
        </NumberGrid>
      </PanelSection>
      <PanelSection title={`${frameLabel(props.frame)} center`} description="Correct hand-authored frames whose chassis center moves when a door opens.">
        <NumberGrid>
          <NumberField label="Offset X" value={offset.x} step={0.5} onChange={(x) => setDraft(withOffset(draft, props.frame, {x, y: offset.y}))} />
          <NumberField label="Offset Y" value={offset.y} step={0.5} onChange={(y) => setDraft(withOffset(draft, props.frame, {x: offset.x, y}))} />
        </NumberGrid>
        <button type="button" className="vw-wide-command is-primary" onClick={() => props.onManifest(draft)} disabled={Boolean(props.busy)}>
          <Save aria-hidden="true" /> Save fit
        </button>
      </PanelSection>
    </>
  );
}

function TunePanel(props: InspectorProps) {
  const [draft, setDraft] = useState(props.vehicle.manifest);
  useEffect(() => setDraft(props.vehicle.manifest), [props.vehicle.manifest]);
  return (
    <>
      <PanelSection title="Vehicle behavior" description="A compact tuning surface for the values that most strongly change the feel.">
        <NumberGrid>
          <NumberField label="Top speed" value={draft.handling.maximumForwardSpeed} onChange={(maximumForwardSpeed) => setDraft({...draft, handling: {...draft.handling, maximumForwardSpeed}})} />
          <NumberField label="Acceleration" value={draft.handling.forwardAcceleration} onChange={(forwardAcceleration) => setDraft({...draft, handling: {...draft.handling, forwardAcceleration}})} />
          <NumberField label="Steering" value={draft.handling.steeringRate} step={0.05} onChange={(steeringRate) => setDraft({...draft, handling: {...draft.handling, steeringRate}})} />
          <NumberField label="Mass" value={draft.mass} step={0.05} onChange={(mass) => setDraft({...draft, mass})} />
          <NumberField label="Health" value={draft.maxHealth} step={10} onChange={(maxHealth) => setDraft({...draft, maxHealth})} />
          <NumberField label="Cruise" value={draft.traffic.cruiseSpeed} onChange={(cruiseSpeed) => setDraft({...draft, traffic: {...draft.traffic, cruiseSpeed}})} />
        </NumberGrid>
      </PanelSection>
      <PanelSection title="World population" description="These flags determine whether the compiler exposes the car to ambient systems.">
        <Toggle label="Parked spawns" checked={draft.population.parked} onChange={(parked) => setDraft({...draft, population: {...draft.population, parked}})} />
        <Toggle label="Ambient traffic" checked={draft.population.ambientTraffic} onChange={(ambientTraffic) => setDraft({...draft, population: {...draft.population, ambientTraffic}})} />
        <NumberField label="Traffic weight" value={draft.population.weight} step={1} onChange={(weight) => setDraft({...draft, population: {...draft.population, weight}})} />
        <button type="button" className="vw-wide-command is-primary" onClick={() => props.onManifest(draft)} disabled={Boolean(props.busy)}>
          <Save aria-hidden="true" /> Save tuning
        </button>
      </PanelSection>
    </>
  );
}

function BuildPanel(props: InspectorProps) {
  const complete = props.vehicle.issues.length === 0;
  const manifest = props.vehicle.manifest;
  return (
    <>
      <PanelSection title="Source validation" description="Only accepted frames and a valid manifest enter generated runtime output.">
        <ul className="vw-checklist">
          <CheckRow ok={Boolean(manifest.generation.prompt.trim())}>Generation brief saved</CheckRow>
          <CheckRow ok={frameExists(props.vehicle, 'closed')}>Closed frame accepted</CheckRow>
          <CheckRow ok={VEHICLE_SOURCE_FRAMES.every((frameName) => frameExists(props.vehicle, frameName))}>Five source frames accepted</CheckRow>
          <CheckRow ok={manifest.status === 'ready'}>Manifest marked ready</CheckRow>
        </ul>
      </PanelSection>
      {props.vehicle.issues.length ? (
        <div className="vw-issues">
          <CircleAlert aria-hidden="true" />
          <div>{props.vehicle.issues.map((issue) => <span key={issue}>{issue}</span>)}</div>
        </div>
      ) : null}
      <PanelSection title="Publish state" description="Drafts stay visible in the workshop but are excluded from game output.">
        <button
          type="button"
          className="vw-wide-command"
          disabled={!complete || Boolean(props.busy)}
          onClick={() => props.onManifest({...manifest, status: manifest.status === 'ready' ? 'draft' : 'ready'})}
        >
          <Settings2 aria-hidden="true" /> {manifest.status === 'ready' ? 'Move back to draft' : 'Mark ready'}
        </button>
        <button
          type="button"
          className="vw-wide-command is-primary"
          disabled={manifest.status !== 'ready' || !complete || Boolean(props.busy)}
          onClick={props.onBuild}
        >
          <Wrench aria-hidden="true" /> Compile game assets
        </button>
        {props.buildReport?.ok ? <a className="vw-wide-command" href="/" target="_blank"><Play aria-hidden="true" /> Open game</a> : null}
      </PanelSection>
    </>
  );
}

type InspectorProps = Parameters<typeof VehicleInspector>[0];

function CandidatePanel(props: {
  vehicle: VehicleWorkshopRecord;
  frame: VehicleSourceFrame;
  selected?: VehicleCandidate;
  onAccept: (candidate: VehicleCandidate) => void;
}) {
  const candidates = props.vehicle.candidates.filter((item) => item.frame === props.frame).slice(0, 4);
  if (!candidates.length) return null;
  return (
    <PanelSection title="Processed candidates" description="Candidates are cleaned and resized, but remain outside the source set until accepted.">
      <div className="vw-candidates">
        {candidates.map((item) => (
          <button
            type="button"
            key={item.id}
            className={props.selected?.id === item.id ? 'is-selected' : ''}
            onClick={() => props.onAccept(item)}
            title={`Accept ${frameLabel(item.frame)}`}
          >
            <img src={item.url} alt="" />
            <span><Check aria-hidden="true" /> Accept</span>
          </button>
        ))}
      </div>
    </PanelSection>
  );
}

function GeneratorState({configured}: {configured: boolean}) {
  return (
    <div className="vw-generator-state" data-ready={configured}>
      {configured ? <Sparkles aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
      <span>{configured ? 'GPT Image 2 is ready' : 'Add OPENAI_API_KEY or upload art'}</span>
    </div>
  );
}

function UploadButton(props: {
  frame: VehicleSourceFrame;
  busy: string;
  onUpload: (frame: VehicleSourceFrame, file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        className="vw-file-input"
        type="file"
        accept="image/png,image/webp,image/jpeg"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          if (file) props.onUpload(props.frame, file);
          event.target.value = '';
        }}
      />
      <button type="button" className="vw-wide-command" onClick={() => input.current?.click()} disabled={Boolean(props.busy)}>
        <Upload aria-hidden="true" /> Upload source image
      </button>
    </>
  );
}

function PanelSection(props: {title: string; description: string; children: ReactNode}) {
  return (
    <section className="vw-panel-section">
      <header><strong>{props.title}</strong><p>{props.description}</p></header>
      {props.children}
    </section>
  );
}

function NumberGrid({children}: {children: ReactNode}) {
  return <div className="vw-number-grid">{children}</div>;
}

function NumberField(props: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="vw-field">
      {props.label}
      <input type="number" value={props.value} step={props.step ?? 1} onChange={(event) => {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) props.onChange(value);
      }} />
    </label>
  );
}

function Toggle(props: {label: string; checked: boolean; onChange: (value: boolean) => void}) {
  return (
    <label className="vw-toggle">
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
      <span aria-hidden="true" />
      <b>{props.label}</b>
    </label>
  );
}

function CheckRow(props: {ok: boolean; children: ReactNode}) {
  return <li data-ready={props.ok}>{props.ok ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}<span>{props.children}</span></li>;
}

function StageHealth({vehicle, stage}: {vehicle: VehicleWorkshopRecord; stage: StageId}) {
  const complete = stageStatuses(vehicle)[stage];
  return <span className="vw-stage-health" data-ready={complete}>{complete ? <Check aria-hidden="true" /> : <CircleDot aria-hidden="true" />}{complete ? 'Complete' : 'In progress'}</span>;
}

function stageStatuses(vehicle: VehicleWorkshopRecord): Partial<Record<StageId, boolean>> {
  const allFrames = VEHICLE_SOURCE_FRAMES.every((frame) => frameExists(vehicle, frame));
  return {
    brief: Boolean(vehicle.manifest.generation.prompt.trim()),
    closed: frameExists(vehicle, 'closed'),
    doors: VEHICLE_SOURCE_FRAMES.filter((frame) => frame !== 'closed').every((frame) => frameExists(vehicle, frame)),
    fit: vehicle.manifest.collision.length > 0 && vehicle.manifest.collision.width > 0,
    tune: vehicle.manifest.mass > 0 && vehicle.manifest.handling.maximumForwardSpeed > 0,
    build: allFrames && vehicle.manifest.status === 'ready' && vehicle.issues.length === 0
  };
}

function frameExists(vehicle: VehicleWorkshopRecord, frame: VehicleSourceFrame): boolean {
  return vehicle.frames.some((item) => item.name === frame && item.exists);
}

function withOffset(
  manifest: VehicleWorkshopManifest,
  frame: VehicleSourceFrame,
  offset: {x: number; y: number}
): VehicleWorkshopManifest {
  return {
    ...manifest,
    presentation: {
      ...manifest.presentation,
      offsets: {...manifest.presentation.offsets, [frame]: offset}
    }
  };
}

function frameLabel(frame: VehicleSourceFrame): string {
  return frame === 'closed'
    ? 'Closed'
    : frame.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function frameShortLabel(frame: VehicleSourceFrame): string {
  const labels: Record<VehicleSourceFrame, string> = {
    closed: 'Closed',
    'front-left': 'FL',
    'front-right': 'FR',
    'rear-left': 'RL',
    'rear-right': 'RR'
  };
  return labels[frame];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function requestJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & {error?: string};
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
