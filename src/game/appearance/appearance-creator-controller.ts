import type {Room} from 'colyseus.js';
import {
  DEFAULT_LPC_RECIPE,
  LPC_COLOR_OPTIONS,
  LPC_COLOR_VALUES,
  LPC_FACE_OPTIONS,
  LPC_HAT_OPTIONS,
  LPC_HAIR_OPTIONS,
  LPC_LEGS_OPTIONS,
  LPC_SHOE_OPTIONS,
  LPC_TOP_OPTIONS,
  cloneLpcRecipe,
  parseLpcRecipe,
  serializeLpcRecipe,
  validateLpcCharacterRecipe,
  type LpcCharacterRecipe,
  type LpcColorId,
  type LpcOption
} from '../../../shared/content/lpc-character-catalog.ts';
import {
  cloneAppearance,
  validateAppearance,
  type PlayerAppearance
} from '../../../shared/content/appearance-catalog.ts';
import type {DistrictNetworkState} from '../types.ts';
import {saveAppearance} from './appearance-storage.ts';
import {
  compileLpcCharacterSpriteSet,
  loadLpcSpriteSources,
  type CompiledLpcCharacterSpriteSet,
  type LpcSpriteSources
} from './lpc-character-sprite-compiler.ts';
import {WardrobeClientSession} from './wardrobe-client-session.ts';

type LpcPartCategory = 'face' | 'hair' | 'hat' | 'top' | 'legs' | 'shoes';
type LpcMaterialField = 'hairColor' | 'hatColor' | 'topColor' | 'legsColor' | 'shoesColor';

interface PartCategoryDefinition<T extends string> {
  field: keyof LpcCharacterRecipe;
  label: string;
  options: readonly LpcOption<T>[];
}

const PART_CATEGORIES: Readonly<Record<LpcPartCategory, PartCategoryDefinition<string>>> = {
  face: {field: 'face', label: 'Face', options: LPC_FACE_OPTIONS},
  hair: {field: 'hair', label: 'Hair', options: LPC_HAIR_OPTIONS},
  hat: {field: 'hat', label: 'Hat', options: LPC_HAT_OPTIONS},
  top: {field: 'top', label: 'Top', options: LPC_TOP_OPTIONS},
  legs: {field: 'legs', label: 'Legs', options: LPC_LEGS_OPTIONS},
  shoes: {field: 'shoes', label: 'Shoes', options: LPC_SHOE_OPTIONS}
};

const MATERIAL_FIELDS: readonly LpcMaterialField[] = ['hairColor', 'hatColor', 'topColor', 'legsColor', 'shoesColor'];
const LPC_STORAGE_KEY = 'nock0-lpc-recipe';

export class AppearanceCreatorController {
  private readonly wardrobeSession: WardrobeClientSession;
  private readonly modal: HTMLElement;
  private readonly title: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly applyButton: HTMLButtonElement;
  private readonly randomizeButton: HTMLButtonElement;
  private readonly outfitName: HTMLInputElement;
  private readonly categoryTabs: HTMLElement;
  private readonly partOptions: HTMLElement;
  private readonly materialTabs: HTMLElement;
  private readonly swatches: HTMLElement;
  private readonly preview: HTMLCanvasElement;
  private readonly status: HTMLElement;
  private readonly layerCount: HTMLElement;
  private state?: DistrictNetworkState;
  private draftAppearance?: PlayerAppearance;
  private draftRecipe: LpcCharacterRecipe = cloneLpcRecipe();
  private activeCategory: LpcPartCategory = 'hair';
  private activeMaterial: LpcMaterialField = 'hairColor';
  private openState = false;
  private sources?: LpcSpriteSources;
  private compiledPreview?: CompiledLpcCharacterSpriteSet;
  private previewStartedAt = 0;
  private previewTimer?: number;
  private loading = false;

