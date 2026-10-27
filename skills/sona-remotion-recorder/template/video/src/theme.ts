import {loadFont as loadSora} from '@remotion/google-fonts/Sora';
import {loadFont as loadMono} from '@remotion/google-fonts/IBMPlexMono';

export const sora = loadSora('normal', {
  weights: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
}).fontFamily;

export const mono = loadMono('normal', {
  weights: ['400', '500', '600'],
  subsets: ['latin'],
}).fontFamily;

// Sona brand palette (Feb 2026). Red is only used for the "bug" tag, as the
// brand's critical tag colour pair.
export const C = {
  darkTeal: '#021b25',
  stone50: '#fafaf9',
  stone100: '#f5f5f4',
  stone200: '#e7e5e4',
  stone300: '#d6d3d0',
  stone400: '#a8a29e',
  stone500: '#78716c',
  stone950: '#1c1917',
  teal600: '#0d9488',
  lime200: '#d9f99d',
  lime500: '#84cc16',
  sky200: '#bae6fd',
  red100: '#fee2e2',
  red500: '#ef4444',
} as const;

export const FPS = 30;
export const PAD_X = 120;

// Footer on every card: ticket, PR and a few words about the change.
export const FOOTER_LABEL = 'CORE-0000 · PR #00000 · <short topic>';
