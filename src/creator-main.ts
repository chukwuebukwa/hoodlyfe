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
  lpcLayerDefinitions,
  lpcRecipeKey,
  parseLpcRecipe,
  serializeLpcRecipe,
  validateLpcCharacterRecipe,
  type LpcCharacterRecipe,
  type LpcColorId,
  type LpcOption,
  type LpcSkinColorId
} from '../shared/content/lpc-character-catalog.ts';
import {
  compileLpcCharacterSpriteSet,
  loadLpcSpriteSources,
  type CompiledLpcCharacterSpriteSet,
  type LpcSpriteSources
} from './game/appearance/lpc-character-sprite-compiler.ts';
import {loadSavedAppearance, saveAppearance} from './game/appearance/appearance-storage.ts';
import './creator.css';

type PartCategory = 'body' | 'face' | 'hair' | 'hat' | 'top' | 'legs' | 'shoes';
type MaterialField = 'skinColor' | 'hairColor' | 'hatColor' | 'topColor' | 'legsColor' | 'shoesColor';
type PreviewClip = 'idle' | 'walk' | 'melee' | 'hit' | 'vehicle';

interface PartCategoryDefinition<T extends string> {
  field: keyof LpcCharacterRecipe;
  label: string;
  options: readonly LpcOption<T>[];
}

const PART_CATEGORIES: Readonly<Record<PartCategory, PartCategoryDefinition<string>>> = {
  body: {field: 'body', label: 'Body', options: LPC_BODY_OPTIONS},
  face: {field: 'face', label: 'Face', options: LPC_FACE_OPTIONS},
  hair: {field: 'hair', label: 'Hair', options: LPC_HAIR_OPTIONS},
  hat: {field: 'hat', label: 'Hat', options: LPC_HAT_OPTIONS},
  top: {field: 'top', label: 'Top', options: LPC_TOP_OPTIONS},
  legs: {field: 'legs', label: 'Legs', options: LPC_LEGS_OPTIONS},
  shoes: {field: 'shoes', label: 'Shoes', options: LPC_SHOE_OPTIONS}
};

const CLIPS: Readonly<Record<PreviewClip, {label: string; atlas: 'walk' | 'actions'; frames: readonly number[]; frameMs: number}>> = {
  idle: {label: 'Idle', atlas: 'walk', frames: [18], frameMs: 280},
  walk: {label: 'Walk', atlas: 'walk', frames: [19, 20, 21, 22, 23, 24, 25, 26], frameMs: 105},
  melee: {label: 'Melee', atlas: 'actions', frames: [0, 1, 2, 3], frameMs: 110},
  hit: {label: 'Hit', atlas: 'actions', frames: [4, 5, 6, 7], frameMs: 145},
  vehicle: {label: 'Vehicle', atlas: 'actions', frames: [8, 9, 10, 11], frameMs: 130}
};

const LPC_STORAGE_KEY = 'nock0-lpc-recipe';
const COLORABLE_HATS = new Set<string>([
  'bandana',
  'bowler',
  'crown',
  'tiara',
  'winter_hat',
  'santa',
  'elf',
  'wizard',
  'pirate_bandana',
  'cavalier',
  'tricorne'
]);

const stage = requiredCanvas('#character-stage');
const partCategories = required<HTMLElement>('#part-categories');
const partOptions = required<HTMLElement>('#part-options');
const partCount = required<HTMLElement>('#part-count');
const clipSelector = required<HTMLElement>('#clip-selector');
const frameTimeline = required<HTMLElement>('#frame-timeline');
const materialTabs = required<HTMLElement>('#material-tabs');
const materialSwatches = required<HTMLElement>('#material-swatches');
const outfitName = required<HTMLInputElement>('#outfit-name');
const recipeJson = required<HTMLElement>('#recipe-json');
const recipeKey = required<HTMLElement>('#recipe-key');
const bodyFamily = required<HTMLElement>('#body-family');
const compileState = required<HTMLElement>('#compile-state');
const clipTitle = required<HTMLElement>('#clip-title');
const frameReadout = required<HTMLElement>('#frame-readout');
const materialName = required<HTMLElement>('#material-name');

let recipe = loadSavedLpcRecipe();
let sources: LpcSpriteSources;
let compiled: CompiledLpcCharacterSpriteSet;
let activeCategory: PartCategory = 'hair';
let activeMaterial: MaterialField = 'hairColor';
let activeClip: PreviewClip = 'walk';
let zoom = 6;
let animationStartedAt = performance.now();
let previousFrame = -1;
let animationHandle = 0;

