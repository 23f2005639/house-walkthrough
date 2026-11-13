#!/usr/bin/env bash
# Start the walkthrough: serves this folder and opens the viewer in your browser.
cd "$(dirname "$0")"
[ -d node_modules/three ] || npm install
[ -f web/house.glb ] || blender -b --factory-startup -P blender/build.py
(sleep 1; xdg-open http://127.0.0.1:8000/web/) &
python3 -m http.server 8000 --bind 127.0.0.1
