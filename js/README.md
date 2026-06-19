# Factopolis JS layout

The game still runs as classic browser scripts loaded in order by `index.html`.
Top-level declarations are shared through the page global scope, so keep the
numeric prefixes and script order stable unless you also update dependencies.

- `01_definitions.js`: config adapters, constants, resource/building definitions, recipes, merge constants.
- `02_world_state.js`: global state, wallets, world generation, map expansion, town and worker helpers.
- `03_buildings_population.js`: building creation, stock rules, ownership, homeless/resident routing, demolition, plant upgrades.
- `04_construction.js`: placement validation, click-to-build, multiplayer placement restrictions.
- `05_logistics.js`: automatic trucks, persistent vehicle routing, delivery reservations.
- `06_simulation.js`: main simulation update, production, taxes, merges, walkers, starvation/splitting.
- `07_rendering.js`: isometric drawing, buildings, overlays, trucks, vehicles, expansion badges.
- `08_ui_input_loop.js`: HUD, info panels, toolbar, mouse/keyboard/camera, main animation loop.
- `09_multiplayer.js`: state serialization, snapshots, network actions, WebSocket handling, multiplayer panel.
- `10_saves_chat_console.js`: autosaves, chat rendering/sending, and server console commands (help, players, world, saves, say, kick, promote, setmoney, regenexpansions, spawnfields).
