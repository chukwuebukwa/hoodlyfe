interface StickState {
  x: number;
  y: number;
}

export class TouchControls {
  readonly movement: StickState = {x: 0, y: 0};
  readonly aim: StickState = {x: 0, y: -1};
  firing = false;
  active = false;
  private interactQueued = false;
  private readonly cleanup: Array<() => void> = [];

  constructor() {
    const inputMedia = window.matchMedia('(pointer: coarse)');
    const visibilityMedia = window.matchMedia('(pointer: coarse), (max-width: 760px)');
    const updateMode = () => {
      this.active = inputMedia.matches;
      document.querySelector('#touch-controls')?.classList.toggle('active', visibilityMedia.matches);
    };
    updateMode();
    inputMedia.addEventListener('change', updateMode);
    visibilityMedia.addEventListener('change', updateMode);
    this.cleanup.push(
      () => inputMedia.removeEventListener('change', updateMode),
      () => visibilityMedia.removeEventListener('change', updateMode)
    );

    this.bindStick('#move-stick', '#move-thumb', this.movement, false);
    this.bindStick('#aim-stick', '#aim-thumb', this.aim, true);
    const interactButton = document.querySelector('#interact-button');
    const queueInteraction = (event: Event) => {
      event.preventDefault();
      this.interactQueued = true;
    };
    interactButton?.addEventListener('click', queueInteraction);
    if (interactButton) {
      this.cleanup.push(() => interactButton.removeEventListener('click', queueInteraction));
    }
  }

  consumeInteract(): boolean {
    const queued = this.interactQueued;
    this.interactQueued = false;
    return queued;
  }

  destroy(): void {
    for (const remove of this.cleanup.splice(0)) remove();
    this.movement.x = 0;
    this.movement.y = 0;
    this.aim.x = 0;
    this.aim.y = -1;
    this.firing = false;
    this.interactQueued = false;
  }

  private bindStick(
    stickSelector: string,
    thumbSelector: string,
    state: StickState,
    fires: boolean
  ): void {
    const stick = document.querySelector<HTMLElement>(stickSelector);
    const thumb = document.querySelector<HTMLElement>(thumbSelector);
    if (!stick || !thumb) return;

    let pointerId: number | undefined;
    const update = (event: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      const radius = Math.max(1, rect.width * 0.34);
      let x = (event.clientX - (rect.left + rect.width / 2)) / radius;
      let y = (event.clientY - (rect.top + rect.height / 2)) / radius;
      const magnitude = Math.hypot(x, y);
      if (magnitude > 1) {
        x /= magnitude;
        y /= magnitude;
      }
      state.x = Math.abs(x) < 0.08 ? 0 : x;
      state.y = Math.abs(y) < 0.08 ? 0 : y;
      thumb.style.transform = `translate(${state.x * radius}px, ${state.y * radius}px)`;
    };
    const release = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = undefined;
      if (fires) {
        this.firing = false;
      } else {
        state.x = 0;
        state.y = 0;
      }
      thumb.style.transform = 'translate(0, 0)';
    };

    const press = (event: PointerEvent) => {
      event.preventDefault();
      pointerId = event.pointerId;
      stick.setPointerCapture(pointerId);
      if (fires) this.firing = true;
      update(event);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId === pointerId) update(event);
    };
    stick.addEventListener('pointerdown', press);
    stick.addEventListener('pointermove', move);
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    this.cleanup.push(
      () => stick.removeEventListener('pointerdown', press),
      () => stick.removeEventListener('pointermove', move),
      () => stick.removeEventListener('pointerup', release),
      () => stick.removeEventListener('pointercancel', release)
    );
  }
}