  constructor(
    private readonly room: Room<DistrictNetworkState>,
    private readonly localPlayerId: string,
    private readonly root: Document = document
  ) {
    const elements = createModal(root);
    this.modal = elements.modal;
    this.title = elements.title;
    this.closeButton = elements.closeButton;
    this.cancelButton = elements.cancelButton;
    this.applyButton = elements.applyButton;
    this.randomizeButton = elements.randomizeButton;
    this.outfitName = elements.outfitName;
    this.categoryTabs = elements.categoryTabs;
    this.partOptions = elements.partOptions;
    this.materialTabs = elements.materialTabs;
    this.swatches = elements.swatches;
    this.preview = elements.preview;
    this.status = elements.status;
    this.layerCount = elements.layerCount;
    this.bindEvents();
    this.renderStaticControls();
    this.wardrobeSession = new WardrobeClientSession({
      room,
      onInventory: () => undefined,
      onOpen: () => this.openWithMode('wardrobe'),
      onApplyResult: this.handleAppearanceResult
    });
    this.wardrobeSession.start();
  }

  isOpen(): boolean {
    return this.openState;
  }

  synchronize(state: DistrictNetworkState): void {
    this.state = state;
    const player = state.players.get(this.localPlayerId);
    if (!player?.alive && this.openState) this.close();
    if (!this.openState && player?.appearance) {
      this.draftAppearance = cloneAppearance(player.appearance);
      this.draftRecipe = recipeFromAppearance(player.appearance);
    }
  }

  destroy(): void {
    this.close();
    this.wardrobeSession.destroy();
    this.modal.remove();
    this.root.removeEventListener('keydown', this.handleKeydown);
  }

  private bindEvents(): void {
    this.closeButton.addEventListener('click', this.close);
    this.cancelButton.addEventListener('click', this.close);
    this.applyButton.addEventListener('click', this.apply);
    this.randomizeButton.addEventListener('click', this.randomize);
    this.outfitName.addEventListener('input', this.updateName);
    this.categoryTabs.addEventListener('click', this.selectCategory);
    this.partOptions.addEventListener('click', this.selectPart);
    this.materialTabs.addEventListener('click', this.selectMaterial);
    this.swatches.addEventListener('click', this.selectColor);
    this.modal.addEventListener('click', this.closeFromBackdrop);
    this.root.addEventListener('keydown', this.handleKeydown);
  }

  private async ensureSources(): Promise<void> {
    if (this.sources || this.loading) return;
    this.loading = true;
    this.status.textContent = 'LOADING LPC';
    try {
      this.sources = await loadLpcSpriteSources();
      this.status.textContent = 'READY';
    } finally {
      this.loading = false;
    }
  }

  private openWithMode(mode: 'creator' | 'wardrobe'): void {
    const player = this.state?.players.get(this.localPlayerId);
    if (!player?.alive) return;
    this.draftAppearance = cloneAppearance(player.appearance);
    this.draftRecipe = recipeFromAppearance(player.appearance);
    this.title.textContent = mode === 'wardrobe' ? 'THREADS CHARACTER CREATOR' : 'CHARACTER CREATOR';
    this.outfitName.value = this.draftRecipe.name;
    this.openState = true;
    this.modal.classList.remove('hidden');
    this.room.send('input', {x: 0, y: 0});
    void this.ensureSources().then(() => {
      this.recompile();
      this.startPreviewAnimation();
      this.outfitName.focus();
    }).catch((error) => {
      this.status.textContent = 'LPC LOAD ERROR';
      console.error(error);
    });
    this.renderAll();
  }

  private readonly close = (event?: Event): void => {
    event?.stopPropagation();
    this.openState = false;
    this.stopPreviewAnimation();
    this.modal.classList.add('hidden');
  };

  private readonly closeFromBackdrop = (event: Event): void => {
    if (event.target === this.modal) this.close(event);
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (this.openState && event.key === 'Escape') this.close(event);
  };

