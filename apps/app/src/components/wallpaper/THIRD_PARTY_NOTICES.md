# Wallpaper attribution

The photo wallpaper effect is adapted from Aura by Mateo Cerquetella (MIT):
https://github.com/MateoCerquetella/bb-plugins/tree/4c5f90a58ea50e45431b94739ab4ffe41079b93e/plugins/aura

See `licenses/AURA-MIT.txt`.

`photo-shaders.ts` retains Aura's vertex and image-dithering shader text,
including its animated threshold-wave variant. Aura attributes the underlying
GLSL to Paper Shaders by Paper Design, licensed under Apache-2.0:
https://github.com/paper-design/shaders
See `licenses/PAPER-SHADERS-APACHE-2.0.txt`.

Aura extracted those shaders from Capy's public bundles on 2026-09-08:
https://capy.ai/assets/bounded-dithering-CsxWlFZG.js
https://capy.ai/assets/new-D4WvqOy9.js

`photo.ts` adapts Aura's photo renderer: an 8×8 pattern, four brightness
steps, original colors, two-CSS-pixel cells, a half-resolution framebuffer, a
30 fps limit, and a gentle threshold-wave animation. The effect makes no
runtime requests to Aura, Capy, or Paper Design.
