#!/usr/bin/env python3
"""Generate the voice-over. Usage: python3 tts.py <workspace> [voice] [rate]

Reads <workspace>/video/narration.json ({"scene_id": "text", ...}) and writes
video/public/voice/<scene_id>.wav plus durations.json. Only lines whose text,
voice or rate changed are regenerated. Default voice: Daniel (en_GB), 172 wpm.

Write text for the ear: spell acronyms with dots ("S.S.P."), numbers the way
they should be read ("CORE twenty-four oh six", "twenty four pounds sixty
five"), short sentences.
"""
import hashlib, json, os, subprocess, sys, wave

ws = os.path.abspath(sys.argv[1])
voice = sys.argv[2] if len(sys.argv) > 2 else 'Daniel'
rate = sys.argv[3] if len(sys.argv) > 3 else '172'
video = os.path.join(ws, 'video')
out_dir = os.path.join(video, 'public', 'voice')
os.makedirs(out_dir, exist_ok=True)
lines = json.load(open(os.path.join(video, 'narration.json')))
cache_path = os.path.join(out_dir, '.cache.json')
cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
durations = {}
for key, text in lines.items():
    path = os.path.join(out_dir, f'{key}.wav')
    digest = hashlib.sha1(f'{voice}|{rate}|{text}'.encode()).hexdigest()
    if cache.get(key) != digest or not os.path.exists(path):
        subprocess.run(['say', '-v', voice, '-r', rate, '--file-format=WAVE', '--data-format=LEI16@48000', '-o', path, text], check=True)
        cache[key] = digest
    with wave.open(path) as w:
        durations[key] = round(w.getnframes() / w.getframerate(), 2)
json.dump(durations, open(os.path.join(out_dir, 'durations.json'), 'w'), indent=1)
json.dump(cache, open(cache_path, 'w'))
print(json.dumps(durations, indent=1))