initialize().catch((error) => {
  compileState.textContent = 'LPC LOAD ERROR';
  compileState.classList.add('error');
  console.error(error);
});

async function initialize(): Promise<void> {
  compileState.textContent = 'LOADING LPC';
  sources = await loadLpcSpriteSources();
  bindEvents();
  outfitName.value = recipe.name;
  renderCategoryTabs();
  renderClipTabs();
  renderMaterialSwatches();
  recompile();
  animationHandle = requestAnimationFrame(animate);
}

function bindEvents(): void {
  partCategories.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isPartCategory(target.dataset.category)) return;
    activeCategory = target.dataset.category;
    renderCategoryTabs();
    renderPartOptions();
  });
  partOptions.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-value]')
      : null;
    if (!target) return;
    const definition = PART_CATEGORIES[activeCategory];
    updateRecipe({...recipe, [definition.field]: target.dataset.value});
  });
  clipSelector.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isPreviewClip(target.dataset.clip)) return;
    activeClip = target.dataset.clip;
    animationStartedAt = performance.now();
    previousFrame = -1;
    renderClipTabs();
    renderTimeline();
  });
  materialTabs.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isMaterialField(target.dataset.material)) return;
    activeMaterial = target.dataset.material;
    renderMaterialSelection();
  });
  materialSwatches.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isLpcColor(target.dataset.color)) return;
    updateRecipe({...recipe, [activeMaterial]: target.dataset.color});
  });
  required<HTMLElement>('#zoom-controls').addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const nextZoom = Number(target.dataset.zoom);
    if (![4, 6, 7].includes(nextZoom)) return;
    zoom = nextZoom;
    for (const button of document.querySelectorAll<HTMLButtonElement>('#zoom-controls button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.zoom) === zoom));
    }
    previousFrame = -1;
  });
  outfitName.addEventListener('input', () => {
    const candidate = validateLpcCharacterRecipe({...recipe, name: outfitName.value || 'LPC Driver'});
    if (!candidate) return;
    recipe = candidate;
    renderRecipe();
  });
  required<HTMLButtonElement>('#randomize-look').addEventListener('click', randomizeRecipe);
  required<HTMLButtonElement>('#reset-look').addEventListener('click', () => updateRecipe(cloneLpcRecipe()));
  required<HTMLButtonElement>('#save-look').addEventListener('click', useInGame);
  required<HTMLButtonElement>('#export-recipe').addEventListener('click', exportRecipe);
  required<HTMLButtonElement>('#export-walk').addEventListener('click', () => {
    downloadCanvas(compiled.walk, `${fileStem()}-lpc-walk-4dir.png`);
  });
  required<HTMLButtonElement>('#export-actions').addEventListener('click', () => {
    downloadCanvas(compiled.actions, `${fileStem()}-lpc-actions.png`);
  });
  required<HTMLButtonElement>('#copy-recipe').addEventListener('click', async () => {
    await navigator.clipboard.writeText(`${JSON.stringify(recipe, null, 2)}\n`);
    flashState('COPIED JSON');
  });
  const importInput = required<HTMLInputElement>('#import-recipe');
  required<HTMLButtonElement>('#import-look').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const parsed = parseLpcRecipe(text);
      if (parsed) updateRecipe(parsed);
      importInput.value = '';
    });
  });
  window.addEventListener('beforeunload', () => cancelAnimationFrame(animationHandle), {once: true});
}

function updateRecipe(value: unknown): void {
  const candidate = validateLpcCharacterRecipe(value);
  if (!candidate) return;
  recipe = candidate;
  outfitName.value = recipe.name;
  recompile();
}

function recompile(): void {
  compileState.textContent = 'COMPILING LPC';
  compiled = compileLpcCharacterSpriteSet(sources, recipe);
  animationStartedAt = performance.now();
  previousFrame = -1;
  renderPartOptions();
  renderMaterialSelection();
  renderTimeline();
  renderRecipe();
  compileState.classList.remove('error');
  compileState.textContent = 'READY';
}

function renderCategoryTabs(): void {
  for (const button of partCategories.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-selected', String(button.dataset.category === activeCategory));
  }
}

function renderClipTabs(): void {
  for (const button of clipSelector.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-selected', String(button.dataset.clip === activeClip));
  }
}

