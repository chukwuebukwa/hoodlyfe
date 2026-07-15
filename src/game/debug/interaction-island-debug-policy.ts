import type {ActorRenderPose} from '../rendering/render-types.ts';
import type {
  InteractionIslandMember,
  InteractionIslandMemberReason,
  InteractionIslandSelection
} from '../prediction/interaction-island-selector.ts';
import {interactionStableKey} from '../prediction/interaction-island-policy.ts';

export const INTERACTION_ISLAND_DEBUG_COLOR = Object.freeze({
  root: 0xffd34e,
  currentContact: 0xff5e68,
  retainedContact: 0xff9d3f,
  imminentContact: 0x55d6ff,
  exitHysteresis: 0x9d8bff,
  contactClosure: 0xd979ff,
  overflow: 0xff8a35,
  presented: 0x36f1d0
});

export interface InteractionIslandDebugBody {
  readonly key: string;
  readonly member: InteractionIslandMember;
  readonly role: 'root' | 'member' | 'overflow';
  readonly color: number;
  readonly label: string;
  readonly presented?: ActorRenderPose;
}

export interface InteractionIslandDebugLink {
  readonly rootId: string;
  readonly memberId: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly color: number;
}

export interface InteractionIslandDebugProjection {
  readonly bodies: readonly InteractionIslandDebugBody[];
  readonly links: readonly InteractionIslandDebugLink[];
}

export function projectInteractionIslandDebug(
  selection: InteractionIslandSelection | undefined,
  presentedPose: (member: InteractionIslandMember) => ActorRenderPose | undefined
): InteractionIslandDebugProjection {
  if (!selection || selection.members.length === 0) {
    return Object.freeze({bodies: Object.freeze([]), links: Object.freeze([])});
  }
  const root = selection.members[0];
  const selected = selection.members.map((member, index): InteractionIslandDebugBody => {
    const role = index === 0 ? 'root' as const : 'member' as const;
    return Object.freeze({
      key: interactionStableKey(member.entity),
      member,
      role,
      color: interactionIslandMemberColor(member.reason),
      label: interactionIslandMemberLabel(member, role),
      presented: distinctPresentedPose(member, presentedPose(member))
    });
  });
  const overflow = selection.overflowMembers.map((member): InteractionIslandDebugBody => (
    Object.freeze({
      key: interactionStableKey(member.entity),
      member,
      role: 'overflow',
      color: INTERACTION_ISLAND_DEBUG_COLOR.overflow,
      label: `OVERFLOW ${member.entity.kind}:${shortId(member.entity.id)} ` +
        `${member.weight}pt ${reasonLabel(member.reason)}`,
      presented: distinctPresentedPose(member, presentedPose(member))
    })
  ));
  const links = selection.members.slice(1).map((member): InteractionIslandDebugLink => (
    Object.freeze({
      rootId: root.entity.id,
      memberId: member.entity.id,
      fromX: root.entity.x,
      fromY: root.entity.y,
      toX: member.entity.x,
      toY: member.entity.y,
      color: interactionIslandMemberColor(member.reason)
    })
  ));
  return Object.freeze({
    bodies: Object.freeze([...selected, ...overflow]),
    links: Object.freeze(links)
  });
}

export function interactionIslandMemberColor(reason: InteractionIslandMemberReason): number {
  switch (reason) {
    case 'root': return INTERACTION_ISLAND_DEBUG_COLOR.root;
    case 'current-contact': return INTERACTION_ISLAND_DEBUG_COLOR.currentContact;
    case 'contact-retained': return INTERACTION_ISLAND_DEBUG_COLOR.retainedContact;
    case 'imminent-contact': return INTERACTION_ISLAND_DEBUG_COLOR.imminentContact;
    case 'exit-hysteresis': return INTERACTION_ISLAND_DEBUG_COLOR.exitHysteresis;
    case 'contact-closure': return INTERACTION_ISLAND_DEBUG_COLOR.contactClosure;
  }
}

export function interactionIslandSelectionSummary(
  selection: InteractionIslandSelection | undefined
): string {
  if (!selection) return 'off';
  const members = selection.members.map((member) => (
    `${shortId(member.entity.id)}:${reasonLabel(member.reason)}` +
    (member.timeToContactMs > 0 ? `@${member.timeToContactMs}ms` : '')
  ));
  const overflow = selection.overflowMembers.map((member) => shortId(member.entity.id));
  return `${members.join(' > ')}${overflow.length > 0 ? ` / overflow:${overflow.join(',')}` : ''}`;
}

function interactionIslandMemberLabel(
  member: InteractionIslandMember,
  role: 'root' | 'member'
): string {
  const prefix = role === 'root' ? 'ROOT' : 'ISLAND';
  const ttc = member.timeToContactMs > 0 ? ` ttc:${member.timeToContactMs}ms` : '';
  return `${prefix} ${member.entity.kind}:${shortId(member.entity.id)} ` +
    `${member.weight}pt ${reasonLabel(member.reason)}${ttc}`;
}

function reasonLabel(reason: InteractionIslandMemberReason): string {
  switch (reason) {
    case 'root': return 'root';
    case 'current-contact': return 'contact';
    case 'contact-retained': return 'retained';
    case 'imminent-contact': return 'imminent';
    case 'exit-hysteresis': return 'hysteresis';
    case 'contact-closure': return 'closure';
  }
}

function distinctPresentedPose(
  member: InteractionIslandMember,
  pose: ActorRenderPose | undefined
): ActorRenderPose | undefined {
  if (!pose || ![pose.x, pose.y, pose.angle].every(Number.isFinite)) return undefined;
  const entity = member.entity;
  const angleDifference = Math.abs(normalizeAngle(pose.angle - entity.angle));
  if (Math.hypot(pose.x - entity.x, pose.y - entity.y) < 0.5 && angleDifference < 0.01) {
    return undefined;
  }
  return Object.freeze({...pose});
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function shortId(id: string): string {
  return id.length <= 6 ? id : id.slice(0, 6);
}
