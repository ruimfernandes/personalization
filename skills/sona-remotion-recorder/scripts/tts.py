#!/usr/bin/env python3
"""Generate the voice-over. Usage: python3 tts.py <workspace> [voice] [rate]

Reads <workspace>/video/narration.json ({"scene_id": "text", ...}) and writes
video/public/voice/<scene_id>.wav plus durations.json. Only lines whose text,
engine, voice or rate changed are regenerated. Default voice: Daniel (en_GB).

Engine, first match wins:
  1. ElevenLabs, when a key is found: $ELEVENLABS_API_KEY2, then
     $ELEVENLABS_API_KEY, then `bos-cred elevenlabs` on a bos VM.
  2. macOS `say` (172 wpm), when there is no key.
Set TTS_ENGINE=say or TTS_ENGINE=elevenlabs to force one. An ElevenLabs error
stops the run instead of falling back, so one video never mixes two voices.
ELEVENLABS_VOICE_ID overrides the ElevenLabs voice. The key is never printed.

Write text for the ear: spell acronyms with dots ("S.S.P."), numbers the way
they should be read ("CORE twenty-four oh six", "twenty four pounds sixty
five"), short sentences.
"""
import hashlib, json, os, shutil, subprocess, sys, urllib.error, urllib.request, wave

ELEVEN_VOICES = {'Daniel': 'onwK4e9ZLuTAKqWW03F9'}   # ElevenLabs' British "Daniel", to match the macOS voice
ELEVEN_MODEL = 'eleven_multilingual_v2'
ELEVEN_RATE = 24000                                  # pcm_24000: raw 16-bit mono, wrapped as WAV below


def eleven_key():
    for name in ('ELEVENLABS_API_KEY2', 'ELEVENLABS_API_KEY'):
        if os.environ.get(name):
            return os.environ[name]
    if shutil.which('bos-cred'):
        r = subprocess.run(['bos-cred', 'elevenlabs'], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    return None


def eleven_tts(key, voice_id, text, path):
    body = json.dumps({'text': text, 'model_id': ELEVEN_MODEL,
                       'voice_settings': {'stability': 0.4, 'similarity_boost': 0.75,
                                          'style': 0.45, 'use_speaker_boost': True}}).encode()
    req = urllib.request.Request(
        f'https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=pcm_{ELEVEN_RATE}',
        data=body, headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            pcm = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f'ElevenLabs failed (http {e.code}): {e.read()[:200].decode(errors="replace")}\n'
                 'Fix the key or quota, or re-run the whole voice-over with TTS_ENGINE=say.')
    if not pcm:
        sys.exit('ElevenLabs returned no audio.')
    tmp = path + '.tmp'   # a failed write must not replace a good clip
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(ELEVEN_RATE)
        w.writeframes(pcm)
    os.replace(tmp, path)


ws = os.path.abspath(sys.argv[1])
voice = sys.argv[2] if len(sys.argv) > 2 else 'Daniel'
rate = sys.argv[3] if len(sys.argv) > 3 else '172'

engine = os.environ.get('TTS_ENGINE', '')
key = eleven_key() if engine in ('', 'elevenlabs') else None
if engine == 'elevenlabs' and not key:
    sys.exit('TTS_ENGINE=elevenlabs but no ElevenLabs key was found.')
if not engine:
    engine = 'elevenlabs' if key else 'say'
if engine == 'say' and not shutil.which('say'):
    sys.exit('No ElevenLabs key, and no macOS `say` on this machine. '
             'Set ELEVENLABS_API_KEY, or on a bos VM run: bos creds set elevenlabs')
voice_id = os.environ.get('ELEVENLABS_VOICE_ID') or ELEVEN_VOICES.get(voice, voice)
print(f'voice-over: {engine}, voice {voice_id if engine == "elevenlabs" else voice}', file=sys.stderr)

video = os.path.join(ws, 'video')
out_dir = os.path.join(video, 'public', 'voice')
os.makedirs(out_dir, exist_ok=True)
lines = json.load(open(os.path.join(video, 'narration.json')))
cache_path = os.path.join(out_dir, '.cache.json')
cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
durations = {}
for line_key, text in lines.items():
    path = os.path.join(out_dir, f'{line_key}.wav')
    spoken_by = f'elevenlabs|{voice_id}|{ELEVEN_MODEL}' if engine == 'elevenlabs' else f'say|{voice}|{rate}'
    digest = hashlib.sha1(f'{spoken_by}|{text}'.encode()).hexdigest()
    if cache.get(line_key) != digest or not os.path.exists(path):
        if engine == 'elevenlabs':
            eleven_tts(key, voice_id, text, path)
        else:
            subprocess.run(['say', '-v', voice, '-r', rate, '--file-format=WAVE', '--data-format=LEI16@48000', '-o', path, text], check=True)
        cache[line_key] = digest
        json.dump(cache, open(cache_path, 'w'))   # saved per line, so a stop part-way keeps what was made
    with wave.open(path) as w:
        durations[line_key] = round(w.getnframes() / w.getframerate(), 2)
json.dump(durations, open(os.path.join(out_dir, 'durations.json'), 'w'), indent=1)
json.dump(cache, open(cache_path, 'w'))
print(json.dumps(durations, indent=1))