function renderPartOptions(): void {
  const definition = PART_CATEGORIES[activeCategory];
  partOptions.replaceChildren();
  partCount.textContent = `${definition.options.length} OPTIONS`;
  for (const option of definition.options) {
    const candidate = validateLpcCharacterRecipe({...recipe, [definition.field]: option.id});
    if (!candidate) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'part-option';
    button.dataset.value = option.id;
    button.setAttribute('aria-pressed', String(recipe[definition.field] === option.id));
    const canvas = document.createElement('canvas');
    canvas.width = 72;
    canvas.height = 72;
    const candidateSet = compileLpcCharacterSpriteSet(sources, candidate);
    drawAtlasFrame(canvas, candidateSet.walk, 9, 18, 1.55);
    const label = document.createElement('span');
    label.textContent = option.label;
    const meta = document.createElement('small');
    meta.textContent = activeCategory.toUpperCase();
    button.append(canvas, label, meta);
    partOptions.append(button);
  }
}

function renderMaterialSwatches(): void {
  materialSwatches.replaceChildren();
  for (const option of colorOptionsFor(activeMaterial)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.color = option.id;
    button.style.setProperty('--swatch', colorValueFor(activeMaterial, option.id));
    button.setAttribute('aria-label', option.label);
    button.title = option.label;
    materialSwatches.append(button);
  }
}

function renderMaterialSelection(): void {
  const fixedTop = activeMaterial === 'topColor' && recipe.top === 'smiley';
  const fixedHat = activeMaterial === 'hatColor' && !COLORABLE_HATS.has(recipe.hat);
  const fixedShoes = activeMaterial === 'shoesColor' && recipe.shoes === 'timbs';
  renderMaterialSwatches();
  materialName.textContent = fixedTop
    ? 'TOP FIXED'
    : fixedHat
      ? 'HAT FIXED'
      : fixedShoes
        ? 'SHOES FIXED'
        : materialLabel(activeMaterial);
  for (const button of materialTabs.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-selected', String(button.dataset.material === activeMaterial));
  }
  for (const button of materialSwatches.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.color === recipe[activeMaterial]));
    button.disabled = fixedTop || fixedHat || fixedShoes;
  }
}

function renderTimeline(): void {
  const clip = CLIPS[activeClip];
  frameTimeline.replaceChildren();
  clipTitle.textContent = clip.label.toUpperCase();
  clip.frames.forEach((frame, index) => {
    const item = document.createElement('div');
    item.className = 'timeline-frame';
    item.dataset.index = String(index);
    const canvas = document.createElement('canvas');
    canvas.width = 72;
    canvas.height = 72;
    drawAtlasFrame(canvas, clip.atlas === 'walk' ? compiled.walk : compiled.actions, clip.atlas === 'walk' ? 9 : 4, frame, 1.35);
    const label = document.createElement('span');
    label.textContent = String(index + 1).padStart(2, '0');
    item.append(canvas, label);
    frameTimeline.append(item);
  });
}

function renderRecipe(): void {
  const serialized = serializeLpcRecipe(recipe);
  recipeJson.textContent = JSON.stringify(recipe, null, 2);
  recipeKey.textContent = shortHash(lpcRecipeKey(recipe));
  bodyFamily.textContent = `LPC-${recipe.body.toUpperCase()}`;
  required<HTMLElement>('#recipe-bytes').textContent = `${serialized.length} B`;
  required<HTMLElement>('#recipe-status').textContent = 'VALID';
  required<HTMLElement>('#coverage-summary').textContent = `${lpcLayerDefinitions(recipe).length} LAYERS`;
  required<HTMLElement>('#validation-list').replaceChildren(
    validationItem('4-direction walk atlas'),
    validationItem('NOCK0 action fallback atlas'),
    validationItem('Replicates through player appearance')
  );
  const stack = required<HTMLElement>('#layer-stack');
  stack.replaceChildren(...lpcLayerDefinitions(recipe).map((layer) => {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.textContent = `${String(layer.zPos).padStart(3, '0')} ${layer.label}`;
    return row;
  }));
}

function animate(nowMs: number): void {
  const clip = CLIPS[activeClip];
  const index = Math.floor((nowMs - animationStartedAt) / clip.frameMs) % clip.frames.length;
  const frame = clip.frames[index];
  if (frame !== previousFrame) {
    previousFrame = frame;
    drawAtlasFrame(stage, clip.atlas === 'walk' ? compiled.walk : compiled.actions, clip.atlas === 'walk' ? 9 : 4, frame, zoom);
    frameReadout.textContent = `FRAME ${String(index + 1).padStart(2, '0')} / ${String(clip.frames.length).padStart(2, '0')}`;
    for (const element of frameTimeline.querySelectorAll<HTMLElement>('.timeline-frame')) {
      element.classList.toggle('active', Number(element.dataset.index) === index);
    }
  }
  animationHandle = requestAnimationFrame(animate);
}

