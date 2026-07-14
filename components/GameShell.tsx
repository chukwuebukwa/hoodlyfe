import type {ReactElement} from 'react';

export function GameShell(): ReactElement {
  return <main id="game-shell" dangerouslySetInnerHTML={{__html: GAME_SHELL_HTML}} />;
}

const GAME_SHELL_HTML = `
  <div id="game"></div>
  <div id="loading" role="status">
    <div id="loading-panel">
      <strong id="loading-title">NOCK0</strong>
      <span id="loading-stage">Connecting to Industrial District</span>
      <div id="loading-progress" aria-label="Loading progress">
        <i id="loading-progress-fill"></i>
      </div>
      <small id="loading-percent">0%</small>
      <p id="loading-tip">Tip: stay off the sidewalk when the heat meter starts climbing.</p>
    </div>
  </div>
  <header id="district-label" class="hud-layer">
    <strong>NOCK0</strong>
    <span>Industrial District</span>
  </header>
  <button
    id="debug-toggle"
    class="hud-layer"
    type="button"
    aria-label="Toggle simulation debug view"
    aria-pressed="false"
    title="Toggle simulation debug view (F3)"
  >DBG</button>
  <aside id="debug-panel" class="hud-layer hidden" aria-label="Simulation debug information">
    <header>
      <strong>Simulation</strong>
      <span id="debug-clock">T0 / 0.0s</span>
    </header>
    <dl>
      <div><dt>Players</dt><dd id="debug-players">0</dd></div>
      <div><dt>NPCs</dt><dd id="debug-npcs">0</dd></div>
      <div><dt>Vehicles</dt><dd id="debug-vehicles">0</dd></div>
      <div><dt>Bullets</dt><dd id="debug-bullets">0</dd></div>
      <div><dt>Spatial</dt><dd id="debug-spatial">0</dd></div>
      <div><dt>Streaming</dt><dd id="debug-streaming">off</dd></div>
      <div><dt>Population</dt><dd id="debug-population">off</dd></div>
      <div><dt>Dropped</dt><dd id="debug-dropped">0ms</dd></div>
      <div><dt>Deferred</dt><dd id="debug-deferred">0</dd></div>
      <div><dt>Events</dt><dd id="debug-event-count">0</dd></div>
      <div><dt>Incidents</dt><dd id="debug-incidents">0</dd></div>
      <div><dt>Pursuits</dt><dd id="debug-pursuits">0</dd></div>
      <div><dt>Cruisers</dt><dd id="debug-cruisers">0</dd></div>
      <div><dt>Stimuli</dt><dd id="debug-stimuli">0</dd></div>
      <div><dt>Signals</dt><dd id="debug-signals">0</dd></div>
      <div><dt>Region</dt><dd id="debug-region">unknown</dd></div>
      <div><dt>RTT p50/p95</dt><dd id="debug-latency">0/0ms</dd></div>
      <div><dt>Patch p95</dt><dd id="debug-patch-gap">0ms</dd></div>
      <div><dt>Prediction</dt><dd id="debug-prediction">0px</dd></div>
      <div><dt>Clock / Buffer</dt><dd id="debug-clock-sync">unsynced</dd></div>
      <div class="debug-wide"><dt>Island budget</dt><dd id="debug-interaction-island">off</dd></div>
      <div class="debug-wide"><dt>Island replay</dt><dd id="debug-interaction-replay">off</dd></div>
      <div class="debug-wide"><dt>Island selection</dt><dd id="debug-interaction-selection">off</dd></div>
    </dl>
    <section id="debug-time-controls" class="hidden" aria-label="Time of day controls">
      <header><strong>Time of day</strong><output id="debug-time-value">08:00</output></header>
      <input id="debug-time-input" type="range" min="0" max="1439" step="10" value="480" aria-label="Debug time of day">
      <button id="debug-time-live" type="button">LIVE</button>
    </section>
    <div id="debug-legend" aria-label="Debug color legend">
      <span class="player">Player</span>
      <span class="civilian">Civilian</span>
      <span class="police">Police</span>
      <span class="vehicle">Vehicle</span>
      <span class="collision">Collision</span>
      <span class="incident">Incident</span>
      <span class="search">Search</span>
      <span class="stimulus">Stimulus</span>
      <span class="signal">Signal</span>
      <span class="island-root">Island root</span>
      <span class="island-contact">Contact</span>
      <span class="island-retained">Retained</span>
      <span class="island-imminent">Imminent</span>
      <span class="island-hysteresis">Hysteresis</span>
      <span class="island-closure">Closure</span>
      <span class="island-overflow">Island overflow</span>
      <span class="island-presented">Presented pose</span>
    </div>
    <ol id="debug-events"><li>No recent events</li></ol>
  </aside>
  <aside id="combat-hud" class="hud-layer" aria-label="Player combat status">
    <aside id="weapon-hud" aria-label="Equipped weapon">
      <button id="weapon-prev" type="button" aria-label="Previous weapon">&lt;</button>
      <img id="weapon-icon" src="/assets/original/weapons/pistol.svg" alt="pistol">
      <div>
        <strong id="weapon-name">PISTOL</strong>
        <span id="weapon-ammo">120</span>
      </div>
      <button id="weapon-next" type="button" aria-label="Next weapon">&gt;</button>
    </aside>
    <footer id="player-hud">
      <div id="player-identity">
        <span id="driver-name">Driver</span>
      </div>
      <div id="health-track" aria-label="Health 100"><span id="health-fill"></span></div>
      <div id="armor-track" class="hidden" aria-label="Armor 0"><span id="armor-fill"></span></div>
    </footer>
    <aside id="status-hud" aria-label="Player status">
      <div id="cash">$000000</div>
      <div id="heat-meter" aria-label="Heat level 0">
        <span>Heat</span>
        <i></i><i></i><i></i><i></i><i></i>
      </div>
    </aside>
    <aside id="vehicle-hud" class="hidden" aria-label="Vehicle speed">
      <strong id="speed-value">000</strong>
      <span>KM/H</span>
      <div id="vehicle-condition" aria-label="Vehicle condition 100"><i id="vehicle-condition-fill"></i></div>
    </aside>
    <aside id="radio-hud" class="hidden" aria-label="Vehicle radio">
      <button id="radio-prev" type="button" aria-label="Previous radio station">&lt;</button>
      <div>
        <strong id="radio-station">NCK-FM</strong>
        <span id="radio-meta">Station 0</span>
      </div>
      <button id="radio-next" type="button" aria-label="Next radio station">&gt;</button>
    </aside>
  </aside>
  <aside id="mission-hud" class="hud-layer hidden" aria-label="Freemode job">
    <header>
      <div id="mission-selector">
        <button id="mission-prev" type="button" aria-label="Previous Freemode job">&lt;</button>
        <strong id="mission-title">BOOST AND DELIVER</strong>
        <button id="mission-next" type="button" aria-label="Next Freemode job">&gt;</button>
      </div>
      <span id="mission-timer">00:00</span>
    </header>
    <p id="mission-objective">Meet the contact for work.</p>
    <footer>
      <span id="mission-meta">CREW 1/4 | $750</span>
      <button id="mission-action" type="button">START JOB</button>
    </footer>
  </aside>
  <aside id="minimap-hud" class="hud-layer" aria-label="District minimap">
    <canvas id="minimap-canvas" width="380" height="280" aria-label="District minimap"></canvas>
  </aside>
  <button id="vehicle-action-button" class="hud-layer hidden" type="button">ENTER CAR</button>
  <button id="phone-button" class="hud-layer" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Open phone">
    <span>NOCK</span>
    <strong>PHONE</strong>
  </button>
  <div id="event-toast" class="hud-layer" role="status"></div>
  <div id="death-screen" class="hidden" aria-live="assertive">
    <strong>WASTED</strong>
    <span id="medical-care-status">Public Ward</span>
    <div id="medical-care-actions" aria-label="Medical care choice">
      <button id="medical-public" type="button" aria-pressed="true">PUBLIC 4.2S</button>
      <button id="medical-trauma" type="button" aria-pressed="false">TRAUMA $250</button>
    </div>
  </div>
  <div id="touch-controls" aria-label="Touch game controls">
    <div id="move-stick" class="touch-stick" aria-label="Move">
      <i id="move-thumb"></i>
    </div>
    <button id="interact-button" type="button" aria-label="Enter or exit vehicle">CAR</button>
    <div id="aim-stick" class="touch-stick" aria-label="Aim and fire">
      <i id="aim-thumb"></i>
    </div>
  </div>
  <div id="connection-state" class="hud-layer">Online</div>
`;
