#!/usr/bin/env python3
"""Cut screencast frames into one mp4 per demo segment.

Usage: python3 build_clips.py <workspace> [--force]

Reads <workspace>/recorder/segments.json:
  {"a_setup": {"run": "master", "from": "A_setup_start", "to": "A_setup_end",
               "from_offset": -0.5, "to_offset": 0.5, "cap": 2.0}, ...}
`from`/`to` are marker labels from recorder/markers.jsonl (the last marker
with that label wins). Offsets are seconds. `cap` shortens idle gaps (time
spent inspecting between steps) to at most that many seconds; use ~1.2 for
form filling and ~2.5 for screens the narration talks over.

Writes <workspace>/video/public/clips/<name>.mp4 and durations.json. Existing
clips are kept unless --force (so re-cutting one clip is cheap: delete it).
"""
import json, os, platform, subprocess, sys

ws = os.path.abspath(sys.argv[1])
force = '--force' in sys.argv
rec = os.path.join(ws, 'recorder')
video = os.path.join(ws, 'video')
out_dir = os.path.join(video, 'public', 'clips')
os.makedirs(out_dir, exist_ok=True)
# Remotion's bundled ffmpeg has no `fps` filter: use -r/-fps_mode instead, and
# call the binary directly (the `npx remotion ffmpeg` wrapper mangles -vf).
# Remotion installs the compositor (and its ffmpeg) for the host's CPU only.
arch = 'arm64' if platform.machine() == 'arm64' else 'x64'
comp = os.path.join(video, 'node_modules', '@remotion', f'compositor-darwin-{arch}')
if not os.path.isdir(comp):
    raise SystemExit(f'No Remotion compositor at {comp}. Run npm install in {video} first.')
ff = os.path.join(comp, 'ffmpeg')
env = {**os.environ, 'DYLD_LIBRARY_PATH': comp}

marks = {}
for line in open(os.path.join(rec, 'markers.jsonl')):
    m = json.loads(line)
    marks[m['label']] = m['t']
segments = json.load(open(os.path.join(rec, 'segments.json')))
dur_path = os.path.join(out_dir, 'durations.json')
info = json.load(open(dur_path)) if os.path.exists(dur_path) else {}

for name, s in segments.items():
    out = os.path.join(out_dir, f'{name}.mp4')
    if not force and os.path.exists(out) and name in info:
        continue
    start = marks[s['from']] + s.get('from_offset', 0)
    end = marks[s['to']] + s.get('to_offset', 0)
    cap = s.get('cap', 2.0)
    frames = json.load(open(os.path.join(rec, 'frames', s['run'], 'index.json')))
    before = [f for f in frames if f['t'] < start]
    sel = ([before[-1]] if before else []) + [f for f in frames if start <= f['t'] <= end]
    if not sel:
        raise SystemExit(f'{name}: no frames between the markers')
    lines, total = [], 0.0
    for i, f in enumerate(sel):
        t = max(f['t'], start)
        nxt = sel[i + 1]['t'] if i + 1 < len(sel) else end
        d = min(max(nxt - t, 1 / 30), cap)
        total += d
        lines.append(f"file '{os.path.join(rec, 'frames', s['run'], f['file'])}'\nduration {d:.4f}")
    lines.append(f"file '{os.path.join(rec, 'frames', s['run'], sel[-1]['file'])}'")
    concat = os.path.join(rec, f'.{name}.concat.txt')
    open(concat, 'w').write('\n'.join(lines) + '\n')
    subprocess.run([ff, '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat,
                    '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-r', '30', '-fps_mode', 'cfr',
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', out], check=True, env=env)
    info[name] = round(total, 2)
    print(f'{name}: {len(sel)} frames, {total:.1f}s')

json.dump(info, open(dur_path, 'w'), indent=1)
