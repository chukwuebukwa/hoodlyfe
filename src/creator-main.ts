import {
  APPEARANCE_COLORS,
  BODY_OPTIONS,
  BOTTOM_OPTIONS,
  COLOR_OPTIONS,
  COLOR_VALUES,
  HAIR_OPTIONS,
  HEADWEAR_OPTIONS,
  SHOE_OPTIONS,
  SKIN_OPTIONS,
  TOP_OPTIONS,
  cloneAppearance,
  validateAppearance,
  type AppearanceColorId,
  type AppearanceOption,
  type PlayerAppearance
} from '../shared/content/appearance-catalog.ts';
import {
  CHARACTER_ATLASES,
  CHARACTER_CLIPS,
  characterClipFrame,
  type CharacterClipId
} from '../shared/content/character-animation-manifest.ts';
import {
  compileCharacterSpriteSet,
  type CharacterCompilerSources,
  type CompiledCharacterSpriteSet
} from './game/appearance/character-sprite-compiler.ts';
import {appearanceSpritePresentation} from './game/appearance/appearance-render-policy.ts';
import {loadSavedAppearance, saveAppearance} from './game/appearance/appearance-storage.ts';
import './creator.css';

type PartCategory = 'body' | 'skin' | 'hair' | 'headwear' | 'top' | 'bottom' | 'shoes';
type MaterialField = 'hairColor' | 'topColor' | 'accentColor' | 'bottomColor' | 'shoeColor';

interface PartCategoryDefinition {
  field: keyof PlayerAppearance;
  label: string;
  options: readonly AppearanceOption<string>[];
}

const PART_CATEGORIES: Readonly<Record<PartCategory, PartCategoryDefinition>> = {
  body: {field: 'bodyType', label: 'Body', options: BODY_OPTIONS},
  skin: {field: 'skinTone', label: 'Skin', options: SKIN_OPTIONS},
  hair: {field: 'hairStyle', label: 'Hair', options: HAIR_OPTIONS},
  headwear: {field: 'headwear', label: 'Headwear', options: HEADWEAR_OPTIONS},
  top: {field: 'topStyle', label: 'Top', options: TOP_OPTIONS},
  bottom: {field: 'bottomStyle', label: 'Bottoms', options: BOTTOM_OPTIONS},
  shoes: {field: 'shoeStyle', label: 'Shoes', options: SHOE_OPTIONS}
};

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

let appearance = loadSavedAppearance();
let activeCategory: PartCategory = 'body';
let activeMaterial: MaterialField = 'topColor';
let activeClip: CharacterClipId = 'idle';
let zoom = 6;
let animationStartedAt = performance.now();
let previousFrame = -1;
let sources: CharacterCompilerSources;
let compiled: CompiledCharacterSpriteSet;
let animationHandle = 0;

initialize().catch((error) => {
  compileState.textContent = 'COMPILER ERROR';
  compileState.classList.add('error');
  console.error(error);
});

async function initialize(): Promise<void> {
  compileState.textContent = 'LOADING SOURCES';
  const [walk, actions, walkMask, actionsMask] = await Promise.all([
    loadImage(CHARACTER_ATLASES.walk.source),
    loadImage(CHARACTER_ATLASES.actions.source),
    loadImage(CHARACTER_ATLASES.walk.materialMask),
    loadImage(CHARACTER_ATLASES.actions.materialMask)
  ]);
  sources = {walk, actions, walkMask, actionsMask};
  bindEvents();
  renderMaterialSwatches();
  outfitName.value = appearance.outfitName;
  recompile();
  animationHandle = requestAnimationFrame(animate);
}