function drawAtlasFrame(
  canvas: HTMLCanvasElement,
  atlas: HTMLCanvasElement,
  columns: number,
  frame: number,
  scale: number
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const frameSize = 72;
  const width = frameSize * scale;
  const height = frameSize * scale;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    atlas,
    frame % columns * frameSize,
    Math.floor(frame / columns) * frameSize,
    frameSize,
    frameSize,
    Math.floor((canvas.width - width) / 2),
    Math.floor((canvas.height - height) / 2),
    width,
    height
  );
}

function randomizeRecipe(): void {
  updateRecipe({
    ...recipe,
    name: 'LPC Driver',
    body: randomOption(LPC_BODY_OPTIONS),
    face: randomOption(LPC_FACE_OPTIONS),
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
}

function useInGame(): void {
  const serialized = serializeLpcRecipe(recipe);
  window.localStorage.setItem(LPC_STORAGE_KEY, serialized);
  const appearance = loadSavedAppearance();
  saveAppearance({
    ...appearance,
    outfitName: recipe.name,
    lpcRecipe: serialized
  });
  flashState('SAVED FOR GAME');
}

function exportRecipe(): void {
  downloadBlob(
    new Blob([`${JSON.stringify(recipe, null, 2)}\n`], {type: 'application/json'}),
    `${fileStem()}-lpc-recipe.json`
  );
}

function loadSavedLpcRecipe(): LpcCharacterRecipe {
  return parseLpcRecipe(window.localStorage.getItem(LPC_STORAGE_KEY) ?? undefined) ??
    parseLpcRecipe(loadSavedAppearance().lpcRecipe) ??
    cloneLpcRecipe();
}

function validationItem(text: string): HTMLLIElement {
  const item = document.createElement('li');
  item.textContent = text;
  return item;
}

function flashState(text: string): void {
  compileState.textContent = text;
  window.setTimeout(() => {
    if (compileState.textContent === text) compileState.textContent = 'READY';
  }, 1200);
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string): void {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, name);
  }, 'image/png');
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileStem(): string {
  return recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lpc-character';
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `LPC-${(hash >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`LPC creator is missing ${selector}`);
  return element;
}

function requiredCanvas(selector: string): HTMLCanvasElement {
  return required<HTMLCanvasElement>(selector);
}

function randomOption<T extends string>(options: readonly LpcOption<T>[]): T {
  return options[Math.floor(Math.random() * options.length)].id;
}

function materialLabel(field: MaterialField): string {
  return field === 'skinColor'
    ? 'SKIN'
    : field === 'hairColor'
    ? 'HAIR'
    : field === 'hatColor'
      ? 'HAT'
      : field === 'topColor'
        ? 'TOP'
        : field === 'legsColor'
          ? 'LEGS'
          : 'SHOES';
}

function isPartCategory(value: unknown): value is PartCategory {
  return typeof value === 'string' && Object.hasOwn(PART_CATEGORIES, value);
}

function isPreviewClip(value: unknown): value is PreviewClip {
  return typeof value === 'string' && Object.hasOwn(CLIPS, value);
}

function isMaterialField(value: unknown): value is MaterialField {
  return ['skinColor', 'hairColor', 'hatColor', 'topColor', 'legsColor', 'shoesColor'].includes(String(value));
}

function isLpcColor(value: unknown): value is LpcColorId | LpcSkinColorId {
  return typeof value === 'string' && (
    LPC_COLOR_OPTIONS.some((option) => option.id === value) ||
    LPC_SKIN_COLOR_OPTIONS.some((option) => option.id === value)
  );
}

function colorOptionsFor(field: MaterialField): readonly LpcOption<LpcColorId | LpcSkinColorId>[] {
  return field === 'skinColor' ? LPC_SKIN_COLOR_OPTIONS : LPC_COLOR_OPTIONS;
}

function colorValueFor(field: MaterialField, color: LpcColorId | LpcSkinColorId): string {
  return field === 'skinColor'
    ? LPC_SKIN_COLOR_VALUES[color as LpcSkinColorId]
    : LPC_COLOR_VALUES[color as LpcColorId];
}
