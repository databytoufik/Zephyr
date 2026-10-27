// Shared app state.
export const DEFAULT_SETTINGS = {
  apiKey: '', model: 'claude-sonnet-5-5', lang: 'en-US', voice: '', rate: 1, listenWhileTalking: true,
  backupUrl: '', backupSecret: '', autoPunct: true, lenientWake: true,
  palette: 'midnight', appearance: 'auto', textSize: 'normal'
};
export const S = {
  doc: null, text: '', session: null, undo: [], redo: [],
  mode: 'draft', busy: false, heard: false, heldWhileBusy: [], unsaved: [], inline: {b: false, i: false, u: false}, lastPolished: '',
  speaking: false, awaiting: null, awaitCtx: null,
  lastSpoken: '', echo: '', speechEnd: 0, lastRead: '', lastChunk: null,
  lastFinal: '', lastFinalAt: 0, suggestions: [], abort: null,
  docTitles: [],
  listening: false,
  settings: {...DEFAULT_SETTINGS}
};
