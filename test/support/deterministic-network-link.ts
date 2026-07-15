export interface NetworkImpairmentProfile {
  readonly id: 'local' | 'regional' | 'continental' | 'intercontinental';
  readonly roundTripTimeMs: number;
  readonly jitterMs: number;
  readonly packetLossRate: number;
  readonly retransmissionPenaltyMs: number;
}

export const NETWORK_IMPAIRMENT_PROFILES: readonly NetworkImpairmentProfile[] = Object.freeze([
  Object.freeze({
    id: 'local',
    roundTripTimeMs: 0,
    jitterMs: 0,
    packetLossRate: 0,
    retransmissionPenaltyMs: 0
  }),
  Object.freeze({
    id: 'regional',
    roundTripTimeMs: 75,
    jitterMs: 8,
    packetLossRate: 0.0025,
    retransmissionPenaltyMs: 75
  }),
  Object.freeze({
    id: 'continental',
    roundTripTimeMs: 150,
    jitterMs: 20,
    packetLossRate: 0.005,
    retransmissionPenaltyMs: 150
  }),
  Object.freeze({
    id: 'intercontinental',
    roundTripTimeMs: 250,
    jitterMs: 35,
    packetLossRate: 0.01,
    retransmissionPenaltyMs: 250
  })
]);

interface ScheduledPacket<T> {
  readonly payload: T;
  readonly deliveryAtMs: number;
  readonly order: number;
}

export interface NetworkLinkDiagnostics {
  readonly sentPackets: number;
  readonly simulatedRetransmissions: number;
  readonly maximumQueueDepth: number;
}

export class DeterministicReliableNetworkLink<T> {
  private readonly random: DeterministicRandom;
  private readonly queue: ScheduledPacket<T>[] = [];
  private lastOrderedDeliveryAtMs = Number.NEGATIVE_INFINITY;
  private sentPackets = 0;
  private simulatedRetransmissions = 0;
  private maximumQueueDepth = 0;

  constructor(
    private readonly profile: NetworkImpairmentProfile,
    seed: number
  ) {
    this.random = new DeterministicRandom(seed);
  }

  send(nowMs: number, payload: T): void {
    const oneWayMs = this.profile.roundTripTimeMs / 2;
    const jitterMs = (this.random.sample() * 2 - 1) * this.profile.jitterMs;
    const retransmitted = this.random.sample() < this.profile.packetLossRate;
    if (retransmitted) this.simulatedRetransmissions += 1;
    const requestedDeliveryAtMs = nowMs + Math.max(0, oneWayMs + jitterMs) +
      (retransmitted ? this.profile.retransmissionPenaltyMs : 0);
    const deliveryAtMs = Math.max(requestedDeliveryAtMs, this.lastOrderedDeliveryAtMs + 0.001);
    this.lastOrderedDeliveryAtMs = deliveryAtMs;
    this.queue.push({payload, deliveryAtMs, order: this.sentPackets});
    this.sentPackets += 1;
    this.maximumQueueDepth = Math.max(this.maximumQueueDepth, this.queue.length);
  }

  receive(nowMs: number): T[] {
    const delivered: T[] = [];
    while (this.queue[0]?.deliveryAtMs <= nowMs) {
      delivered.push(this.queue.shift()!.payload);
    }
    return delivered;
  }

  diagnostics(): NetworkLinkDiagnostics {
    return {
      sentPackets: this.sentPackets,
      simulatedRetransmissions: this.simulatedRetransmissions,
      maximumQueueDepth: this.maximumQueueDepth
    };
  }
}

class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    this.state = (Math.trunc(seed) >>> 0) || 0x6d2b79f5;
  }

  sample(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }
}
