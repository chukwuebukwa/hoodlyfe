import type {ReactElement} from 'react';

export function GameShell(): ReactElement {
  return <main id="game-shell" dangerouslySetInnerHTML={{__html: GAME_SHELL_HTML}} />;
}

const GAME_SHELL_HTML = `
  <div id="game"></div>
  <div id="loading" role="status">
    <div id="loading-panel">
      <strong id="loading-title">HOODLYFE</strong>
      <span id="loading-stage">Connecting to Industrial District</span>
      <div id="loading-progress" aria-label="Loading progress">
        <i id="loading-progress-fill"></i>
      </div>
      <small id="loading-percent">0%</small>
      <p id="loading-tip">Tip: stay off the sidewalk when the heat meter starts climbing.</p>
    </div>
  </div>
  <header id="district-label" class="hud-layer">
    <strong>HOODLYFE</strong>
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
  <button id="settings-toggle" class="hud-layer" type="button" aria-label="Open settings" aria-expanded="false" title="Settings">&#9881;</button>
  <div id="settings-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <section id="settings-panel">
      <header>
        <strong id="settings-title">Settings</strong>
        <button id="settings-close" type="button" aria-label="Close settings">&times;</button>
      </header>
      <label class="settings-toggle-row" for="settings-camera-explorer">
        <span>Explorer view</span>
        <input id="settings-camera-explorer" type="checkbox" role="switch" aria-label="Use first-person explorer camera">
      </label>
    </section>
  </div>
  <div id="storefront-overlay" class="hidden" aria-hidden="true">
    <section id="storefront-panel" role="dialog" aria-modal="true" aria-labelledby="storefront-title">
      <header class="storefront-header">
        <div>
          <span>Vehicle Service</span>
          <strong id="storefront-title">Repair Garage</strong>
        </div>
        <div class="storefront-header__account">
          <span>Available cash</span>
          <strong id="storefront-balance">$0</strong>
        </div>
        <button id="storefront-close" type="button" aria-label="Close storefront">&times;</button>
      </header>

      <nav class="storefront-rail" aria-label="Garage departments">
        <button type="button" data-storefront-category="service" aria-pressed="true">
          <span>01</span>
          <strong>Service</strong>
        </button>
        <button type="button" data-storefront-category="lighting" aria-pressed="false">
          <span>02</span>
          <strong>Lighting</strong>
        </button>
      </nav>

      <section class="storefront-stage" aria-label="Vehicle preview">
        <div id="storefront-preview"></div>
        <header class="storefront-vehicle">
          <div>
            <span>Current vehicle</span>
            <strong id="storefront-vehicle-label">Vehicle</strong>
            <small id="storefront-vehicle-meta">—</small>
          </div>
          <div class="storefront-condition">
            <span>Condition <strong id="storefront-condition-value">100%</strong></span>
            <div aria-hidden="true"><i id="storefront-condition-fill"></i></div>
          </div>
        </header>
        <dl class="storefront-diagnostics">
          <div><dt>Engine</dt><dd id="storefront-engine-value">Clear</dd></div>
          <div><dt>Body</dt><dd id="storefront-body-value">Clear</dd></div>
          <div><dt>Preview</dt><dd>Live</dd></div>
        </dl>
      </section>

      <aside class="storefront-inspector">
        <header>
          <span>Available options</span>
          <strong>Choose one</strong>
        </header>
        <div id="storefront-products" aria-label="Store products"></div>
        <section class="storefront-selection" aria-live="polite">
          <span>Selected</span>
          <strong id="storefront-selection-label">Select an option</strong>
          <p id="storefront-selection-description">Preview a product before purchase.</p>
          <div>
            <span>Price</span>
            <strong id="storefront-selection-price">—</strong>
          </div>
        </section>
        <footer>
          <p id="storefront-status" role="status" data-tone="neutral"></p>
          <button id="storefront-purchase" type="button" disabled>Select an option</button>
        </footer>
      </aside>
    </section>
  </div>
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
      <div className="debug-wide"><dt>Map chunks</dt><dd id="debug-map-streaming">off</dd></div>
      <div><dt>Population</dt><dd id="debug-population">off</dd></div>
      <div><dt>Dropped</dt><dd id="debug-dropped">0ms</dd></div>
      <div><dt>Deferred</dt><dd id="debug-deferred">0</dd></div>
      <div><dt>Events</dt><dd id="debug-event-count">0</dd></div>
      <div><dt>Incidents</dt><dd id="debug-incidents">0</dd></div>
      <div><dt>Pursuits</dt><dd id="debug-pursuits">0</dd></div>
      <div><dt>Cruisers</dt><dd id="debug-cruisers">0</dd></div>
      <div class="debug-wide"><dt>Police response</dt><dd id="debug-police-response">off</dd></div>
      <div class="debug-wide"><dt>Custody</dt><dd id="debug-police-arrests">0 active</dd></div>
      <div class="debug-wide"><dt>Roadblocks</dt><dd id="debug-police-roadblocks">0 active</dd></div>
      <div class="debug-wide"><dt>Stingers</dt><dd id="debug-police-stingers">0 active</dd></div>
      <div><dt>Stimuli</dt><dd id="debug-stimuli">0</dd></div>
      <div><dt>Signals</dt><dd id="debug-signals">0</dd></div>
      <div class="debug-wide"><dt>Junctions</dt><dd id="debug-junctions">0 active</dd></div>
      <div class="debug-wide"><dt>Traffic risk</dt><dd id="debug-traffic-risk">clear</dd></div>
      <div class="debug-wide"><dt>Road graph</dt><dd id="debug-roads">off</dd></div>
      <div><dt>Region</dt><dd id="debug-region">unknown</dd></div>
      <div><dt>RTT p50/p95</dt><dd id="debug-latency">0/0ms</dd></div>
      <div><dt>Patch p95</dt><dd id="debug-patch-gap">0ms</dd></div>
      <div><dt>Clock / Buffer</dt><dd id="debug-clock-sync">unsynced</dd></div>
      <div class="debug-wide"><dt>Netcode rollout</dt><dd id="debug-netcode-rollout">pending</dd></div>
      <div class="debug-wide"><dt>Player reaction</dt><dd id="debug-player-reaction">off</dd></div>
      <div class="debug-wide"><dt>Physical surface</dt><dd id="debug-surface">off</dd></div>
      <div class="debug-wide"><dt>Server phases</dt><dd id="debug-simulation-phases">off</dd></div>
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
      <span class="traffic-deadlock">Deadlock cycle</span>
      <span class="traffic-recovery">Recovery owner</span>
    </div>
    <ol id="debug-events"><li>No recent events</li></ol>
  </aside>
  <aside id="combat-hud" class="hud-layer" aria-label="Player combat status">
    <aside id="weapon-hud" aria-label="Equipped weapon">
      <button id="weapon-prev" type="button" aria-label="Previous weapon">&lt;</button>
      <img id="weapon-icon" src="/assets/original/weapons/pistol.svg" alt="pistol">
      <div>
        <strong id="weapon-name">PISTOL</strong>
        <span id="weapon-ammo">12 / 108</span>
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
        <strong id="mission-title">BOOST AND DELIVER</strong>
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
  <div id="vehicle-handbrake-hint" class="hud-layer context-control hidden" aria-hidden="true">
    <kbd>Space</kbd><span>Handbrake</span>
  </div>
  <button id="phone-button" class="hud-layer hidden" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Open phone" aria-hidden="true">
    <span>NOCK</span>
    <strong>PHONE</strong>
  </button>
  <aside id="voice-hud" class="hud-layer" aria-label="Proximity voice chat">
    <button id="voice-button" type="button" aria-pressed="false" title="Listening is automatic. Click once to allow your mic, then hold V to talk">VOICE</button>
    <span id="voice-status">OFF</span>
  </aside>
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
    <button id="handbrake-button" type="button" aria-label="Hold handbrake">HB</button>
    <button id="reload-button" type="button" aria-label="Reload weapon">RLD</button>
    <button id="voice-touch-button" type="button" aria-label="Hold to talk">PTT</button>
    <div id="aim-stick" class="touch-stick" aria-label="Aim and fire">
      <i id="aim-thumb"></i>
    </div>
  </div>
  <div id="connection-state" class="hud-layer">Online</div>
`;