  private readonly updateName = (): void => {
    const candidate = validateLpcCharacterRecipe({
      ...this.draftRecipe,
      name: this.outfitName.value || DEFAULT_LPC_RECIPE.name
    });
    if (!candidate) return;
    this.draftRecipe = candidate;
    this.renderRecipeMeta();
  };

  private readonly selectCategory = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isPartCategory(target.dataset.category)) return;
    this.activeCategory = target.dataset.category;
    this.renderPartTabs();
    this.renderPartOptions();
  };

  private readonly selectPart = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-value]')
      : null;
    if (!target) return;
    const definition = PART_CATEGORIES[this.activeCategory];
    this.updateRecipe({...this.draftRecipe, [definition.field]: target.dataset.value});
  };

  private readonly selectMaterial = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isMaterialField(target.dataset.material)) return;
    this.activeMaterial = target.dataset.material;
    this.renderMaterialControls();
  };

  private readonly selectColor = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !isLpcColor(target.dataset.color) || target.disabled) return;
    this.updateRecipe({...this.draftRecipe, [this.activeMaterial]: target.dataset.color});
  };

  private readonly randomize = (event: Event): void => {
    event.stopPropagation();
    this.updateRecipe({
      ...this.draftRecipe,
      face: randomOption(LPC_FACE_OPTIONS),
      hair: randomOption(LPC_HAIR_OPTIONS),
      hat: randomOption(LPC_HAT_OPTIONS),
      top: randomOption(LPC_TOP_OPTIONS),
      legs: randomOption(LPC_LEGS_OPTIONS),
      shoes: randomOption(LPC_SHOE_OPTIONS),
      hairColor: randomOption(LPC_COLOR_OPTIONS),
      hatColor: randomOption(LPC_COLOR_OPTIONS),
      topColor: randomOption(LPC_COLOR_OPTIONS),
      legsColor: randomOption(LPC_COLOR_OPTIONS),
      shoesColor: randomOption(LPC_COLOR_OPTIONS)
    });
  };

  private readonly apply = (event: Event): void => {
    event.stopPropagation();
    if (this.wardrobeSession.isApplying()) return;
    const base = this.draftAppearance ?? cloneAppearance();
    const serialized = serializeLpcRecipe(this.draftRecipe);
    const appearance = validateAppearance({
      ...base,
      outfitName: this.draftRecipe.name,
      lpcRecipe: serialized
    });
    if (!appearance) return;
    window.localStorage.setItem(LPC_STORAGE_KEY, serialized);
    if (this.wardrobeSession.submit(appearance)) this.setApplyBusy(true);
  };

  private readonly handleAppearanceResult = (
    status: 'applied' | 'invalid' | 'missing' | 'rate-limited' | 'unowned',
    pending: PlayerAppearance
  ): void => {
    this.setApplyBusy(false);
    if (status === 'applied') {
      saveAppearance(pending);
      this.close();
      return;
    }
    this.status.textContent = status === 'rate-limited' ? 'TRY AGAIN' : 'LOOK REJECTED';
  };

  private updateRecipe(value: unknown): void {
    const candidate = validateLpcCharacterRecipe(value);
    if (!candidate) return;
    this.draftRecipe = candidate;
    this.outfitName.value = this.draftRecipe.name;
    this.recompile();
    this.renderAll();
  }

  private recompile(): void {
    if (!this.sources) return;
    this.compiledPreview = compileLpcCharacterSpriteSet(this.sources, this.draftRecipe);
    this.previewStartedAt = performance.now();
    this.status.textContent = 'READY';
    this.drawPreviewFrame();
  }

  private renderStaticControls(): void {
    this.categoryTabs.replaceChildren(...Object.entries(PART_CATEGORIES).map(([id, definition]) => {
      const button = this.root.createElement('button');
      button.type = 'button';
      button.dataset.category = id;
      button.textContent = definition.label.toUpperCase();
      return button;
    }));
    this.materialTabs.replaceChildren(...MATERIAL_FIELDS.map((field) => {
      const button = this.root.createElement('button');
      button.type = 'button';
      button.dataset.material = field;
      button.textContent = materialLabel(field);
      return button;
    }));
    this.swatches.replaceChildren(...LPC_COLOR_OPTIONS.map((option) => {
      const button = this.root.createElement('button');
      button.type = 'button';
      button.dataset.color = option.id;
      button.style.setProperty('--swatch', LPC_COLOR_VALUES[option.id]);
      button.title = option.label;
      button.setAttribute('aria-label', option.label);
      return button;
    }));
  }

  private renderAll(): void {
    this.renderPartTabs();
    this.renderPartOptions();
    this.renderMaterialControls();
    this.renderRecipeMeta();
  }

  private renderPartTabs(): void {
    for (const button of this.categoryTabs.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-selected', String(button.dataset.category === this.activeCategory));
    }
  }

  private renderPartOptions(): void {
    const definition = PART_CATEGORIES[this.activeCategory];
    this.partOptions.replaceChildren(...definition.options.map((option) => {
      const button = this.root.createElement('button');
      button.type = 'button';
      button.dataset.value = option.id;
      button.setAttribute('aria-pressed', String(this.draftRecipe[definition.field] === option.id));
      button.textContent = option.label;
      return button;
    }));
  }

  private renderMaterialControls(): void {
    const fixed = this.fixedMaterialLabel();
    for (const button of this.materialTabs.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-selected', String(button.dataset.material === this.activeMaterial));
    }
    for (const button of this.swatches.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.color === this.draftRecipe[this.activeMaterial]));
      button.disabled = Boolean(fixed);
    }
  }

  private renderRecipeMeta(): void {
    this.layerCount.textContent = this.fixedMaterialLabel() ?? `${serializeLpcRecipe(this.draftRecipe).length} B`;
  }

  private fixedMaterialLabel(): string | undefined {
    if (this.activeMaterial === 'topColor' && this.draftRecipe.top === 'smiley') return 'TOP FIXED';
    if (this.activeMaterial === 'hatColor' && !['winter_hat', 'cavalier'].includes(this.draftRecipe.hat)) return 'HAT FIXED';
    if (this.activeMaterial === 'shoesColor' && this.draftRecipe.shoes === 'timbs') return 'SHOES FIXED';
    return undefined;
  }

  private drawPreviewFrame = (): void => {
    if (!this.compiledPreview) return;
    const context = this.preview.getContext('2d');
    if (!context) return;
    const frame = 19 + Math.floor((performance.now() - this.previewStartedAt) / 110) % 8;
    const sourceX = frame % 9 * 72;
    const sourceY = Math.floor(frame / 9) * 72;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, this.preview.width, this.preview.height);
    context.drawImage(this.compiledPreview.walk, sourceX, sourceY, 72, 72, 32, 8, 160, 160);
  };

  private startPreviewAnimation(): void {
    this.stopPreviewAnimation();
    this.previewStartedAt = performance.now();
    this.previewTimer = window.setInterval(this.drawPreviewFrame, 90);
  }

  private stopPreviewAnimation(): void {
    if (this.previewTimer !== undefined) window.clearInterval(this.previewTimer);
    this.previewTimer = undefined;
  }

  private setApplyBusy(busy: boolean): void {
    this.applyButton.disabled = busy;
    this.applyButton.textContent = busy ? 'APPLYING' : 'APPLY';
  }
}

