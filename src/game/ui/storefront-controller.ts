import type {Room} from 'colyseus.js';
import {
  STOREFRONT_OPEN_MESSAGE,
  STOREFRONT_PROTOCOL_VERSION,
  STOREFRONT_PURCHASE_MESSAGE,
  STOREFRONT_RESULT_MESSAGE,
  type StorefrontOpenMessage,
  type StorefrontProduct,
  type StorefrontProductCategory,
  type StorefrontProductId,
  type StorefrontResultMessage,
  type StorefrontSnapshot
} from '../../../shared/protocol/storefront.ts';
import type {DistrictNetworkState} from '../types.ts';
import {VehicleStorefrontPreview} from './vehicle-storefront-preview.ts';

const STOREFRONT_EXIT_PADDING = 10;

export class StorefrontController {
  private readonly overlay = required<HTMLElement>('#storefront-overlay');
  private readonly panel = required<HTMLElement>('#storefront-panel');
  private readonly closeButton = required<HTMLButtonElement>('#storefront-close');
  private readonly title = required<HTMLElement>('#storefront-title');
  private readonly balance = required<HTMLElement>('#storefront-balance');
  private readonly vehicleLabel = required<HTMLElement>('#storefront-vehicle-label');
  private readonly vehicleMeta = required<HTMLElement>('#storefront-vehicle-meta');
  private readonly conditionValue = required<HTMLElement>('#storefront-condition-value');
  private readonly conditionFill = required<HTMLElement>('#storefront-condition-fill');
  private readonly engineValue = required<HTMLElement>('#storefront-engine-value');
  private readonly bodyValue = required<HTMLElement>('#storefront-body-value');
  private readonly productList = required<HTMLElement>('#storefront-products');
  private readonly selectionLabel = required<HTMLElement>('#storefront-selection-label');
  private readonly selectionDescription = required<HTMLElement>('#storefront-selection-description');
  private readonly selectionPrice = required<HTMLElement>('#storefront-selection-price');
  private readonly actionButton = required<HTMLButtonElement>('#storefront-purchase');
  private readonly status = required<HTMLElement>('#storefront-status');
  private readonly previewHost = required<HTMLElement>('#storefront-preview');
  private readonly categoryButtons = [
    ...this.overlay.querySelectorAll<HTMLButtonElement>('[data-storefront-category]')
  ];
  private readonly removeOpen: () => void;
  private readonly removeResult: () => void;
  private preview?: VehicleStorefrontPreview;
  private snapshot?: StorefrontSnapshot;
  private category: StorefrontProductCategory = 'service';
  private selectedProductId?: StorefrontProductId;
  private nextSequence = 1;
  private pendingSequence?: number;
  private readonly demoMode = process.env.NODE_ENV !== 'production' &&
    new URLSearchParams(window.location.search).get('storefront') === 'repair';

  constructor(private readonly room: Room<DistrictNetworkState>) {
    this.closeButton.addEventListener('click', this.close);
    this.overlay.addEventListener('click', this.closeFromBackdrop);
    this.actionButton.addEventListener('click', this.purchase);
    window.addEventListener('keydown', this.handleKeyDown);
    for (const button of this.categoryButtons) {
      button.addEventListener('click', this.selectCategory);
    }
    this.removeOpen = room.onMessage<StorefrontOpenMessage>(
      STOREFRONT_OPEN_MESSAGE,
      (message) => {
        if (message?.snapshot?.protocolVersion !== STOREFRONT_PROTOCOL_VERSION) return;
        this.open(message.snapshot);
      }
    ) ?? (() => undefined);
    this.removeResult = room.onMessage<StorefrontResultMessage>(
      STOREFRONT_RESULT_MESSAGE,
      this.handleResult
    ) ?? (() => undefined);

    if (this.demoMode) {
      queueMicrotask(() => this.open(demoStorefrontSnapshot()));
    }
  }

  isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  synchronize(state: DistrictNetworkState): void {
    if (this.demoMode) return;
    const snapshot = this.snapshot;
    if (!snapshot || !this.isOpen()) return;
    const player = state.players.get(this.room.sessionId);
    const vehicle = state.vehicles.get(snapshot.vehicle.id);
    const service = state.services.get(snapshot.storeId);
    if (
      !player ||
      !vehicle ||
      !service ||
      player.vehicleId !== vehicle.id ||
      player.vehicleSeat !== 0 ||
      Math.hypot(vehicle.x - service.x, vehicle.y - service.y) >
        service.radius + STOREFRONT_EXIT_PADDING
    ) {
      this.close();
    }
  }

  destroy(): void {
    this.closeButton.removeEventListener('click', this.close);
    this.overlay.removeEventListener('click', this.closeFromBackdrop);
    this.actionButton.removeEventListener('click', this.purchase);
    window.removeEventListener('keydown', this.handleKeyDown);
    for (const button of this.categoryButtons) {
      button.removeEventListener('click', this.selectCategory);
    }
    this.removeOpen();
    this.removeResult();
    this.preview?.destroy();
  }

