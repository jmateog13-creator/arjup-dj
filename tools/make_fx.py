#!/usr/bin/env python3
"""Genera el banco 2 del sampler: FX de DJ sintetizados (sirena, bocina,
riser, barridos, sub drop, zap, aplausos).

Solo stdlib — sin numpy, sin descargas, sin licencias que mirar: la onda se
calcula aquí. Salida: assets/tracks/samples/bank2/pad1..8.wav (16-bit mono).

    python3 tools/make_fx.py
"""
import math
import os
import random
import struct
import wave

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   '..', 'assets', 'tracks', 'samples', 'bank2')


# ── helpers ────────────────────────────────────────────────────────────────

FC_MAX = SR / 8      # Chamberlin solo es estable muy por debajo de Nyquist


def svf(sig, cutoff, q=1.4, mode='low'):
    """State-variable filter (Chamberlin). `cutoff` = float o lista por muestra.

    El cutoff se limita a SR/8 y la q tiene suelo: por encima de eso el filtro
    se autoexcita y la señal sale NaN.
    """
    low = band = 0.0
    out = []
    fixed = not isinstance(cutoff, list)
    q = max(q, 0.5)
    for i, x in enumerate(sig):
        fc = min(max(cutoff if fixed else cutoff[i], 20.0), FC_MAX)
        f = 2.0 * math.sin(math.pi * fc / SR)
        high = x - low - q * band
        band += f * high
        low += f * band
        if not (math.isfinite(low) and math.isfinite(band)):
            low = band = high = 0.0
        out.append({'low': low, 'high': high, 'band': band}[mode])
    return out


def env(sig, attack=0.005, release=0.02):
    """Fade in/out lineal — sin esto los pads chasquean al dispararse."""
    n = len(sig)
    a, r = max(1, int(attack * SR)), max(1, int(release * SR))
    for i in range(min(a, n)):
        sig[i] *= i / a
    for i in range(min(r, n)):
        sig[n - 1 - i] *= i / r
    return sig


def write(name, sig, peak=0.89):
    sig = env(sig)
    m = max(abs(s) for s in sig) or 1.0
    g = peak / m
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(
            struct.pack('<h', max(-32768, min(32767, int(s * g * 32767)))) for s in sig))
    print(f'  {name:10s} {len(sig)/SR:5.2f}s  {os.path.getsize(path)//1024:4d} KB')


def t_axis(dur):
    return [i / SR for i in range(int(dur * SR))]


# ── FX ─────────────────────────────────────────────────────────────────────

def siren(dur=3.0):
    """Sirena de rave: tono con la frecuencia barrida por un LFO lento."""
    out, phase = [], 0.0
    for t in t_axis(dur):
        f = 900 + 500 * math.sin(2 * math.pi * 0.9 * t)
        phase += 2 * math.pi * f / SR
        # sine + armónicos impares = mordiente sin llegar a cuadrada
        out.append(math.sin(phase) + 0.35 * math.sin(3 * phase) + 0.12 * math.sin(5 * phase))
    return out


def airhorn(dur=1.6):
    """Bocina dancehall: dos voces a la quinta, con caída de tono al final."""
    out, p1, p2, p3 = [], 0.0, 0.0, 0.0
    for t in t_axis(dur):
        bend = 1.0 if t < dur * 0.75 else 1.0 - 0.12 * (t - dur * 0.75) / (dur * 0.25)
        f = 233 * bend
        p1 += 2 * math.pi * f / SR
        p2 += 2 * math.pi * (f * 1.5) / SR          # quinta
        p3 += 2 * math.pi * (f * 1.005) / SR        # desafinado = grosor
        saw = lambda p: 2 * ((p / (2 * math.pi)) % 1.0) - 1
        out.append(0.5 * saw(p1) + 0.35 * saw(p2) + 0.4 * saw(p3))
    return svf(out, 2600, q=0.8)


def riser(dur=2.0):
    """Uplifter: ruido con bandpass ascendente + tono que sube en paralelo."""
    n = int(dur * SR)
    noise = [random.uniform(-1, 1) for _ in range(n)]
    cut = [300 * (FC_MAX / 300) ** (i / n) for i in range(n)]   # 300 Hz → FC_MAX
    swept = svf(noise, cut, q=0.6, mode='band')
    out, phase = [], 0.0
    for i in range(n):
        k = i / n
        phase += 2 * math.pi * (200 * (8 ** k)) / SR
        out.append(swept[i] * (0.25 + 0.75 * k) + 0.35 * math.sin(phase) * k * k)
    return out


def downsweep(dur=1.5):
    """Barrido de bajada para cerrar una frase."""
    n = int(dur * SR)
    noise = [random.uniform(-1, 1) for _ in range(n)]
    cut = [FC_MAX * (0.03 ** (i / n)) for i in range(n)]
    return svf(noise, cut, q=0.7, mode='band')


def subdrop(dur=2.2):
    """Sub drop: seno de 130 a 28 Hz. Pide altavoces con graves de verdad."""
    out, phase = [], 0.0
    n = int(dur * SR)
    for i in range(n):
        k = i / n
        phase += 2 * math.pi * (130 * ((28 / 130) ** k)) / SR
        out.append(math.sin(phase) * (1 - k * 0.45))
    return out


def zap(dur=0.35):
    """Laser descendente."""
    out, phase = [], 0.0
    n = int(dur * SR)
    for i in range(n):
        k = i / n
        phase += 2 * math.pi * (5200 * ((0.03) ** k)) / SR
        out.append(math.sin(phase) * math.exp(-4 * k))
    return out


def noise_up(dur=2.0):
    """Barrido blanco en crescendo — transición clásica."""
    n = int(dur * SR)
    noise = [random.uniform(-1, 1) for _ in range(n)]
    cut = [800 + (FC_MAX - 800) * (i / n) ** 2 for i in range(n)]
    hp = svf(noise, cut, q=0.9, mode='high')
    return [hp[i] * (i / n) ** 1.5 for i in range(n)]


def applause(dur=3.2):
    """Multitud: lecho de ruido filtrado + palmadas sueltas con timing aleatorio."""
    n = int(dur * SR)
    random.seed(7)                                   # reproducible entre ejecuciones
    bed = svf([random.uniform(-1, 1) for _ in range(n)], 2200, q=0.7, mode='band')
    out = [0.0] * n
    for i in range(n):
        k = i / n
        swell = min(1.0, k * 6) * (1 - 0.5 * max(0.0, k - 0.6) / 0.4)
        out[i] = bed[i] * 0.55 * swell
    for _ in range(420):                             # palmadas individuales
        pos = int(random.triangular(0, n, n * 0.25))
        amp = random.uniform(0.2, 1.0)
        clap = int(0.012 * SR)
        for j in range(clap):
            if pos + j >= n:
                break
            out[pos + j] += random.uniform(-1, 1) * amp * math.exp(-28 * j / SR * 12)
    return svf(out, 240, q=0.7, mode='high')          # fuera el retumbe grave


BANK = [
    ('pad1.wav', 'SIREN', siren),
    ('pad2.wav', 'HORN', airhorn),
    ('pad3.wav', 'RISE', riser),
    ('pad4.wav', 'DOWN', downsweep),
    ('pad5.wav', 'DROP', subdrop),
    ('pad6.wav', 'ZAP', zap),
    ('pad7.wav', 'SWEEP', noise_up),
    ('pad8.wav', 'CROWD', applause),
]

if __name__ == '__main__':
    print(f'Generant banc 2 a {os.path.relpath(OUT)}/')
    for fname, label, fn in BANK:
        write(fname, fn())
    print('Fet. Al sampler: botó B2.')
