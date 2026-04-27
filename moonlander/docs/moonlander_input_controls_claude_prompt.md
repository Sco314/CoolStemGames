# Claude Code Prompt: Cross-Device Input, Camera, and UI/UX Control Upgrade for Moonlander / Space Racer

You are reviewing and improving the input/control system for our browser-based **Moonlander / Space Racer** app.

## Goal

Make the app feel familiar, forgiving, and usable across:

- Desktop with mouse + keyboard
- Chromebook with keyboard + trackpad
- Chromebook with touchscreen
- Mobile Safari / mobile Chrome with touch only
- Hybrid devices where the player may switch between keyboard, trackpad, mouse, and touch during the same session

The control design should feel closer to a familiar Roblox-style third-person character controller, while still supporting the 2D lunar-lander mode.

---

## Current UX Problems to Fix

### 1. Camera / mouse orbit feels trapped

Right now, desktop mouse/camera behavior feels bad. The mouse can orbit the camera, but the user has to press **Esc** to get out of orbit or regain normal pointer behavior.

That is **not acceptable** for the default third-person camera.

Esc releasing the pointer is normal only if the game intentionally entered **pointer-lock / mouse-look mode**. But for a Roblox-like third-person camera, camera orbit should normally work like this:

```text
Press / drag = orbit camera
Release = stop orbiting
Esc = pause/settings or close overlay, not the only way to regain control
```

Default camera orbit must end on:

- `pointerup`
- `mouseup`
- `touchend`
- `pointercancel`
- `lostpointercapture`

Do **not** require Esc to stop normal orbiting.

Pointer lock may be retained only as an optional advanced setting, not the default camera behavior.

### 2. Arrow keys do not currently move the character

Desktop and Chromebook players should be able to use either:

```text
WASD
```

or:

```text
Arrow keys
```

for movement.

Add arrow-key support anywhere WASD movement currently exists.

### 3. Spacebar and E action behavior needs to match the actual game

The game does **not currently use jump**.

Because there is no jump mechanic right now, it is acceptable for **Spacebar** to act as a secondary action/interact key in 3D walk mode.

However, design this in a future-proof way:

- `E` should be the **primary interact/action key**.
- `Space` may be a **secondary action key only because jump does not currently exist**.
- If jump is added later, Space should become jump and `E` should remain interact.

Do not show jump instructions or jump buttons unless jump is actually implemented.

---

## Core Design Requirement

Do not build separate games for each device.

Build one action-based input abstraction, then map keyboard, pointer, touch, and optional gamepad inputs into that same action state.

The gameplay code should not ask, “Was the W key pressed?” everywhere.

It should ask:

```js
input.moveX
input.moveY
input.lookX
input.lookY
input.orbitActive
input.actionPressed
input.actionHeld
input.dropPressed
input.mapPressed
input.inventoryPressed
input.pausePressed
input.thrustHeld
input.rotateLeftHeld
input.rotateRightHeld
input.resetCameraPressed
input.lastInputType
```

Then each device/input system feeds that shared state.

---

## Recommended Input State

Create or refactor toward an input state model like this:

```js
const InputState = {
  // Movement
  moveX: 0, // -1 left, +1 right
  moveY: 0, // -1 backward, +1 forward

  // Camera / look
  lookX: 0,
  lookY: 0,
  orbitActive: false,
  zoomDelta: 0,

  // General action controls
  actionPressed: false,
  actionHeld: false,
  dropPressed: false,
  mapPressed: false,
  inventoryPressed: false,
  pausePressed: false,
  resetCameraPressed: false,

  // 2D lander controls
  thrustHeld: false,
  rotateLeftHeld: false,
  rotateRightHeld: false,

  // Device awareness
  lastInputType: "keyboardMouse", // "keyboardMouse" | "touch" | "gamepad"
};
```

Use this shared action state in game modes instead of directly checking raw keys everywhere.

---

## Technical Guidance

