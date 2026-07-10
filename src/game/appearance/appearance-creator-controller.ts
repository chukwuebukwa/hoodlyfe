import type {Room} from 'colyseus.js';
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
} from '../../../shared/content/appearance-catalog.ts';
import {APPEARANCE_UPDATE_MESSAGE} from '../../../shared/protocol/appearance.ts';
import type {DistrictNetworkState} from '../types.ts';
import {saveAppearance} from './appearance-storage.ts';
import {
  appearanceSpritePresentation,
  renderAppearanceSheet
} from './appearance-render-policy.ts';

type ColorField = 'hairColor' | 'topColor' | 'accentColor' | 'bottomColor' | 'shoeColor';

export class AppearanceCreatorController {
  private readonly modal: HTMLElement | null;
  private readonly toggle: HTMLButtonElement | null;
  private readonly closeButton: HTMLButtonElement | null;
  private readonly cancelButton: HTMLButtonElement | null;
  private readonly applyButton: HTMLButtonElement | null;
  private readonly randomizeButton: HTMLButtonElement | null;
  private readonly form: HTMLFormElement | null;
  private readonly outfitName: HTMLInputElement | null;
  private readonly outfitLabel: Element | null;
  private readonly colorTargets: HTMLElement | null;
  private readonly swatches: HTMLElement | null;
  private readonly preview: HTMLCanvasElement | null;
  private readonly previewSheet = document.createElement('canvas');
  private readonly previewSource = new Image();
  private readonly selects: Record<string, HTMLSelectElement | null>;
  private state?: DistrictNetworkState;
  private draft?: PlayerAppearance;
  private colorField: ColorField = 'topColor';
  private openState = false;

  constructor(
    private readonly room: Room<DistrictNetworkState>,
    private readonly localPlayerId: string,
    private readonly root: Document = document
  ) {
    this.modal = root.querySelector<HTMLElement>('#appearance-modal');
    this.toggle = root.querySelector<HTMLButtonElement>('#appearance-toggle');
    this.closeButton = root.querySelector<HTMLButtonElement>('#appearance-close');
    this.cancelButton = root.querySelector<HTMLButtonElement>('#appearance-cancel');
    this.applyButton = root.querySelector<HTMLButtonElement>('#appearance-apply');
    this.randomizeButton = root.querySelector<HTMLButtonElement>('#appearance-randomize');
    this.form = root.querySelector<HTMLFormElement>('#appearance-form');
    this.outfitName = root.querySelector<HTMLInputElement>('#appearance-outfit-name');
    this.outfitLabel = root.querySelector('#appearance-outfit-label');
    this.colorTargets = root.querySelector<HTMLElement>('#appearance-color-targets');
    this.swatches = root.querySelector<HTMLElement>('#appearance-swatches');
    this.preview = root.querySelector<HTMLCanvasElement>('#appearance-preview');
    this.selects = {
      bodyType: root.querySelector('#appearance-body'),
      skinTone: root.querySelector('#appearance-skin'),
      hairStyle: root.querySelector('#appearance-hair'),
      headwear: root.querySelector('#appearance-headwear'),
      topStyle: root.querySelector('#appearance-top'),
      bottomStyle: root.querySelector('#appearance-bottom'),
      shoeStyle: root.querySelector('#appearance-shoes')
    };
    populateSelect(this.selects.bodyType, BODY_OPTIONS);
    populateSelect(this.selects.skinTone, SKIN_OPTIONS);
    populateSelect(this.selects.hairStyle, HAIR_OPTIONS);
    populateSelect(this.selects.headwear, HEADWEAR_OPTIONS);
    populateSelect(this.selects.topStyle, TOP_OPTIONS);
    populateSelect(this.selects.bottomStyle, BOTTOM_OPTIONS);
    populateSelect(this.selects.shoeStyle, SHOE_OPTIONS);
    this.createSwatches();
    this.bindEvents();
    this.previewSource.addEventListener('load', this.renderPreview);
    this.previewSource.src = '/assets/original/sprites/player-base.png';
  }

  isOpen(): boolean {
    return this.openState;
  }

  synchronize(state: DistrictNetworkState): void {
    this.state = state;
    const player = state.players.get(this.localPlayerId);
    this.toggle?.classList.toggle('hidden', !player?.alive);
    if (!player?.alive && this.openState) this.close();
    if (!this.openState && player?.appearance) this.draft = cloneAppearance(player.appearance);
  }

  destroy(): void {
    this.close();
    this.toggle?.removeEventListener('click', this.open);
    this.closeButton?.removeEventListener('click', this.close);
    this.cancelButton?.removeEventListener('click', this.close);
    this.applyButton?.removeEventListener('click', this.apply);
    this.randomizeButton?.removeEventListener('click', this.randomize);
    this.form?.removeEventListener('input', this.readForm);
    this.form?.removeEventListener('change', this.readForm);
    this.colorTargets?.removeEventListener('click', this.selectColorField);
    this.swatches?.removeEventListener('click', this.selectColor);
    this.modal?.removeEventListener('click', this.closeFromBackdrop);
    this.root.removeEventListener('keydown', this.handleKeydown);
    this.previewSource.removeEventListener('load', this.renderPreview);
    this.state = undefined;
    this.draft = undefined;
  }

