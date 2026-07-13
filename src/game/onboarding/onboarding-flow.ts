import {
  DEFAULT_LPC_RECIPE,
  LPC_BODY_OPTIONS,
  LPC_COLOR_OPTIONS,
  LPC_COLOR_VALUES,
  LPC_FACE_OPTIONS,
  LPC_HAT_OPTIONS,
  LPC_HAIR_OPTIONS,
  LPC_LEGS_OPTIONS,
  LPC_SHOE_OPTIONS,
  LPC_SKIN_COLOR_OPTIONS,
  LPC_SKIN_COLOR_VALUES,
  LPC_TOP_OPTIONS,
  cloneLpcRecipe,
  parseLpcRecipe,
  serializeLpcRecipe,
  validateLpcCharacterRecipe,
  type LpcCharacterRecipe,
  type LpcColorId,
  type LpcOption,
  type LpcSkinColorId
} from '../../../shared/content/lpc-character-catalog.ts';
import {
  cloneAppearance,
  type PlayerAppearance
} from '../../../shared/content/appearance-catalog.ts';
import type {ClientAuthPayload} from '../../../shared/protocol/auth.ts';
import {
  isPrivyBrowserAuthConfigured,
  loginPrivyWithEmailCode,
  restorePrivyLogin,
  sendPrivyEmailCode
} from '../auth/privy-email-auth.ts';
import {
  compileLpcCharacterSpriteSet,
  loadLpcSpriteSources,
  type CompiledLpcCharacterSpriteSet,
  type LpcSpriteSources
} from '../appearance/lpc-character-sprite-compiler.ts';
import {loadSavedAppearance, saveAppearance} from '../appearance/appearance-storage.ts';

const ONBOARDING_KEY = 'nock0-onboarding-v1';
const DRIVER_NAME_KEY = 'nock0-driver-name';
const LPC_STORAGE_KEY = 'nock0-lpc-recipe';

type RecipeField = 'body' | 'face' | 'hair' | 'hat' | 'top' | 'legs' | 'shoes';
type ColorField = 'skinColor' | 'hairColor' | 'hatColor' | 'topColor' | 'legsColor' | 'shoesColor';

export interface OnboardingResult {
  driverName: string;
  appearance: PlayerAppearance;
  auth: ClientAuthPayload;
}

const PART_GROUPS: ReadonlyArray<{
  field: RecipeField;
  label: string;
  options: readonly LpcOption<string>[];
}> = [
  {field: 'body', label: 'Body', options: LPC_BODY_OPTIONS},
  {field: 'face', label: 'Face', options: LPC_FACE_OPTIONS},
  {field: 'hair', label: 'Hair', options: LPC_HAIR_OPTIONS},
  {field: 'hat', label: 'Hat', options: LPC_HAT_OPTIONS},
  {field: 'top', label: 'Top', options: LPC_TOP_OPTIONS},
  {field: 'legs', label: 'Legs', options: LPC_LEGS_OPTIONS},
  {field: 'shoes', label: 'Shoes', options: LPC_SHOE_OPTIONS}
];

const COLOR_GROUPS: ReadonlyArray<{field: ColorField; label: string}> = [
  {field: 'skinColor', label: 'Skin'},
  {field: 'hairColor', label: 'Hair'},
  {field: 'hatColor', label: 'Hat'},
  {field: 'topColor', label: 'Top'},
  {field: 'legsColor', label: 'Legs'},
  {field: 'shoesColor', label: 'Shoes'}
];

export function loadOnboardingIdentity(): OnboardingResult {
  return {
    driverName: readStorage(DRIVER_NAME_KEY) ?? generatedDriverName(),
    appearance: loadSavedAppearance(),
    auth: {provider: 'guest'}
  };
}

export function shouldShowOnboarding(): boolean {
  const force = new URLSearchParams(window.location.search).get('onboarding') === '1';
  return force || !readStorage(ONBOARDING_KEY);
}

