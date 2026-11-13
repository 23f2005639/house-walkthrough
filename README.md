# House Walkthrough

A 3D first-person walk through a house, running in your web browser (Three.js).

## Requirements

- [Node.js](https://nodejs.org) (LTS), which provides `npm`
- [Python 3](https://www.python.org/downloads/), used only to serve the files locally
- A modern browser (Chrome, Edge or Firefox)

## Run it

First get the code:

```
git clone https://github.com/23f2005639/house-walkthrough.git
cd house-walkthrough
```

### Linux

```
./run.sh
```

The walkthrough opens in your browser automatically.

### macOS

```
npm install
python3 -m http.server 8000
```

Then open http://127.0.0.1:8000/web/ in your browser.

### Windows (Command Prompt or PowerShell)

```
npm install
python -m http.server 8000
```

If `python` is not found, use `py -m http.server 8000`. Then open http://127.0.0.1:8000/web/ in your browser.

To stop the server on any system, press `Ctrl+C` in the terminal.

> Opening `web/index.html` by double-clicking it does not work. The browser blocks the 3D model from loading, so always use the server.

## Controls

Click the screen to start.

| Key | Action |
|-----|--------|
| W A S D / arrow keys | Walk |
| Mouse | Look around |
| Shift | Run |
| T | Toggle top view |
| L | Toggle lights |
| O | Toggle soft shadows (turn off if it runs slowly) |
| Esc | Pause |