1. Use **Pointer Events** where possible for mouse, trackpad, pen, and touch.
2. Use `event.pointerType` to distinguish `"mouse"`, `"touch"`, and `"pen"` when needed.
3. Use `KeyboardEvent.code` for physical movement keys where appropriate, especially WASD.
4. Also support arrow keys by checking either `KeyboardEvent.code` or `KeyboardEvent.key`.
5. Ensure arrow keys work in addition to WASD.
6. Prevent page scrolling when the game has focus and the player presses:
   - Space
   - ArrowUp
   - ArrowDown
   - ArrowLeft
   - ArrowRight
   - W/A/S/D as needed
7. Do not prevent default browser behavior when the player is typing in:
   - math answer fields
   - name fields
   - input fields
   - settings controls
   - forms
8. For touch controls, use CSS such as:

```css
#gameCanvas,
.touch-controls,
.touch-controls * {
  touch-action: none;
}
```

9. Do not rely only on `navigator.maxTouchPoints` to choose the UI.
10. Track the **last active input type** and update prompts accordingly.
11. Do not require right-click for any core control.
12. Do not require pointer lock for the default camera.
13. Pointer lock may exist only as an optional advanced setting/mode.
14. Use real buttons for HUD controls where possible.
15. Add `aria-label` values for icon-only buttons.

---

## Device Detection / Last Input Type

Implement a `lastInputType` system.

Rules:

```text
Keyboard event -> lastInputType = "keyboardMouse"
Mouse/trackpad pointer event -> lastInputType = "keyboardMouse"
Touch pointer event -> lastInputType = "touch"
Gamepad event -> lastInputType = "gamepad"
```

Do **not** permanently switch to mobile UI just because the device has touch.

A Chromebook may have:

- keyboard
- trackpad
- touchscreen

The UI should adapt to the input the player is actually using.

Example:

- If the student uses WASD and trackpad, show keyboard/trackpad prompts.
- If the student taps the screen, show touch prompts.
- If the student goes back to keyboard, show keyboard/trackpad prompts again.

---

# Control Scheme to Implement

## 3D Walk Mode — Desktop / Chromebook Keyboard + Trackpad or Mouse

### Movement

```text
W or ArrowUp = move forward
S or ArrowDown = move backward
A or ArrowLeft = strafe left
D or ArrowRight = strafe right
```

### Action / interaction

```text
E = primary interact / pick up / board / stow / repair / scan
Space = secondary interact/action only because the game currently has no jump
Q or G = drop carried item
```

### UI

```text
M = open/close map
I or B = open/close inventory
Esc = close top overlay / pause / settings
C = reset camera behind astronaut
```

### Camera

```text
Trackpad/mouse drag on game area = orbit camera while held
Release pointer = stop orbiting
Two-finger scroll / mouse wheel = optional zoom
```

### Do not require

```text
Right-click
Pointer lock
External mouse
```

---

## 3D Walk Mode — Mobile Safari / Mobile Chrome

```text
Left virtual joystick = movement
Right-side drag on screen = camera orbit/look while finger is down
Release finger = stop camera movement
Main context button = interact / pick up / board / stow / repair / scan
Drop button or carried item slot tap = drop item
Map icon = map
Backpack/cargo icon = inventory
Gear icon = settings
```

Important:

- No jump button for now.
- Do not show jump instructions.
- Support multi-touch:
  - one thumb moves
  - one thumb turns camera
  - action/drop button can still be tapped
- Controls should not scroll the page.
- Buttons should be large enough for student use.
- Primary touch buttons should be at least 44x44 CSS pixels, preferably larger.

---

## 3D Walk Mode — Hybrid Touchscreen Chromebook

Hybrid Chromebook behavior should support both keyboard/trackpad and touch.

Requirements:

- If keyboard or trackpad is used last, show keyboard/trackpad prompts.
- If touchscreen is used last, show touch prompts.
- Do not permanently switch to mobile controls just because the device has touch.
- Allow keyboard movement and touch UI buttons to coexist when possible.
- Do not require right-click.
- Trackpad drag should orbit only while held.

---

## 2D Lunar Lander Mode — Desktop / Chromebook

```text
A or ArrowLeft = rotate left
D or ArrowRight = rotate right
W or ArrowUp or Space = thrust
M = map
I or B = inventory
E = exit / board / interact only after landing, if applicable
Esc = close overlay / pause / settings
R = restart after crash or mission end, if applicable
```