  private open(snapshot: StorefrontSnapshot): void {
    this.snapshot = snapshot;
    this.pendingSequence = undefined;
    this.category = snapshot.products.some((product) => (
      product.category === 'service' && product.available
    )) ? 'service' : 'lighting';
    this.selectedProductId = snapshot.products.find((product) => (
      product.category === this.category && product.selected
    ))?.id;
    this.preview ??= new VehicleStorefrontPreview(this.previewHost);
    this.preview.show(snapshot.vehicle.kind, snapshot.vehicle.currentNeon);
    this.overlay.classList.remove('hidden');
    this.overlay.setAttribute('aria-hidden', 'false');
    this.status.textContent = '';
    this.status.dataset.tone = 'neutral';
    this.render();
    this.closeButton.focus();
  }

  private readonly close = (): void => {
    if (!this.isOpen()) return;
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.snapshot = undefined;
    this.pendingSequence = undefined;
    this.selectedProductId = undefined;
  };

  private readonly closeFromBackdrop = (event: MouseEvent): void => {
    if (event.target === this.overlay) this.close();
  };

  private readonly selectCategory = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement;
    const category = button.dataset.storefrontCategory;
    if (category !== 'service' && category !== 'lighting') return;
    this.category = category;
    this.selectedProductId = this.snapshot?.products.find((product) => (
      product.category === category && product.selected
    ))?.id;
    this.render();
  };

  private selectProduct(product: StorefrontProduct): void {
    this.selectedProductId = product.id;
    if (product.swatch) this.preview?.setNeon(product.swatch);
    this.status.textContent = product.unavailableReason ?? '';
    this.status.dataset.tone = product.unavailableReason ? 'warning' : 'neutral';
    this.render();
  }

  private readonly purchase = (): void => {
    const snapshot = this.snapshot;
    const product = this.selectedProduct();
    if (
      !snapshot ||
      !product ||
      !product.available ||
      product.selected ||
      this.pendingSequence !== undefined ||
      snapshot.balance < product.price
    ) return;
    const sequence = this.nextSequence++;
    this.pendingSequence = sequence;
    this.status.textContent = 'Authorizing purchase...';
    this.status.dataset.tone = 'neutral';
    this.renderAction(product);
    if (this.demoMode) {
      queueMicrotask(() => this.handleResult({
        protocolVersion: STOREFRONT_PROTOCOL_VERSION,
        sequence,
        status: 'applied',
        message: `${product.label} applied in preview.`,
        snapshot: applyDemoPurchase(snapshot, product)
      }));
      return;
    }
    this.room.send(STOREFRONT_PURCHASE_MESSAGE, {
      protocolVersion: STOREFRONT_PROTOCOL_VERSION,
      sequence,
      storeId: snapshot.storeId,
      vehicleId: snapshot.vehicle.id,
      productId: product.id
    });
  };

  private readonly handleResult = (message: StorefrontResultMessage): void => {
    if (
      message?.protocolVersion !== STOREFRONT_PROTOCOL_VERSION ||
      message.sequence !== this.pendingSequence
    ) return;
    this.pendingSequence = undefined;
    if (message.snapshot) {
      this.snapshot = message.snapshot;
      const purchased = message.snapshot.products.find((product) => product.selected);
      if (purchased?.category === this.category) this.selectedProductId = purchased.id;
      this.preview?.show(
        message.snapshot.vehicle.kind,
        message.snapshot.vehicle.currentNeon
      );
    }
    this.status.textContent = message.message;
    this.status.dataset.tone = message.status === 'applied'
      ? 'success'
      : message.status === 'insufficient-funds' || message.status === 'unavailable'
        ? 'warning'
        : 'neutral';
    this.render();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen()) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.code !== 'Tab') return;
    const focusable = [...this.panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.closest('.hidden'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private render(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    this.title.textContent = snapshot.label;
    this.balance.textContent = formatMoney(snapshot.balance);
    this.vehicleLabel.textContent = snapshot.vehicle.label;
    this.vehicleMeta.textContent = `${snapshot.vehicle.kind.toUpperCase()} / ${snapshot.vehicle.id}`;
    const condition = Math.round(
      Math.max(0, Math.min(1, snapshot.vehicle.health / Math.max(1, snapshot.vehicle.maxHealth))) *
      100
    );
    this.conditionValue.textContent = `${condition}%`;
    this.conditionFill.style.setProperty(
      '--storefront-condition-scale',
      String(condition / 100)
    );
    this.engineValue.textContent = damageLabel(snapshot.vehicle.engineDamage);
    this.bodyValue.textContent = damageLabel(snapshot.vehicle.bodyDamage);

    for (const button of this.categoryButtons) {
      const selected = button.dataset.storefrontCategory === this.category;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }

    this.productList.replaceChildren(...snapshot.products
      .filter((product) => product.category === this.category)
      .map((product) => this.productButton(product)));

    const selected = this.selectedProduct();
    this.selectionLabel.textContent = selected?.label ?? (
      this.category === 'service' ? 'Select a service' : 'Choose a neon color'
    );
    this.selectionDescription.textContent = selected?.unavailableReason ??
      selected?.description ??
      'Preview a product before purchase.';
    this.selectionPrice.textContent = selected ? priceLabel(selected.price) : '—';
    this.renderAction(selected);
  }

  private productButton(product: StorefrontProduct): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `storefront-product storefront-product--${product.category}`;
    button.dataset.productId = product.id;
    button.classList.toggle('is-selected', product.id === this.selectedProductId);
    button.classList.toggle('is-equipped', product.selected);
    button.setAttribute('aria-pressed', String(product.id === this.selectedProductId));
    button.setAttribute(
      'aria-label',
      `${product.label}, ${product.selected ? 'equipped' : priceLabel(product.price)}`
    );

    if (product.swatch) {
      const swatch = document.createElement('span');
      swatch.className = `storefront-product__swatch is-${product.swatch}`;
      swatch.setAttribute('aria-hidden', 'true');
      button.append(swatch);
    }
    const copy = document.createElement('span');
    copy.className = 'storefront-product__copy';
    const label = document.createElement('strong');
    label.textContent = product.label;
    const meta = document.createElement('span');
    meta.textContent = product.selected
      ? 'Equipped'
      : product.unavailableReason ?? priceLabel(product.price);
    copy.append(label, meta);
    button.append(copy);
    button.addEventListener('click', () => this.selectProduct(product), {once: true});
    return button;
  }

  private renderAction(product: StorefrontProduct | undefined): void {
    const snapshot = this.snapshot;
    const pending = this.pendingSequence !== undefined;
    const insufficient = Boolean(snapshot && product && snapshot.balance < product.price);
    this.actionButton.disabled = !product ||
      !product.available ||
      product.selected ||
      pending ||
      insufficient;
    this.actionButton.dataset.state = pending
      ? 'loading'
      : insufficient
        ? 'error'
        : product?.selected
          ? 'success'
          : 'default';
    this.actionButton.textContent = pending
      ? 'Processing...'
      : !product
        ? 'Select an option'
        : product.selected
          ? 'Currently equipped'
          : !product.available
            ? 'Unavailable'
            : insufficient
              ? `Need ${formatMoney(product.price)}`
              : product.id === 'repair.full'
                ? `Repair for ${formatMoney(product.price)}`
                : product.id === 'neon.off'
                  ? 'Remove neon'
                  : `Install for ${formatMoney(product.price)}`;
  }

  private selectedProduct(): StorefrontProduct | undefined {
    return this.snapshot?.products.find((product) => product.id === this.selectedProductId);
  }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing storefront element: ${selector}`);
  return element;
}

function formatMoney(value: number): string {
  return `$${Math.max(0, Math.round(value)).toLocaleString('en-US')}`;
}

function priceLabel(value: number): string {
  return value <= 0 ? 'No charge' : formatMoney(value);
}

function damageLabel(value: number): string {
  if (value <= 0) return 'Clear';
  if (value < 80) return 'Light';
  if (value < 220) return 'Moderate';
  return 'Heavy';
}

function demoStorefrontSnapshot(): StorefrontSnapshot {
  return {
    protocolVersion: STOREFRONT_PROTOCOL_VERSION,
    storeId: 'repair-garage',
    kind: 'repair',
    label: 'Repair Garage',
    balance: 1280,
    vehicle: {
      id: 'qa-s15',
      kind: 's15',
      label: 'S15 Silvia',
      health: 1000,
      maxHealth: 1000,
      engineDamage: 0,
      bodyDamage: 0,
      currentNeon: 'cyan'
    },
    products: [{
      id: 'repair.full',
      category: 'service',
      label: 'Full Repair',
      description: 'Restore body panels, engine condition, and vehicle health.',
      price: 0,
      available: false,
      selected: false,
      unavailableReason: 'Vehicle is already repaired.'
    }, {
      id: 'neon.off',
      category: 'lighting',
      label: 'No Neon',
      description: 'Remove the installed underglow.',
      price: 0,
      available: true,
      selected: false,
      swatch: 'off'
    }, ...(['cyan', 'magenta', 'violet', 'lime', 'amber', 'white'] as const).map((color) => ({
      id: `neon.${color}` as StorefrontProductId,
      category: 'lighting' as const,
      label: `${color.charAt(0).toUpperCase() + color.slice(1)} Neon`,
      description: 'Install a road-facing underglow kit.',
      price: color === 'cyan' ? 0 : 75,
      available: color !== 'cyan',
      selected: color === 'cyan',
      swatch: color
    }))]
  };
}

function applyDemoPurchase(
  snapshot: StorefrontSnapshot,
  product: StorefrontProduct
): StorefrontSnapshot {
  const nextNeon = product.swatch ?? snapshot.vehicle.currentNeon;
  return {
    ...snapshot,
    balance: Math.max(0, snapshot.balance - product.price),
    vehicle: {
      ...snapshot.vehicle,
      currentNeon: nextNeon
    },
    products: snapshot.products.map((candidate) => candidate.category === 'lighting'
      ? {
          ...candidate,
          selected: candidate.swatch === nextNeon,
          available: candidate.swatch !== nextNeon,
          price: candidate.swatch === nextNeon ? 0 : nextNeon === 'off' ? 350 : 75
        }
      : candidate)
  };
}