function bindEvents(): void {
  partCategories.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isPartCategory(target.dataset.category)) return;
    activeCategory = target.dataset.category;
    for (const button of partCategories.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-selected', String(button.dataset.category === activeCategory));
    }
    renderPartOptions();
  });
  partOptions.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-value]')
      : null;
    if (!target) return;
    const definition = PART_CATEGORIES[activeCategory];
    updateAppearance({...appearance, [definition.field]: target.dataset.value});
  });
  clipSelector.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isClip(target.dataset.clip)) return;
    activeClip = target.dataset.clip;
    animationStartedAt = performance.now();
    previousFrame = -1;
    for (const button of clipSelector.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-selected', String(button.dataset.clip === activeClip));
    }
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
    if (!(target instanceof HTMLButtonElement)) return;
    const color = target.dataset.color;
    if (!APPEARANCE_COLORS.includes(color as AppearanceColorId)) return;
    updateAppearance({...appearance, [activeMaterial]: color});
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
    const candidate = validateAppearance({...appearance, outfitName: outfitName.value || 'Untitled Fit'});
    if (candidate) {
      appearance = candidate;
      renderRecipe();
    }
  });
  required<HTMLButtonElement>('#randomize-look').addEventListener('click', randomizeAppearance);
  required<HTMLButtonElement>('#reset-look').addEventListener('click', () => {
    updateAppearance(cloneAppearance());
  });
  required<HTMLButtonElement>('#save-look').addEventListener('click', saveRecipe);
  required<HTMLButtonElement>('#export-recipe').addEventListener('click', exportRecipe);
  required<HTMLButtonElement>('#export-walk').addEventListener('click', () => {
    downloadCanvas(compiled.walk, `${fileStem()}-walk.png`);
  });
  required<HTMLButtonElement>('#export-actions').addEventListener('click', () => {
    downloadCanvas(compiled.actions, `${fileStem()}-actions.png`);
  });
  window.addEventListener('beforeunload', () => cancelAnimationFrame(animationHandle), {once: true});
}

function updateAppearance(value: unknown): void {
  const candidate = validateAppearance(value);
  if (!candidate) return;
  appearance = candidate;
  outfitName.value = appearance.outfitName;
  recompile();
}

function recompile(): void {
  compileState.textContent = 'COMPILING';
  compiled = compileCharacterSpriteSet(sources, appearance);
  animationStartedAt = performance.now();
  previousFrame = -1;
  renderPartOptions();
  renderMaterialSelection();
  renderTimeline();
  renderRecipe();
  compileState.textContent = 'READY';
  compileState.classList.remove('error');
}

function renderPartOptions(): void {
  const definition = PART_CATEGORIES[activeCategory];
  partOptions.replaceChildren();
  partCount.textContent = `${definition.options.length} OPTIONS`;
  for (const option of definition.options) {
    const candidate = validateAppearance({...appearance, [definition.field]: option.id});
    if (!candidate) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'part-option';
    button.dataset.value = option.id;
    button.setAttribute('aria-pressed', String(appearance[definition.field] === option.id));
    const canvas = document.createElement('canvas');
    canvas.width = 72;
    canvas.height = 72;
    canvas.setAttribute('aria-hidden', 'true');
    const candidateSet = compileCharacterSpriteSet(sources, candidate);
    drawCharacterFrame(canvas, candidateSet, candidate, 'idle', 0, 1.65);
    const label = document.createElement('span');
    label.textContent = option.label;
    const meta = document.createElement('small');
    meta.textContent = activeCategory === 'body' ? 'STANDARD-01' : 'AVAILABLE';
    button.append(canvas, label, meta);
    partOptions.append(button);
  }
}

function renderMaterialSwatches(): void {
  materialSwatches.replaceChildren();
  for (const option of COLOR_OPTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.color = option.id;
    button.style.setProperty('--swatch', cssColor(COLOR_VALUES[option.id]));
    button.setAttribute('aria-label', option.label);
    button.title = option.label;
    materialSwatches.append(button);
  }
}

function renderMaterialSelection(): void {
  materialName.textContent = materialLabel(activeMaterial);
  for (const button of materialTabs.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-selected', String(button.dataset.material === activeMaterial));
  }
  for (const button of materialSwatches.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.color === appearance[activeMaterial]));
  }
}

function renderTimeline(): void {
  const clip = CHARACTER_CLIPS[activeClip];
  frameTimeline.replaceChildren();
  clipTitle.textContent = clip.id.toUpperCase();
  clip.frames.forEach((frame, index) => {
    const item = document.createElement('div');
    item.className = 'timeline-frame';
    item.dataset.index = String(index);
    const canvas = document.createElement('canvas');
    canvas.width = 72;
    canvas.height = 72;
    drawCharacterFrame(canvas, compiled, appearance, activeClip, frame, 1.4);
    const label = document.createElement('span');
    label.textContent = String(frame + 1).padStart(2, '0');
    item.append(canvas, label);
    frameTimeline.append(item);
  });
}