export function runOnboardingOverlay(
  initialName: string,
  initialAppearance: PlayerAppearance,
  initialAuth: ClientAuthPayload = {provider: 'guest'}
): Promise<OnboardingResult> {
  let recipe = recipeFromStorage(initialAppearance);
  let auth: ClientAuthPayload = initialAuth;
  let sources: LpcSpriteSources | undefined;
  let compiled: CompiledLpcCharacterSpriteSet | undefined;
  let animationStartedAt = performance.now();
  let frameTimer: number | undefined;

  const overlay = document.createElement('section');
  overlay.id = 'onboarding-flow';
  overlay.setAttribute('aria-label', 'NOCK0 onboarding');
  overlay.innerHTML = `
    <div class="onboarding-window">
      <header class="onboarding-window-header">
        <div><strong>NOCK0</strong><span>Industrial District</span></div>
        <i>Driver Intake</i>
      </header>
      <div class="onboarding-title" data-step="title">
        <div>
          <span>First Run</span>
          <strong>Enter The District</strong>
          <p>Login now or continue as guest, then build your driver before spawning into the street.</p>
        </div>
        <section class="onboarding-auth-panel" aria-label="Privy login">
          <strong>Driver Account</strong>
          <span id="onboarding-auth-status">Checking Privy session</span>
          <div class="onboarding-auth-row">
            <input id="onboarding-email" type="email" autocomplete="email" placeholder="email@domain.com">
            <button id="onboarding-send-code" type="button">SEND CODE</button>
          </div>
          <div class="onboarding-auth-row">
            <input id="onboarding-code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000">
            <button id="onboarding-login" type="button">LOGIN</button>
          </div>
          <div class="onboarding-title-actions">
            <button id="onboarding-guest" type="button">CONTINUE GUEST</button>
            <button id="onboarding-start" type="button">CREATE DRIVER</button>
          </div>
        </section>
      </div>
      <div class="onboarding-creator hidden" data-step="creator">
        <header>
          <div><strong>Create Driver</strong><span id="onboarding-status">LOADING LPC</span></div>
          <button id="onboarding-skip" type="button">SKIP</button>
        </header>
        <div class="onboarding-body">
          <section class="onboarding-controls">
            <label>Driver Name<input id="onboarding-name" maxlength="24" autocomplete="off"></label>
            <div id="onboarding-parts"></div>
          </section>
          <section class="onboarding-preview">
            <canvas id="onboarding-canvas" width="224" height="184"></canvas>
            <div id="onboarding-summary"></div>
          </section>
          <section class="onboarding-palette">
            <div id="onboarding-colors"></div>
          </section>
        </div>
        <footer>
          <button id="onboarding-randomize" type="button">RANDOM</button>
          <button id="onboarding-enter" type="button">ENTER DISTRICT</button>
        </footer>
      </div>
    </div>
  `;
  document.body.append(overlay);

  const titleStep = required<HTMLElement>(overlay, '.onboarding-title');
  const creatorStep = required<HTMLElement>(overlay, '.onboarding-creator');
  const authStatus = required<HTMLElement>(overlay, '#onboarding-auth-status');
  const emailInput = required<HTMLInputElement>(overlay, '#onboarding-email');
  const codeInput = required<HTMLInputElement>(overlay, '#onboarding-code');
  const sendCodeButton = required<HTMLButtonElement>(overlay, '#onboarding-send-code');
  const loginButton = required<HTMLButtonElement>(overlay, '#onboarding-login');
  const guestButton = required<HTMLButtonElement>(overlay, '#onboarding-guest');
  const startButton = required<HTMLButtonElement>(overlay, '#onboarding-start');
  const skipButton = required<HTMLButtonElement>(overlay, '#onboarding-skip');
  const enterButton = required<HTMLButtonElement>(overlay, '#onboarding-enter');
  const randomizeButton = required<HTMLButtonElement>(overlay, '#onboarding-randomize');
  const nameInput = required<HTMLInputElement>(overlay, '#onboarding-name');
  const status = required<HTMLElement>(overlay, '#onboarding-status');
  const parts = required<HTMLElement>(overlay, '#onboarding-parts');
  const colors = required<HTMLElement>(overlay, '#onboarding-colors');
  const summary = required<HTMLElement>(overlay, '#onboarding-summary');
  const canvas = required<HTMLCanvasElement>(overlay, '#onboarding-canvas');
  nameInput.value = initialName;

  const cleanup = (): void => {
    if (frameTimer !== undefined) window.clearInterval(frameTimer);
    overlay.remove();
  };

  const render = (): void => {
    renderParts(parts, recipe, updateRecipe);
    renderColors(colors, recipe, updateRecipe);
    summary.textContent = `${labelFor(LPC_HAT_OPTIONS, recipe.hat)} / ${labelFor(LPC_TOP_OPTIONS, recipe.top)} / ${labelFor(LPC_SHOE_OPTIONS, recipe.shoes)}`;
    drawPreview(canvas, compiled, animationStartedAt);
  };

  const recompile = (): void => {
    if (!sources) return;
    compiled = compileLpcCharacterSpriteSet(sources, recipe);
    animationStartedAt = performance.now();
    render();
  };

  const finish = (): OnboardingResult => {
    const name = sanitizeDriverName(nameInput.value) || initialName;
    recipe = validateLpcCharacterRecipe({...recipe, name}) ?? recipe;
    const lpcRecipe = serializeLpcRecipe(recipe);
    const appearance = {
      ...cloneAppearance(initialAppearance),
      outfitName: recipe.name,
      lpcRecipe
    };
    writeStorage(DRIVER_NAME_KEY, name);
    writeStorage(LPC_STORAGE_KEY, lpcRecipe);
    writeStorage(ONBOARDING_KEY, JSON.stringify({
      version: 1,
      completedAt: new Date().toISOString()
    }));
    saveAppearance(appearance);
    cleanup();
    return {driverName: name, appearance, auth};
  };

  function updateRecipe(value: unknown): void {
    const candidate = validateLpcCharacterRecipe(value);
    if (!candidate) return;
    recipe = candidate;
    recompile();
  }

  return new Promise((resolve) => {
    const showCreator = (): void => {
      titleStep.classList.add('hidden');
      creatorStep.classList.remove('hidden');
      nameInput.focus();
    };
    const setGuest = (): void => {
      auth = {provider: 'guest'};
      authStatus.textContent = 'Guest driver selected';
      showCreator();
    };

    if (!isPrivyBrowserAuthConfigured()) {
      authStatus.textContent = 'Privy app id missing; guest mode available';
      sendCodeButton.disabled = true;
      loginButton.disabled = true;
    } else {
      restorePrivyLogin().then((result) => {
        if (!result) {
          authStatus.textContent = 'Enter email for Privy code';
          return;
        }
        auth = result.auth;
        authStatus.textContent = `Privy session ready: ${result.label}`;
      }).catch((error) => {
        authStatus.textContent = 'Privy session unavailable';
        console.error(error);
      });
    }

    sendCodeButton.addEventListener('click', () => {
      authStatus.textContent = 'Sending Privy code';
      sendPrivyEmailCode(emailInput.value).then(() => {
        authStatus.textContent = 'Code sent. Check email.';
        codeInput.focus();
      }).catch((error) => {
        authStatus.textContent = messageFromError(error);
      });
    });
    loginButton.addEventListener('click', () => {
      authStatus.textContent = 'Verifying Privy code';
      loginPrivyWithEmailCode(emailInput.value, codeInput.value).then((result) => {
        auth = result.auth;
        authStatus.textContent = `Privy ready: ${result.label}`;
      }).catch((error) => {
        authStatus.textContent = messageFromError(error);
      });
    });
    guestButton.addEventListener('click', setGuest);
    startButton.addEventListener('click', () => {
      showCreator();
    });
    skipButton.addEventListener('click', () => resolve(finish()));
    enterButton.addEventListener('click', () => resolve(finish()));
    randomizeButton.addEventListener('click', () => {
      updateRecipe({
        ...recipe,
        body: randomOption(LPC_BODY_OPTIONS),
        hair: randomOption(LPC_HAIR_OPTIONS),
        hat: randomOption(LPC_HAT_OPTIONS),
        top: randomOption(LPC_TOP_OPTIONS),
        legs: randomOption(LPC_LEGS_OPTIONS),
        shoes: randomOption(LPC_SHOE_OPTIONS),
        skinColor: randomOption(LPC_SKIN_COLOR_OPTIONS),
        hairColor: randomOption(LPC_COLOR_OPTIONS),
        hatColor: randomOption(LPC_COLOR_OPTIONS),
        topColor: randomOption(LPC_COLOR_OPTIONS),
        legsColor: randomOption(LPC_COLOR_OPTIONS),
        shoesColor: randomOption(LPC_COLOR_OPTIONS)
      });
    });
    nameInput.addEventListener('input', () => {
      const name = sanitizeDriverName(nameInput.value) || DEFAULT_LPC_RECIPE.name;
      updateRecipe({...recipe, name});
    });

    render();
    loadLpcSpriteSources().then((loaded) => {
      sources = loaded;
      status.textContent = 'READY';
      recompile();
      frameTimer = window.setInterval(() => drawPreview(canvas, compiled, animationStartedAt), 90);
    }).catch((error) => {
      status.textContent = 'LPC LOAD ERROR';
      console.error(error);
    });
  });
}

