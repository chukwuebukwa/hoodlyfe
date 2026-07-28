import {
  missionContact,
  type MissionTemplateId
} from '../../../shared/content/mission-catalog.ts';
import type {DistrictNetworkState} from '../types.ts';
import {
  projectInteractionAffordance,
  type InteractionAnchor
} from './interaction-presentation-policy.ts';
import {projectMissionHud} from '../missions/mission-presentation-policy.ts';

export interface ContextPromptProjection {
  visible: boolean;
  command: 'interact' | 'mission-start';
  placement: 'world' | 'driving';
  label: string;
  touchLabel: string;
  ariaLabel: string;
  anchor?: InteractionAnchor;
  templateId?: MissionTemplateId;
}

export function projectContextPrompt(
  state: DistrictNetworkState,
  localPlayerId: string
): ContextPromptProjection {
  const interaction = projectInteractionAffordance(state, localPlayerId);
  const mission = projectMissionHud(state, localPlayerId);
  if (
    mission.action === 'start' &&
    (
      !interaction.visible ||
      interaction.kind === 'enter-vehicle' ||
      interaction.kind === 'hijack-vehicle' ||
      interaction.kind === 'ride-along'
    )
  ) {
    const contact = missionContact(mission.templateId);
    return {
      visible: true,
      command: 'mission-start',
      placement: 'world',
      label: 'Start Job',
      touchLabel: 'JOB',
      ariaLabel: `Start ${mission.title}`,
      anchor: {x: contact.x, y: contact.y},
      templateId: mission.templateId
    };
  }
  if (interaction.visible) {
    return {
      visible: true,
      command: 'interact',
      placement: interaction.kind === 'exit-vehicle' ? 'driving' : 'world',
      label: interaction.label,
      touchLabel: interaction.touchLabel,
      ariaLabel: interaction.ariaLabel,
      anchor: interaction.anchor
    };
  }
  return {
    visible: false,
    command: 'interact',
    placement: 'world',
    label: '',
    touchLabel: 'CAR',
    ariaLabel: ''
  };
}
