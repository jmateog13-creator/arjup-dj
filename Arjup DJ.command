#!/bin/bash
# Doble clic al Finder → arranca el servidor local i obre la mesa al navegador.
cd "$(dirname "$0")" || exit 1
PORT=8151

if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  open "http://localhost:$PORT"          # ja servint: només obrir
  exit 0
fi

python3 serve_nocache.py "$PORT" &
SERVER=$!
until nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
  kill -0 "$SERVER" 2>/dev/null || { echo "El servidor no ha arrancat."; exit 1; }
  sleep 0.2
done
open "http://localhost:$PORT"

echo "Arjup DJ servint a http://localhost:$PORT — tanca aquesta finestra per aturar-lo."
wait "$SERVER"
