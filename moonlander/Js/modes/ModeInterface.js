// modes/ModeInterface.js — v0.1.0
// This file is documentation only. Each mode in this folder implements the
// same shape so Main.js can swap modes without caring which one is active.
//
// A Mode is an object with these methods:
//
//   enter(context)   — called ONCE when entering this mode.
//                      Build scenes, load assets, attach camera.
//                      `context` is { renderer, canvas, sharedScene? }.
//
//   exit()           — called ONCE when leaving this mode.
//                      Dispose geometries/materials/textures. Remove listeners.
//                      This is the memory-discipline checkpoint discussed in
//                      the design conversation. If you skip it, GPU resources
//                      leak and memory climbs forever.
//
//   update(dt)       — called every frame while active. Physics, logic, input.
//                      dt is seconds since last frame.
//
//   render()         — called every frame after update(). Issues renderer.render().
//                      Usually one line; exists as a hook for future post-processing.
//
//   getCamera()      — returns the THREE.Camera this mode wants active.
//                      Main.js reads this for the cinematic transition between modes.
//
// Modes should NOT call renderer.render() during enter/exit — Main drives the loop.
// Modes MUST NOT hold references that outlive their exit(). The scene graph they
// build should be fully reachable from a single root that they null out in exit().

export const ModeInterfaceDoc = true; // marker export so this file isn't empty
