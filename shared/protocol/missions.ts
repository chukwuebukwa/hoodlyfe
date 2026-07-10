export const MISSION_START_MESSAGE = 'mission.start';
export const MISSION_JOIN_MESSAGE = 'mission.join';
export const MISSION_LAUNCH_MESSAGE = 'mission.launch';
export const MISSION_ABANDON_MESSAGE = 'mission.abandon';
export const MISSION_NOTICE_MESSAGE = 'mission.notice';

export interface MissionIdMessage {
  missionId?: string;
}

export interface MissionNotice {
  message: string;
  tone: 'info' | 'success' | 'warning';
}
