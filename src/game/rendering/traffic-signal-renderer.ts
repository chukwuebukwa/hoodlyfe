import Phaser from 'phaser';
import {
  TRAFFIC_SIGNALS,
  type TrafficAxis,
  type TrafficSignalApproachDefinition,
  type TrafficSignalDefinition,
  type TrafficSignalPhase
} from '../../../shared/content/traffic-signals.ts';
import type {NetworkTrafficSignal} from '../types.ts';
import {signalLampPresentation} from './traffic-signal-render-policy.ts';

interface SignalHead {
  axis: TrafficAxis;
  red: Phaser.GameObjects.Arc;
  yellow: Phaser.GameObjects.Arc;
  green: Phaser.GameObjects.Arc;
}

interface RenderedSignal {
  container: Phaser.GameObjects.Container;
  heads: SignalHead[];
}

export class TrafficSignalRenderer {
  private readonly rendered = new Map<string, RenderedSignal>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  synchronize(signals?: Map<string, NetworkTrafficSignal>): void {
    const present = new Set<string>();
    signals?.forEach((signal, signalId) => {
      const definition = TRAFFIC_SIGNALS.find((candidate) => candidate.id === signalId);
      if (!definition) return;
      present.add(signalId);
      let rendered = this.rendered.get(signalId);
      if (!rendered) {
        rendered = this.create(definition);
        this.rendered.set(signalId, rendered);
      }
      for (const head of rendered.heads) {
        this.applyPhase(
          head,
          head.axis === 'north-south' ? signal.northSouth : signal.eastWest
        );
      }
    });
    for (const [signalId, rendered] of this.rendered) {
      if (present.has(signalId)) continue;
      rendered.container.destroy(true);
      this.rendered.delete(signalId);
    }
  }

  destroy(): void {
    for (const rendered of this.rendered.values()) rendered.container.destroy(true);
    this.rendered.clear();
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private create(definition: TrafficSignalDefinition): RenderedSignal {
    const children: Phaser.GameObjects.GameObject[] = [];
    const heads: SignalHead[] = [];
    for (const approach of definition.approaches) {
      const stopLine = this.createStopLine(approach, definition);
      children.push(stopLine);
      const head = this.createHead(approach, definition);
      children.push(head.housing, head.red, head.yellow, head.green);
      heads.push({
        axis: approach.axis,
        red: head.red,
        yellow: head.yellow,
        green: head.green
      });
    }
    return {
      container: this.scene.add.container(definition.x, definition.y, children).setDepth(899_940),
      heads
    };
  }

  private createStopLine(
    approach: TrafficSignalApproachDefinition,
    signal: TrafficSignalDefinition
  ): Phaser.GameObjects.Rectangle {
    const localX = approach.stopX - signal.x;
    const localY = approach.stopY - signal.y;
    const verticalRoad = approach.directionX === 0;
    return this.scene.add.rectangle(
      localX,
      localY,
      verticalRoad ? approach.corridorHalfWidth * 2 : 5,
      verticalRoad ? 5 : approach.corridorHalfWidth * 2,
      0xf4f0d8,
      0.42
    );
  }

  private createHead(
    approach: TrafficSignalApproachDefinition,
    signal: TrafficSignalDefinition
  ): {
    housing: Phaser.GameObjects.Rectangle;
    red: Phaser.GameObjects.Arc;
    yellow: Phaser.GameObjects.Arc;
    green: Phaser.GameObjects.Arc;
  } {
    const normalX = -approach.directionY;
    const normalY = approach.directionX;
    const side = approach.corridorHalfWidth + 14;
    const localX = approach.stopX - signal.x + normalX * side;
    const localY = approach.stopY - signal.y + normalY * side;
    const housing = this.scene.add.rectangle(localX, localY, 17, 31, 0x111719, 0.96)
      .setStrokeStyle(1, 0x8b969b, 0.9);
    const red = this.scene.add.circle(localX, localY - 9, 4, 0xff394f, 1);
    const yellow = this.scene.add.circle(localX, localY, 4, 0xffcc3d, 0.16);
    const green = this.scene.add.circle(localX, localY + 9, 4, 0x55e889, 0.16);
    return {housing, red, yellow, green};
  }

  private applyPhase(head: SignalHead, phase: TrafficSignalPhase): void {
    const presentation = signalLampPresentation(phase);
    head.red.setFillStyle(presentation.red.color, presentation.red.alpha);
    head.yellow.setFillStyle(presentation.yellow.color, presentation.yellow.alpha);
    head.green.setFillStyle(presentation.green.color, presentation.green.alpha);
  }
}
