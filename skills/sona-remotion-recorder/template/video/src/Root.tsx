import React from 'react';
import {Composition} from 'remotion';
import {DEMO_TOTAL_FRAMES, Demo} from './demo';
import {FPS} from './theme';

export const RemotionRoot: React.FC = () => (
  <Composition id="Demo" component={Demo} durationInFrames={DEMO_TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