function createModal(root: Document): {
  modal: HTMLElement;
  title: HTMLElement;
  closeButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  applyButton: HTMLButtonElement;
  randomizeButton: HTMLButtonElement;
  outfitName: HTMLInputElement;
  categoryTabs: HTMLElement;
  partOptions: HTMLElement;
  materialTabs: HTMLElement;
  swatches: HTMLElement;
  preview: HTMLCanvasElement;
  status: HTMLElement;
  layerCount: HTMLElement;
} {
  const existing = root.querySelector<HTMLElement>('#appearance-modal');
  if (existing) existing.remove();
  const wrapper = root.createElement('div');
  wrapper.id = 'appearance-modal';
  wrapper.className = 'lpc-game-modal hidden';
  wrapper.innerHTML = `
    <section class="lpc-game-panel" role="dialog" aria-modal="true" aria-labelledby="appearance-title">
      <header>
        <div><strong id="appearance-title">THREADS CHARACTER CREATOR</strong><span id="lpc-game-status">READY</span></div>
        <button id="appearance-close" type="button" aria-label="Close">x</button>
      </header>
      <div class="lpc-game-body">
        <section class="lpc-game-left">
          <label>NAME<input id="appearance-outfit-name" maxlength="24" autocomplete="off"></label>
          <div id="lpc-game-categories" class="lpc-game-tabs"></div>
          <div id="lpc-game-options" class="lpc-game-options"></div>
        </section>
        <section class="lpc-game-preview">
          <canvas id="appearance-preview" width="224" height="184"></canvas>
          <span id="lpc-game-meta">0 B</span>
        </section>
        <section class="lpc-game-right">
          <div id="lpc-game-material-tabs" class="lpc-game-tabs"></div>
          <div id="lpc-game-swatches" class="lpc-game-swatches"></div>
        </section>
      </div>
      <footer>
        <button id="appearance-randomize" type="button">RANDOM</button>
        <button id="appearance-cancel" type="button">CANCEL</button>
        <button id="appearance-apply" type="button">APPLY</button>
      </footer>
    </section>
  `;
  root.body.append(wrapper);
  return {
    modal: wrapper,
    title: required(wrapper, '#appearance-title'),
    closeButton: required(wrapper, '#appearance-close'),
    cancelButton: required(wrapper, '#appearance-cancel'),
    applyButton: required(wrapper, '#appearance-apply'),
    randomizeButton: required(wrapper, '#appearance-randomize'),
    outfitName: required(wrapper, '#appearance-outfit-name'),
    categoryTabs: required(wrapper, '#lpc-game-categories'),
    partOptions: required(wrapper, '#lpc-game-options'),
    materialTabs: required(wrapper, '#lpc-game-material-tabs'),
    swatches: required(wrapper, '#lpc-game-swatches'),
    preview: required(wrapper, '#appearance-preview'),
    status: required(wrapper, '#lpc-game-status'),
    layerCount: required(wrapper, '#lpc-game-meta')
  };
}

