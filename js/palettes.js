// Colour palettes. Each has a dark and a light version. This file is the source for css/themes.css
// (regenerate with `node tools/build-themes.mjs`) and for the swatches in Settings.
// Token roles: bg page, panel cards, raise pills/buttons, ink text, muted secondary text, line borders,
// accent brand and main action, onAccent text on accent, listen listening state and focus ring,
// speak speaking state, alert errors and delete.
export const PALETTES = [
  {id: 'midnight', name: 'Midnight Amber',
    dark: {bg: '#11161f', panel: '#192030', raise: '#232c3e', ink: '#ece6d9', muted: '#8e97aa', line: '#2c3648', accent: '#f1a73c', onAccent: '#1d1307', listen: '#73aef0', speak: '#62c592', alert: '#ec6a5e'},
    light: {bg: '#eceff3', panel: '#ffffff', raise: '#f2f4f7', ink: '#1a2030', muted: '#5a6375', line: '#d2d7e0', accent: '#9c540a', onAccent: '#ffffff', listen: '#2b67ad', speak: '#1f7f52', alert: '#bd3a2f'}},
  {id: 'purple', name: 'Royal Purple',
    dark: {bg: '#14101f', panel: '#1d1730', raise: '#2a2142', ink: '#eee8f8', muted: '#a49bbb', line: '#352b4f', accent: '#b993f5', onAccent: '#1b0f33', listen: '#8fb8f7', speak: '#6fd0a0', alert: '#f27f7f'},
    light: {bg: '#f3f0f9', panel: '#ffffff', raise: '#f0ebf8', ink: '#1f1731', muted: '#5e5576', line: '#dcd4ea', accent: '#6a3db8', onAccent: '#ffffff', listen: '#2b63ad', speak: '#1f7a50', alert: '#b8322a'}},
  {id: 'fairy', name: 'Fairy Queen',
    dark: {bg: '#1b1120', panel: '#26172c', raise: '#33203b', ink: '#f8eaf2', muted: '#bba2b9', line: '#45304d', accent: '#f5a8cb', onAccent: '#2c0d1f', listen: '#c6aaff', speak: '#93dcbc', alert: '#ff8c8c'},
    light: {bg: '#fbf1f6', panel: '#ffffff', raise: '#f8eaf2', ink: '#2c1630', muted: '#6d5470', line: '#ecd5e3', accent: '#a8336c', onAccent: '#ffffff', listen: '#6546c0', speak: '#1f7a50', alert: '#b02e28'}},
  {id: 'navy', name: 'Deep Navy',
    dark: {bg: '#0a1322', panel: '#111e36', raise: '#1a2a48', ink: '#e6edf8', muted: '#94a6c3', line: '#233656', accent: '#62a8ff', onAccent: '#03152d', listen: '#7fd3ff', speak: '#5fd0a0', alert: '#ff7a6b'},
    light: {bg: '#edf2f8', panel: '#ffffff', raise: '#eef3fa', ink: '#0f1b2e', muted: '#4e5f78', line: '#d0dbea', accent: '#1b5cb5', onAccent: '#ffffff', listen: '#0b6e8a', speak: '#1f7a50', alert: '#b8322a'}},
  {id: 'teal', name: 'Ocean Teal',
    dark: {bg: '#0b1717', panel: '#112222', raise: '#1a2f2f', ink: '#e3f2f0', muted: '#8fb1ad', line: '#233e3c', accent: '#4fd3c6', onAccent: '#03211d', listen: '#8ab6f8', speak: '#f0c56e', alert: '#ff7b72'},
    light: {bg: '#ecf5f4', panel: '#ffffff', raise: '#ebf4f3', ink: '#0f2222', muted: '#4b6563', line: '#cfe1df', accent: '#0d6f68', onAccent: '#ffffff', listen: '#2b63ad', speak: '#8a5600', alert: '#b3261e'}},
  {id: 'forest', name: 'Forest',
    dark: {bg: '#0f1712', panel: '#16221b', raise: '#203026', ink: '#e7f0e6', muted: '#98ab9b', line: '#2a3c30', accent: '#93d38d', onAccent: '#0c240f', listen: '#82b9ea', speak: '#e8c26f', alert: '#ef7d6d'},
    light: {bg: '#eef3ee', panel: '#ffffff', raise: '#eef4ee', ink: '#142016', muted: '#526356', line: '#d2ded3', accent: '#2a7230', onAccent: '#ffffff', listen: '#2b63ad', speak: '#8a5600', alert: '#b3261e'}},
  {id: 'ember', name: 'Ember',
    dark: {bg: '#1a1210', panel: '#241a16', raise: '#31231e', ink: '#f4e9e3', muted: '#b29e94', line: '#3e2e28', accent: '#ff8d5e', onAccent: '#2b0e03', listen: '#82b3ea', speak: '#6fd0a0', alert: '#ff6b6b'},
    light: {bg: '#f8f1ec', panel: '#ffffff', raise: '#f6ede7', ink: '#2a1a14', muted: '#6e594f', line: '#e8d8ce', accent: '#ad431b', onAccent: '#ffffff', listen: '#2b63ad', speak: '#1f7a50', alert: '#a82722'}},
  {id: 'contrast', name: 'High Contrast',
    dark: {bg: '#000000', panel: '#0d0d0d', raise: '#1c1c1c', ink: '#ffffff', muted: '#c4c4c4', line: '#5a5a5a', accent: '#ffd60a', onAccent: '#000000', listen: '#6cb6ff', speak: '#5ee39a', alert: '#ff7070'},
    light: {bg: '#ffffff', panel: '#ffffff', raise: '#f0f0f0', ink: '#000000', muted: '#3d3d3d', line: '#8a8a8a', accent: '#0a3da8', onAccent: '#ffffff', listen: '#7a2e00', speak: '#0b5d34', alert: '#a3150d'}}
];
export const paletteById = id => PALETTES.find(p => p.id === id) || PALETTES[0];
