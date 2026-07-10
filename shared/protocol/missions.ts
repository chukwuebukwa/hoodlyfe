import type {MissionTemplateId} from '../content/mission-catalog.ts';

export const MISSION_START_MESSAGE = 'mission.start';
export const MISSION_JOIN_MESSAGE = 'mission.join';
export const MISSION_LAUNCH_MESSAGE = 'mission.launch';
export const MISSION_ABANDON_MESSAGE = 'mission.abandon';

export interface MissionIdMessage {
  missionId?: string;
}

export interface MissionStartMessage {
  templateId?: MissionTemplateId;
}