Important:

- In 2D lander mode, **Space is thrust**, not interact.
- Arrow keys must work.
- Space and arrow keys must not scroll the page while the game has focus.

---

## 2D Lunar Lander Mode — Mobile

```text
Bottom-left button = rotate left
Bottom-center button = thrust
Bottom-right button = rotate right
Top-left map icon = map
Top-right inventory/settings icons = inventory/settings
Context button after safe landing = exit lander / begin moon walk
```

Requirements:

- Buttons must support hold behavior with `pointerdown` / `pointerup`.
- Must support simultaneous thrust + rotate.
- Use `pointercancel` and `lostpointercapture` cleanup.
- Do not rely on click events for hold controls.

---

## 2D Walk / Platform Mode, If Present Later

Only apply this if there is a 2D walking/platform mode now or later.

### Desktop / Chromebook

```text
A or ArrowLeft = move left
D or ArrowRight = move right
W or ArrowUp = climb / up action if needed
S or ArrowDown = crouch / climb down if applicable
E = interact / pick up
Space = secondary action only if there is no jump
Q or G = drop
M = map
I or B = inventory
Esc = close overlay / pause / settings
```

If jump is added later:

```text
Space = jump
E = interact
```

### Mobile

```text
Left/right buttons or joystick = move
Main context button = interact / pick up
Drop button or item-slot tap = drop
Map icon = map
Inventory icon = inventory
```

Do not show jump controls unless jump exists.

---

# Camera Behavior Requirements

## Default camera

Default camera should be:

```text
Third-person chase/orbit camera
```

It should feel closer to Roblox-style third-person movement than a first-person mouse-look shooter.

Requirements:

- Camera follows the astronaut.
- Camera can orbit around the astronaut.
- Movement should be relative to camera direction.
- Character should face movement direction or smoothly turn toward it.
- Camera should not trap the cursor/pointer.
- Camera should not require pointer lock.
- Trackpad should feel good.
- Mobile right-side drag should feel good.

## Camera drag/orbit

Default orbit rules:

```text
pointerdown + drag = orbit
pointermove while active = update orbit
pointerup = stop orbit
pointercancel = stop orbit
lostpointercapture = stop orbit
```

Do not make normal orbit continue after pointer release.

## Camera reset

Add:

```text
C = reset camera behind astronaut
```

For touch, add a small camera-reset icon if it fits without clutter.

## Optional mouse-look / pointer lock

Pointer lock may be retained only as optional.

If retained:

- Add setting: `Mouse-look mode`
- Default: OFF
- Prompt: `Click to enter mouse-look. Press Esc to exit.`
- Do not auto-enter pointer lock from ordinary drag/click orbit.
- If pointer lock is active, Esc naturally exits pointer lock.
- When pointer lock exits, restore normal drag-orbit behavior.

---

# Interaction Prompt System

Create or improve a context-sensitive prompt system near interactable objects.

The prompt should be based on:

- current game mode
- nearby object
- carried item
- last input type
- whether the action is valid right now

Do not show invalid actions.

## Keyboard / trackpad prompts

Use these patterns:

```text
E / Space Pick up fuel
E / Space Collect sample
E / Space Pick up kit
E / Space Repair probe
E / Space Board lander
E / Space Stow [item]
Q/G Drop [item]
```

## Touch prompts

Use short button text:

```text
PICK UP
COLLECT
REPAIR
BOARD
STOW
DROP
SCAN
HEAL
```

## Prompt priority

When multiple actions are possible, use this priority:

1. If carrying an item and near lander:
   ```text
   E / Space Stow [item]
   ```
   Touch:
   ```text
   STOW
   ```

2. If near lander and not carrying item:
   ```text
   E / Space Board lander
   ```
   Touch:
   ```text
   BOARD
   ```

3. If near damaged probe and has repair kit:
   ```text
   E / Space Repair probe
   ```
   Touch:
   ```text
   REPAIR
   ```

4. If near collectible:
   ```text
   E / Space Pick up [item]
   ```
   Touch:
   ```text
   PICK UP
   ```

5. If carrying item away from lander:
   ```text
   Q/G Drop [item]
   ```
   Touch:
   ```text
   DROP
   ```