  private bindEvents(): void {
    this.toggle?.addEventListener('click', this.open);
    this.closeButton?.addEventListener('click', this.close);
    this.cancelButton?.addEventListener('click', this.close);
    this.applyButton?.addEventListener('click', this.apply);
    this.randomizeButton?.addEventListener('click', this.randomize);
    this.form?.addEventListener('input', this.readForm);
    this.form?.addEventListener('change', this.readForm);
    this.colorTargets?.addEventListener('click', this.selectColorField);
    this.swatches?.addEventListener('click', this.selectColor);
    this.modal?.addEventListener('click', this.closeFromBackdrop);
    this.root.addEventListener('keydown', this.handleKeydown);
  }

  private createSwatches(): void {
    if (!this.swatches) return;
    this.swatches.replaceChildren();
    for (const option of COLOR_OPTIONS) {
      const button = this.root.createElement('button');
      button.type = 'button';
      button.dataset.color = option.id;
      button.style.background = cssColor(COLOR_VALUES[option.id]);
      button.setAttribute('aria-label', option.label);
      button.setAttribute('aria-pressed', 'false');
      this.swatches.append(button);
    }
  }

  private readonly open = (event?: Event): void => {
    event?.stopPropagation();
    const player = this.state?.players.get(this.localPlayerId);
    if (!player?.alive) return;
    this.draft = cloneAppearance(player.appearance);
    this.openState = true;
    this.room.send('input', {x: 0, y: 0});
    this.modal?.classList.remove('hidden');
    this.renderForm();
    this.outfitName?.focus();
  };

  private readonly close = (event?: Event): void => {
    event?.stopPropagation();
    this.openState = false;
    this.modal?.classList.add('hidden');
  };

  private readonly closeFromBackdrop = (event: Event): void => {
    if (event.target === this.modal) this.close(event);
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (this.openState && event.key === 'Escape') this.close(event);
  };

  private readonly readForm = (): void => {
    if (!this.draft) return;
    const candidate = validateAppearance({
      ...this.draft,
      outfitName: this.outfitName?.value || this.draft.outfitName,
      bodyType: this.selects.bodyType?.value,
      skinTone: this.selects.skinTone?.value,
      hairStyle: this.selects.hairStyle?.value,
      headwear: this.selects.headwear?.value,
      topStyle: this.selects.topStyle?.value,
      bottomStyle: this.selects.bottomStyle?.value,
      shoeStyle: this.selects.shoeStyle?.value
    });
    if (!candidate) return;
    this.draft = candidate;
    this.renderAppearance();
  };

  private readonly selectColorField = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const field = target.dataset.colorField;
    if (!isColorField(field)) return;
    this.colorField = field;
    this.renderColorSelection();
  };

  private readonly selectColor = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !this.draft) return;
    const color = target.dataset.color;
    if (!APPEARANCE_COLORS.includes(color as AppearanceColorId)) return;
    this.draft = {...this.draft, [this.colorField]: color as AppearanceColorId};
    this.renderColorSelection();
    this.renderAppearance();
  };

  private readonly randomize = (event: Event): void => {
    event.stopPropagation();
    if (!this.draft) return;
    this.draft = {
      outfitName: 'Custom Fit',
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
    };
    this.renderForm();
  };

  private readonly apply = (event: Event): void => {
    event.stopPropagation();
    this.readForm();
    if (!this.draft) return;
    const appearance = validateAppearance(this.draft);
    if (!appearance) return;
    this.room.send(APPEARANCE_UPDATE_MESSAGE, appearance);
    saveAppearance(appearance);
    this.close();
  };

  private renderForm(): void {
    if (!this.draft) return;
    if (this.outfitName) this.outfitName.value = this.draft.outfitName;
    for (const [field, select] of Object.entries(this.selects)) {
      if (select) select.value = String(this.draft[field as keyof PlayerAppearance]);
    }
    this.renderColorSelection();
    this.renderAppearance();
  }

  private renderColorSelection(): void {
    if (!this.draft) return;
    for (const button of this.colorTargets?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
      button.setAttribute('aria-selected', String(button.dataset.colorField === this.colorField));
    }
    for (const button of this.swatches?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
      button.setAttribute('aria-pressed', String(button.dataset.color === this.draft[this.colorField]));
    }
  }

  private renderAppearance(): void {
    if (!this.draft) return;
    if (this.outfitLabel) this.outfitLabel.textContent = this.draft.outfitName.toUpperCase();
    this.renderPreview();
  }

  private readonly renderPreview = (): void => {
    if (!this.preview || !this.draft || !this.previewSource.complete) return;
    renderAppearanceSheet(this.previewSource, this.previewSheet, this.draft);
    const context = this.preview.getContext('2d');
    if (!context) return;
    const {bodyScaleX} = appearanceSpritePresentation(this.draft);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, this.preview.width, this.preview.height);
    const width = 132 * bodyScaleX;
    context.drawImage(
      this.previewSheet,
      0,
      0,
      72,
      72,
      (this.preview.width - width) / 2,
      6,
      width,
      132
    );
  };
}

function populateSelect<T extends string>(
  select: HTMLSelectElement | null,
  options: readonly AppearanceOption<T>[]
): void {
  if (!select) return;
  select.replaceChildren(...options.map((option) => {
    const element = document.createElement('option');
    element.value = option.id;
    element.textContent = option.label;
    return element;
  }));
}

function randomOption<T extends string>(options: readonly AppearanceOption<T>[]): T {
  return options[Math.floor(Math.random() * options.length)].id;
}

function isColorField(value: unknown): value is ColorField {
  return ['hairColor', 'topColor', 'accentColor', 'bottomColor', 'shoeColor'].includes(String(value));
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
