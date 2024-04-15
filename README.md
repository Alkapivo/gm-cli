# gm-cli
Gamemaker CLI toolkit. Watch &amp; sync gml sources with yyp project.

# Requirements
- [Node.js](https://nodejs.org) 18.16^
- [find](https://en.wikipedia.org/wiki/Find_(Unix))

# Install
```bash
npm install
```

# Usage
```bash
gm-cli watch
```

# Project structure
```
- gm_modules:
  - core: git repo with gml `*.gml` files
  - visu: git repo with gml `*.gml` files
- yyp:
  - datafiles: directory created by gamemaker
  - extensions: directory created by gamemaker
  - fonts: directory created by gamemaker
  - objects: directory created by gamemaker
  - options: directory created by gamemaker
  - rooms: directory created by gamemaker
  - scripts: directory created by gamemaker
  - shaders: directory created by gamemaker
  - sounds: directory created by gamemaker
  - sprites: directory created by gamemaker
  - game.resource_order: file created by gamemaker
  - game.yyp: file created by gamemaker
- package-gm.json: Equivalent of `npm` "package.json"
```
Content of `package-gm.json`:
```json
{
  "name": "visu",
  "version": "1.0.0",
  "description": "Visu",
  "main": "yyp",
  "author": "Alkapivo",
  "license": "ISC",
  "dependencies": {
    "core": "^1.0.0",
    "visu": "^1.0.0"
  }
}
```
Note: 
- `main` is a relative directory path, where `*.yyp` file (gamemaker studio 2.3 project).
- `dependencies` - keys should match names in `gm_modules` folder