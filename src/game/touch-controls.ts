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

    this.bindStick('#move-stick', '#move-thumb', this.movement, false);
    this.bindStick('#aim-stick', '#aim-thumb', this.aim, true);
    document.querySelector('#interact-button')?.addEventListener('click', (event) => {
      event.preventDefault();
      this.interactQueued = true;
    });
  }

  consumeInteract(): boolean {
    const queued = this.interactQueued;
    this.interactQueued = false;
    return queued;
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

    stick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pointerId = event.pointerId;
      stick.setPointerCapture(pointerId);
      if (fires) this.firing = true;
      update(event);
    });
    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId === pointerId) update(event);
    });
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
  }
}