function renderParts(
  root: HTMLElement,
  recipe: LpcCharacterRecipe,
  update: (value: unknown) => void
): void {
  root.replaceChildren(...PART_GROUPS.map((group) => {
    const section = document.createElement('section');
    const label = document.createElement('strong');
    label.textContent = group.label;
    const grid = document.createElement('div');
    grid.className = 'onboarding-option-grid';
    grid.replaceChildren(...group.options.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.label;
      button.setAttribute('aria-pressed', String(recipe[group.field] === option.id));
      button.addEventListener('click', () => update({...recipe, [group.field]: option.id}));
      return button;
    }));
    section.append(label, grid);
    return section;
  }));
}

function renderColors(
  root: HTMLElement,
  recipe: LpcCharacterRecipe,
  update: (value: unknown) => void
): void {
  root.replaceChildren(...COLOR_GROUPS.map((group) => {
    const fixed = fixedColor(group.field, recipe);
    const section = document.createElement('section');
    const label = document.createElement('strong');
    label.textContent = fixed ?? group.label;
    const grid = document.createElement('div');
    grid.className = 'onboarding-swatch-grid';
    grid.replaceChildren(...colorOptionsFor(group.field).map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.setProperty('--swatch', colorValueFor(group.field, option.id));
      button.setAttribute('aria-label', option.label);
      button.setAttribute('aria-pressed', String(recipe[group.field] === option.id));
      button.disabled = Boolean(fixed);
      button.addEventListener('click', () => update({...recipe, [group.field]: option.id}));
      return button;
    }));
    section.append(label, grid);
    return section;
  }));
}

