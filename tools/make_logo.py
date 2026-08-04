#!/usr/bin/env python3
"""Prepara el logo de L'Arjup para la interfaz: quita el fondo blanco y
recorta dos versiones.

El pato es blanco igual que el fondo, así que no vale con "borrar todo lo
blanco": se hace flood fill desde los bordes, de modo que solo desaparece el
blanco conectado al exterior y el relleno del pato se conserva.

Salida en assets/brand/:
    arjup-logo.png   logo completo (pato + triángulo + texto), transparente
    arjup-icon.png   solo pato + triángulo, para el header

    python3 tools/make_logo.py [origen.png]
"""
import os
import sys
from collections import deque

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Desktop/logoarjup.png')
OUT = os.path.join(HERE, '..', 'assets', 'brand')

WHITE = 232        # umbral de "es fondo": los tres canales por encima
FEATHER = 200      # por debajo de esto el píxel es opaco del todo


def strip_background(img):
    """Transparenta el blanco conectado al borde. Devuelve RGBA."""
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()

    bg = [[False] * h for _ in range(w)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))

    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or bg[x][y]:
            continue
        r, g, b, _ = px[x, y]
        if min(r, g, b) < WHITE:
            continue
        bg[x][y] = True
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    # alfa suave en el halo: el borde del dibujo está antialiaseado contra
    # blanco, así que un corte duro deja una orla clara.
    for x in range(w):
        for y in range(h):
            if bg[x][y]:
                px[x, y] = (255, 255, 255, 0)
                continue
            touches_bg = any(
                0 <= x + dx < w and 0 <= y + dy < h and bg[x + dx][y + dy]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if not touches_bg:
                continue
            r, g, b, _ = px[x, y]
            lum = (r + g + b) / 3
            if lum > FEATHER:
                a = int(255 * max(0.0, (WHITE - lum) / (WHITE - FEATHER)))
                px[x, y] = (r, g, b, a)
    return img


def main():
    if not os.path.exists(SRC):
        sys.exit(f'No trobo {SRC}')
    os.makedirs(OUT, exist_ok=True)

    img = strip_background(Image.open(SRC))
    img = img.crop(img.getbbox())          # fuera el margen transparente
    full = os.path.join(OUT, 'arjup-logo.png')
    img.save(full)
    print(f'  arjup-logo.png  {img.size[0]}x{img.size[1]}')

    # icono = mitad superior (pato + triángulo), sin el texto de abajo
    w, h = img.size
    icon = img.crop((0, 0, w, int(h * 0.675)))
    icon = icon.crop(icon.getbbox())
    icon.save(os.path.join(OUT, 'arjup-icon.png'))
    print(f'  arjup-icon.png  {icon.size[0]}x{icon.size[1]}')


if __name__ == '__main__':
    main()
