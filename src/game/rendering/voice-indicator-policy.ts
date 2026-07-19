export interface VoiceIndicatorPresentation {
  visible: boolean;
  scale: number;
  opacity: number;
}

export function voiceIndicatorPresentation(
  activity: number,
  nowMs: number
): VoiceIndicatorPresentation {
  const level = Math.max(0, Math.min(1, activity));
  if (level === 0) return {visible: false, scale: 0.92, opacity: 0};
  const pulse = (Math.sin(nowMs * 0.014) + 1) * 0.018;
  return {
    visible: true,
    scale: 0.92 + level * 0.34 + pulse,
    opacity: 0.72 + level * 0.28
  };
}