---

# UI Prompt Text to Update Everywhere

Audit and update all on-screen instructions anywhere they appear in:

- source code
- HTML
- HUD
- tutorial cards
- loading screen
- settings/help panels
- overlays
- pause screens
- mode-specific prompt text
- mobile touch UI labels
- map/inventory instructions

Prompt text must match the actual controls.

## Replace any current text that says:

```text
Space = Jump
Jump button
W / ↑ / Space = Jump
click lock mouse look
mouse turn astronaut + pitch camera
```

with mode-appropriate text below.

---

## 3D Walk — Keyboard / Trackpad Prompt Text

Use:

```text
WASD / Arrow Keys: Move
Drag trackpad/mouse: Look around
E or Space: Interact / Pick up / Board
Q or G: Drop
M: Map
I or B: Inventory
C: Reset camera
Esc: Pause / Settings
```

Optional if pointer-lock mode exists:

```text
Optional mouse-look mode: Click to lock pointer. Press Esc to exit.
```

Do not present pointer-lock as the default way to play.

---

## 3D Walk — Touch Prompt Text

Use:

```text
Left joystick: Move
Drag right side: Look around
Action: Interact / Pick up / Board
Drop: Drop carried item
Map: Open satellite view
Backpack: Inventory
Gear: Settings
```

No jump text unless jump exists.

---

## 2D Lander — Keyboard / Trackpad Prompt Text

Use:

```text
A / ←: Rotate left
D / →: Rotate right
W / ↑ / Space: Thrust
M: Map
I or B: Inventory
E: Exit / board after landing
Esc: Pause / Settings
Land softly: low speed + upright angle + flat pad
```

---

## 2D Lander — Touch Prompt Text

Use:

```text
◀ Rotate
▲ Thrust
▶ Rotate
Hold buttons for continuous control
```

---

# Touch UI Requirements

Primary touch controls should be large, spaced, and hard to mis-tap.

Recommended layout:

```text
Top left:
- Map

Top right:
- Inventory / backpack
- Gear / settings

Bottom left:
- Virtual joystick

Bottom right:
- Main action button
- Drop button
- Optional camera reset
```

Important:

- No jump button for now.
- Make hit areas larger than icons if needed.
- Support simultaneous touches for movement + camera + action.
- Use pointer capture for virtual joystick/buttons where appropriate.
- Always release pointer capture correctly on:
  - pointerup
  - pointercancel
  - lostpointercapture
- Avoid tiny buttons.
- Avoid controls placed too close to browser navigation areas on mobile Safari.
- Use safe-area padding where needed.

Suggested CSS:

```css
.touch-controls {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.touch-button {
  min-width: 56px;
  min-height: 56px;
}
```

---

# Browser Behavior Requirements

When the game is focused, prevent default browser scrolling for:

```text
Space
ArrowUp
ArrowDown
ArrowLeft
ArrowRight
W
A
S
D
```

Do not prevent default when the event target is:

```text
input
textarea
select
button when appropriate
[contenteditable="true"]
math answer field
settings slider
form field
```

On mobile:

- prevent browser page movement over the game canvas and controls
- do not break normal overlay/form input
- make sure sliders and buttons in settings still work

Esc behavior priority:

1. If pointer lock is active, browser may release pointer lock.
2. If map/inventory/settings/tutorial/modal is open, close the topmost overlay.
3. Otherwise open pause/settings.

---

# Code Quality Requirements

- Keep existing gameplay intact.
- Avoid a giant rewrite unless necessary.
- Add comments explaining the input abstraction and device-switching logic.
- Keep mode-specific mappings clear.
- Use constants/config objects for key bindings and prompt strings.
- Avoid duplicate prompt text scattered across many files if practical.
- Create a central controls/help registry if possible.
- Do not hard-code prompt text separately in multiple places if it can be centralized.

Suggested files/modules:

```text
InputManager.js
ControlBindings.js
DeviceInput.js
LastInputType.js
TouchControls.js
PromptManager.js
ControlPrompts.js
```

If existing files already serve these purposes, refactor them rather than creating unnecessary duplicates.

---

