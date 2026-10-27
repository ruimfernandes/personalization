import React from 'react';
import {AbsoluteFill, Audio, OffthreadVideo, Sequence, Series, interpolate, staticFile, useCurrentFrame} from 'remotion';
import clipDurations from '../public/clips/durations.json';
import voiceDurations from '../public/voice/durations.json';
import {Appear, Body, Diamond, Eyebrow, Headline, Label, Scene} from './ui';
import {C, FPS, mono, sora} from './theme';

// A real-app demo: screen recordings cut into clips, a voice-over per scene,
// and a few title cards. Scene length follows the narration. A clip longer
// than its narration plays faster, up to MAX_RATE; a shorter one plays slower.
//
// To adapt: edit ITEMS (and the cards below). Every item's `voice` is a key in
// narration.json; every clip item's `clip` is a key in recorder/segments.json.
const LEAD = 0.5;
const TAIL = 0.8;
const MAX_RATE = 3.5;

type Voice = keyof typeof voiceDurations;
type Clip = keyof typeof clipDurations;
type Run = 'before' | 'after';

type Item =
  | {kind: 'card'; voice: Voice; render: (duration: number) => React.ReactNode}
  | {kind: 'clip'; voice: Voice; clip: Clip; run: Run; label: string};

// Ticket, PR and refs shown on the cards.
const TICKET = 'CORE-0000';
const PR = 'PR #00000';
const BEFORE_REF = 'master (PR merge base)';
const AFTER_REF = 'branch';

const ITEMS: Item[] = [
  {kind: 'card', voice: 'title', render: (d) => <TitleCard duration={d} />},
  {kind: 'card', voice: 'problem', render: (d) => <PointsCard duration={d} eyebrow="The problem" title="<Headline, sentence case, no full stop>" points={['<point>', '<point>']} />},
  {kind: 'clip', voice: 'a_setup', clip: 'a_setup', run: 'before', label: 'Story A · <what is on screen>'},
  {kind: 'clip', voice: 'a_before', clip: 'a_before', run: 'before', label: 'Story A · <result>'},
  {kind: 'card', voice: 'switch', render: (d) => <SwitchCard duration={d} />},
  {kind: 'clip', voice: 'a_after', clip: 'a_after', run: 'after', label: 'Story A · <result>'},
  {kind: 'card', voice: 'summary', render: (d) => <SummaryCard duration={d} />},
];

const timing = (item: Item) => {
  const spoken = voiceDurations[item.voice] + LEAD + TAIL;
  if (item.kind === 'card') return {seconds: Math.max(spoken, 3), rate: 1};
  const clip = clipDurations[item.clip];
  const seconds = Math.max(spoken, clip / MAX_RATE);
  return {seconds, rate: clip / seconds};
};

const frames = (seconds: number) => Math.round(seconds * FPS);

export const DEMO_TOTAL_FRAMES = ITEMS.reduce((sum, item) => sum + frames(timing(item).seconds), 0);

// Bottom-left, right of the app sidebar: empty on the recorded screens, unlike
// the bottom-right where side panels keep their Save buttons.
const RunTag: React.FC<{run: Run; label: string}> = ({run, label}) => (
  <div style={{position: 'absolute', left: 260, bottom: 40, backgroundColor: C.darkTeal, borderRadius: 4, padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 8}}>
    <div style={{display: 'inline-flex', alignItems: 'center', gap: 10, color: run === 'before' ? C.stone200 : C.lime200}}>
      <Diamond size={14} />
      <span style={{fontFamily: mono, fontSize: 18, fontWeight: 600, letterSpacing: '0.15em'}}>
        {run === 'before' ? 'MASTER · BEFORE' : 'BRANCH · AFTER'}
      </span>
    </div>
    <span style={{fontFamily: sora, fontSize: 22, fontWeight: 400, color: '#ffffff'}}>{label}</span>
  </div>
);

const ClipScene: React.FC<{clip: Clip; rate: number; duration: number; run: Run; label: string}> = ({clip, rate, duration, run, label}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, duration - 8, duration], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{backgroundColor: C.stone50}}>
      <AbsoluteFill style={{opacity}}>
        <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} playbackRate={rate} muted />
        <RunTag run={run} label={label} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Footer: React.FC = () => (
  <Label size={15} color={C.stone300}>
    {`Recorded on the real app · local sandbox · ${BEFORE_REF} vs ${AFTER_REF}`}
  </Label>
);

