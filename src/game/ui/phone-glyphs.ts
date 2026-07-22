export type PhoneGlyphName =
  | 'arrow-down'
  | 'arrow-left-right'
  | 'arrow-up'
  | 'banknote'
  | 'briefcase-business'
  | 'car-front'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'copy'
  | 'crosshair'
  | 'footprints'
  | 'gem'
  | 'hard-hat'
  | 'heart-pulse'
  | 'link-2-off'
  | 'map'
  | 'message-circle'
  | 'music-2'
  | 'person-standing'
  | 'phone'
  | 'plus'
  | 'profile'
  | 'radio'
  | 'refresh-cw'
  | 'scissors'
  | 'settings'
  | 'shirt'
  | 'user-round'
  | 'users'
  | 'wallet'
  | 'wifi';

// These compact, original line glyphs share Lucide's familiar 24px visual language.
const PATHS: Record<PhoneGlyphName, string> = {
  'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  'arrow-left-right': '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
  'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 9h.01M18 15h.01"/>',
  'briefcase-business': '<path d="M9 6V4h6v2M3 7h18v12H3zM3 12h18M10 12v2h4v-2"/>',
  'car-front': '<path d="m5 11 1.5-5h11l1.5 5M3 13v6h3v-2h12v2h3v-6l-2-2H5z"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  footprints: '<path d="M4 16c1-2 3-3 5-2s2 4 0 6-7 1-5-4ZM15 10c-2-2-1-5 1-6s4 1 4 4-3 5-5 2Z"/>',
  gem: '<path d="m3 8 4-5h10l4 5-9 13zM3 8h18M8 3l4 5 4-5M12 8v13"/>',
  'hard-hat': '<path d="M4 14a8 8 0 0 1 16 0M2 14h20v4H2zM12 6v8"/>',
  'heart-pulse': '<path d="M3 12h4l2-4 4 8 2-4h6M20 5c-2-2-5-1-8 2-3-3-6-4-8-2-3 3-1 7 0 8l8 8 8-8c1-1 3-5 0-8Z"/>',
  'link-2-off': '<path d="M9 17H7a5 5 0 0 1-4-8l2-2M15 7h2a5 5 0 0 1 4 8l-2 2M8 12h4M2 2l20 20"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>',
  'message-circle': '<path d="M21 12a9 9 0 0 1-13 8l-5 1 1-5a9 9 0 1 1 17-4Z"/>',
  'music-2': '<path d="M9 18V5l12-2v13M9 9l12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  'person-standing': '<circle cx="12" cy="5" r="2"/><path d="M9 22v-8l-2-3M15 22v-8l2-3M8 8h8"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2.1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  radio: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7 8 10-5M7 13h5"/><circle cx="16.5" cy="14.5" r="2.5"/>',
  'refresh-cw': '<path d="M20 7v5h-5M4 17v-5h5M6.1 9A7 7 0 0 1 18 6l2 6M18 15a7 7 0 0 1-12 3l-2-6"/>',
  scissors: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8.6 8.5 11.4 8.5M8.6 15.5 20 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  shirt: '<path d="m8 4-5 3 3 5 2-1v10h8V11l2 1 3-5-5-3a4 4 0 0 1-8 0Z"/>',
  'user-round': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  wallet: '<path d="M4 5h14a2 2 0 0 1 2 2v13H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12M16 12h6v5h-6a2.5 2.5 0 0 1 0-5Z"/>',
  wifi: '<path d="M5 12.6a11 11 0 0 1 14 0M8.5 16a6 6 0 0 1 7 0M12 20h.01"/>'
};

export function phoneGlyph(name: PhoneGlyphName): string {
  return `<svg class="phone-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