# Suggested Binding Constants

Create something like this:

```js
export const ACTIONS = {
  WALK_FORWARD: ["KeyW", "ArrowUp"],
  WALK_BACKWARD: ["KeyS", "ArrowDown"],
  WALK_LEFT: ["KeyA", "ArrowLeft"],
  WALK_RIGHT: ["KeyD", "ArrowRight"],

  ACTION_PRIMARY: ["KeyE"],
  ACTION_SECONDARY: ["Space"], // allowed because no jump currently exists

  DROP: ["KeyQ", "KeyG"],
  MAP: ["KeyM"],
  INVENTORY: ["KeyI", "KeyB"],
  PAUSE: ["Escape"],
  RESET_CAMERA: ["KeyC"],

  LANDER_THRUST: ["KeyW", "ArrowUp", "Space"],
  LANDER_ROTATE_LEFT: ["KeyA", "ArrowLeft"],
  LANDER_ROTATE_RIGHT: ["KeyD", "ArrowRight"],
};
```

Add this comment near `ACTION_SECONDARY`:

```js
// Space is currently allowed as secondary interact because the game has no jump.
// If jump is added later, Space should become jump and E should remain interact.
```

---

# Testing Checklist

## Desktop with mouse

- WASD movement works.
- Arrow-key movement works.
- E interacts.
- Space also interacts in 3D walk mode because no jump exists.
- Q/G drops.
- M opens/closes map.
- I/B opens/closes inventory.
- C resets camera.
- Drag orbit stops immediately on mouseup.
- Mouse wheel zoom works if implemented.
- Esc closes overlays/pause appropriately.
- Pointer does not get trapped unless optional mouse-look mode is explicitly enabled.

## Chromebook with trackpad

- WASD movement works.
- Arrow-key movement works.
- Trackpad drag orbits camera only while held.
- Releasing the trackpad stops orbit.
- Two-finger scroll zooms if implemented.
- No right-click is required.
- Student can play without an external mouse.
- Prompts say `trackpad/mouse drag`, not only `mouse`.

## Touchscreen Chromebook

- Touch controls appear or become usable when touch is used.
- Keyboard controls still work when keyboard is used.
- Prompts switch based on last input type.
- Touch input does not permanently force mobile UI when keyboard/trackpad is used afterward.

## Mobile Safari / Chrome

- Joystick moves player.
- Right-side drag turns/orbits camera.
- Action button works.
- Drop button works.
- Touch controls do not scroll the page.
- Multi-touch works:
  - move + look
  - move + action
  - move + drop
- Buttons are large enough and not crowded.
- Map/inventory/settings are reachable.
- No jump button is shown.

## 2D Lander

- A/D rotate.
- Left/right arrows rotate.
- W/Up/Space thrust.
- Mobile ◀ ▲ ▶ buttons support hold.
- Mobile supports simultaneous thrust + rotate.
- Instructions match actual controls.
- Space does not interact in lander mode; it thrusts.

## UI Text Audit

- No UI text mentions jump unless an actual jump mechanic exists.
- No UI text says click-lock mouse-look as the default.
- All prompt text reflects the current mode and last input type.
- Loading screen, tutorial cards, help/settings, HUD, and overlays all agree.

---

# Final Deliverable

After implementing, report:

1. Files changed.
2. What input bugs were fixed.
3. Current control mapping by mode and device.
4. Any UI text changed.
5. Any remaining limitations.
6. How to test on:
   - desktop with mouse
   - Chromebook with trackpad
   - touchscreen Chromebook
   - mobile Safari
   - mobile Chrome

---

# Developer Reference Notes

These are not gameplay requirements, but they explain the design direction:

- Pointer Events are preferred because they support mouse, pen, and touch with one event model.
- `pointerType` can identify mouse, pen, and touch input.
- Pointer Lock is useful for first-person mouse-look, but should not be the default for third-person orbit because it can feel like the pointer is trapped.
- CSS `touch-action: none` should be used carefully on the game canvas and control surfaces to stop browser gestures from stealing game input.
- Chromebook trackpads support pointer movement, click/tap, two-finger right-click, and two-finger scroll, but the game should not require right-click for core actions.