function recipeFromAppearance(appearance: PlayerAppearance): LpcCharacterRecipe {
  return parseLpcRecipe(appearance.lpcRecipe) ??
    parseLpcRecipe(window.localStorage.getItem(LPC_STORAGE_KEY) ?? undefined) ??
    cloneLpcRecipe();
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`LPC game creator missing ${selector}`);
  return element;
}

function randomOption<T extends string>(options: readonly LpcOption<T>[]): T {
  return options[Math.floor(Math.random() * options.length)].id;
}

function materialLabel(field: LpcMaterialField): string {
  return field === 'hairColor'
    ? 'HAIR'
    : field === 'hatColor'
      ? 'HAT'
      : field === 'topColor'
        ? 'TOP'
        : field === 'legsColor'
          ? 'LEGS'
          : 'SHOES';
}

function isPartCategory(value: unknown): value is LpcPartCategory {
  return typeof value === 'string' && Object.hasOwn(PART_CATEGORIES, value);
}

function isMaterialField(value: unknown): value is LpcMaterialField {
  return MATERIAL_FIELDS.includes(value as LpcMaterialField);
}

function isLpcColor(value: unknown): value is LpcColorId {
  return typeof value === 'string' && LPC_COLOR_OPTIONS.some((option) => option.id === value);
}