function renderRecipe(): void {
  recipeJson.textContent = JSON.stringify(appearance, null, 2);
  recipeKey.textContent = shortHash(compiled.key);
  bodyFamily.textContent = `${appearance.bodyType.toUpperCase()}-01`;
}

function animate(nowMs: number): void {
  const frame = characterClipFrame(activeClip, nowMs - animationStartedAt);
  if (frame !== previousFrame) {
    previousFrame = frame;
    drawCharacterFrame(stage, compiled, appearance, activeClip, frame, zoom);
    const clip = CHARACTER_CLIPS[activeClip];
    const index = Math.max(0, clip.frames.indexOf(frame));
    frameReadout.textContent = `FRAME ${String(index + 1).padStart(2, '0')} / ${String(clip.frames.length).padStart(2, '0')}`;
    for (const element of frameTimeline.querySelectorAll<HTMLElement>('.timeline-frame')) {
      element.classList.toggle('active', Number(element.dataset.index) === index);
    }
  }
  animationHandle = requestAnimationFrame(animate);
}

function drawCharacterFrame(
  canvas: HTMLCanvasElement,
  spriteSet: CompiledCharacterSpriteSet,
  recipe: PlayerAppearance,
  clipId: CharacterClipId,
  frame: number,
  scale: number
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const clip = CHARACTER_CLIPS[clipId];
  const atlas = CHARACTER_ATLASES[clip.atlas];
  const source = clip.atlas === 'walk' ? spriteSet.walk : spriteSet.actions;
  const width = atlas.frameSize * scale * appearanceSpritePresentation(recipe).bodyScaleX;
  const height = atlas.frameSize * scale;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    source,
    frame % atlas.columns * atlas.frameSize,
    Math.floor(frame / atlas.columns) * atlas.frameSize,
    atlas.frameSize,
    atlas.frameSize,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height
  );
}

function randomizeAppearance(): void {
  updateAppearance({
    outfitName: 'Generated Fit',
    bodyType: randomOption(BODY_OPTIONS),
    skinTone: randomOption(SKIN_OPTIONS),
    hairStyle: randomOption(HAIR_OPTIONS),
    hairColor: randomOption(COLOR_OPTIONS),
    headwear: randomOption(HEADWEAR_OPTIONS),
    topStyle: randomOption(TOP_OPTIONS),
    topColor: randomOption(COLOR_OPTIONS),
    accentColor: randomOption(COLOR_OPTIONS),
    bottomStyle: randomOption(BOTTOM_OPTIONS),
    bottomColor: randomOption(COLOR_OPTIONS),
    shoeStyle: randomOption(SHOE_OPTIONS),
    shoeColor: randomOption(COLOR_OPTIONS)
  });
}

function saveRecipe(): void {
  saveAppearance(appearance);
  compileState.textContent = 'SAVED LOCALLY';
  window.setTimeout(() => {
    if (compileState.textContent === 'SAVED LOCALLY') compileState.textContent = 'READY';
  }, 1200);
}

function exportRecipe(): void {
  downloadBlob(
    new Blob([`${JSON.stringify(appearance, null, 2)}\n`], {type: 'application/json'}),
    `${fileStem()}-recipe.json`
  );
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
  return appearance.outfitName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `V1-${(hash >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), {once: true});
    image.addEventListener('error', () => reject(new Error(`Unable to load ${source}`)), {once: true});
    image.src = source;
  });
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Character Lab is missing ${selector}`);
  return element;
}

function requiredCanvas(selector: string): HTMLCanvasElement {
  return required<HTMLCanvasElement>(selector);
}

function randomOption<T extends string>(options: readonly AppearanceOption<T>[]): T {
  return options[Math.floor(Math.random() * options.length)].id;
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function materialLabel(field: MaterialField): string {
  return field === 'hairColor' ? 'HAIR' : field === 'topColor' ? 'TOP' :
    field === 'accentColor' ? 'TRIM' : field === 'bottomColor' ? 'LEGS' : 'SHOES';
}

function isPartCategory(value: unknown): value is PartCategory {
  return typeof value === 'string' && Object.hasOwn(PART_CATEGORIES, value);
}

function isClip(value: unknown): value is CharacterClipId {
  return typeof value === 'string' && Object.hasOwn(CHARACTER_CLIPS, value);
}

function isMaterialField(value: unknown): value is MaterialField {
  return ['hairColor', 'topColor', 'accentColor', 'bottomColor', 'shoeColor'].includes(String(value));
}