const TitleCard: React.FC<{duration: number}> = ({duration}) => (
  <Scene duration={duration} dark>
    <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 110}}>
      <Appear delay={4}>
        <Eyebrow dark>{`${TICKET} · ${PR}`}</Eyebrow>
      </Appear>
      <div style={{height: 32}} />
      <Appear delay={12}>
        <Headline dark size={84}>
          {'<What the fix does, sentence case, no full stop>'}
        </Headline>
      </Appear>
      <div style={{height: 32}} />
      <Appear delay={24}>
        <Body dark size={32} style={{maxWidth: 1300}}>
          {'<One or two short sentences.>'}
        </Body>
      </Appear>
      <div style={{height: 48}} />
      <Appear delay={36}>
        <Footer />
      </Appear>
    </div>
  </Scene>
);

const PointsCard: React.FC<{duration: number; eyebrow: string; title: string; points: string[]; delays?: number[]}> = ({duration, eyebrow, title, points, delays}) => (
  <Scene duration={duration}>
    <Appear delay={4}>
      <Eyebrow>{eyebrow}</Eyebrow>
    </Appear>
    <div style={{height: 24}} />
    <Appear delay={10}>
      <Headline>{title}</Headline>
    </Appear>
    <div style={{height: 56}} />
    <div style={{display: 'flex', flexDirection: 'column', gap: 28}}>
      {points.map((p, i) => (
        <Appear key={p} delay={delays?.[i] ?? 40 + i * 60}>
          <div style={{display: 'flex', gap: 24, alignItems: 'flex-start', paddingTop: 28, borderTop: `1px solid ${C.stone200}`}}>
            <div style={{paddingTop: 12, color: C.teal600}}>
              <Diamond size={18} />
            </div>
            <Body size={30} style={{maxWidth: 1450}}>
              {p}
            </Body>
          </div>
        </Appear>
      ))}
    </div>
  </Scene>
);

const SwitchCard: React.FC<{duration: number}> = ({duration}) => (
  <Scene duration={duration} dark>
    <Appear delay={4}>
      <Eyebrow dark>Same data, new code</Eyebrow>
    </Appear>
    <div style={{height: 24}} />
    <Appear delay={10}>
      <Headline dark>Switch to the branch</Headline>
    </Appear>
    <div style={{height: 40}} />
    <Appear delay={30}>
      <Body dark size={30} style={{maxWidth: 1300}}>
        {'<How the new code gets applied to the same data, e.g. re-save each record.>'}
      </Body>
    </Appear>
  </Scene>
);

// Real numbers only: copy them from the database checks made while recording.
const SummaryCard: React.FC<{duration: number}> = ({duration}) => {
  const header = ['Story', 'Master', 'Branch'];
  const rows: string[][] = [['<story>', '<before>', '<after>']];
  const widths = [620, 470, 470];
  return (
    <Scene duration={duration} dark>
      <Appear delay={4}>
        <Eyebrow dark>Result on the real app</Eyebrow>
      </Appear>
      <div style={{height: 20}} />
      <Appear delay={10}>
        <Headline dark>{'<Result headline>'}</Headline>
      </Appear>
      <div style={{height: 44}} />
      <Appear delay={20}>
        <div style={{border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, width: widths.reduce((a, b) => a + b, 0)}}>
          <div style={{display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.12)'}}>
            {header.map((h, i) => (
              <div key={h} style={{width: widths[i], padding: '18px 28px'}}>
                <Label size={16} color={C.stone200}>
                  {h}
                </Label>
              </div>
            ))}
          </div>
          {rows.map((row, r) => (
            <div key={row[0]} style={{display: 'flex', borderTop: r === 0 ? 'none' : '1px solid rgba(255,255,255,0.12)'}}>
              {row.map((text, i) => (
                <div key={i} style={{width: widths[i], padding: '20px 28px', fontFamily: sora, fontSize: 26, fontWeight: i === 2 ? 600 : 400, color: i === 2 ? C.lime200 : '#ffffff'}}>
                  {text}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Appear>
      <div style={{height: 40}} />
      <Appear delay={60}>
        <Footer />
      </Appear>
    </Scene>
  );
};

export const Demo: React.FC = () => (
  <Series>
    {ITEMS.map((item) => {
      const {seconds, rate} = timing(item);
      const duration = frames(seconds);
      return (
        <Series.Sequence key={item.voice} durationInFrames={duration}>
          {item.kind === 'card' ? item.render(duration) : <ClipScene clip={item.clip} rate={rate} duration={duration} run={item.run} label={item.label} />}
          <Sequence from={frames(LEAD)}>
            <Audio src={staticFile(`voice/${item.voice}.wav`)} />
          </Sequence>
        </Series.Sequence>
      );
    })}
  </Series>
);