function drawPreview(
  canvas: HTMLCanvasElement,
  compiled: CompiledLpcCharacterSpriteSet | undefined,
  startedAt: number
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!compiled) {
    context.fillStyle = '#151b1d';
    context.fillRect(32, 8, 160, 160);
    return;
  }
  const frame = 19 + Math.floor((performance.now() - startedAt) / 110) % 8;
  context.drawImage(
    compiled.walk,
    frame % 9 * 72,
    Math.floor(frame / 9) * 72,
    72,
    72,
    32,
    8,
    160,
    160
  );
}

function recipeFromStorage(appearance: PlayerAppearance): LpcCharacterRecipe {
  return parseLpcRecipe(appearance.lpcRecipe) ??
    parseLpcRecipe(readStorage(LPC_STORAGE_KEY)) ??
    cloneLpcRecipe();
}

function fixedColor(field: ColorField, recipe: LpcCharacterRecipe): string | undefined {
  if (field === 'topColor' && recipe.top === 'smiley') return 'Top Fixed';
  if (field === 'hatColor' && !['winter_hat', 'cavalier'].includes(recipe.hat)) return 'Hat Fixed';
  if (field === 'shoesColor' && recipe.shoes === 'timbs') return 'Shoes Fixed';
  return undefined;
}

function colorOptionsFor(field: ColorField): readonly LpcOption<LpcColorId | LpcSkinColorId>[] {
  return field === 'skinColor' ? LPC_SKIN_COLOR_OPTIONS : LPC_COLOR_OPTIONS;
}

function colorValueFor(field: ColorField, color: LpcColorId | LpcSkinColorId): string {
  return field === 'skinColor'
    ? LPC_SKIN_COLOR_VALUES[color as LpcSkinColorId]
    : LPC_COLOR_VALUES[color as LpcColorId];
}

function sanitizeDriverName(value: string): string {
  return value.replace(/[^A-Za-z0-9 '-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function generatedDriverName(): string {
  return `Driver-${Math.floor(1000 + Math.random() * 9000)}`;
}

function randomOption<T extends string>(options: readonly LpcOption<T>[]): T {
  return options[Math.floor(Math.random() * options.length)].id;
}

function labelFor<T extends string>(options: readonly LpcOption<T>[], value: T): string {
  return options.find((option) => option.id === value)?.label ?? value;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Onboarding is missing ${selector}`);
  return element;
}

function readStorage(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Onboarding still returns the selected appearance for the active join.
  }
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Privy login failed';
}
