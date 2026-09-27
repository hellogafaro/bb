Give any thread eyes and hands on a real machine: the one its environment
runs on, or any other enrolled machine by host ID.

## What you get

- A structured **target table** for the active window — indexed elements with
  role, name, value, and bounds — instead of screenshots and guessed
  coordinates.
- A fast **observe → act → observe** loop for clicking, typing, scrolling, and
  keyboard shortcuts, with automatic staleness checks so a delayed action
  never lands on the wrong element.
- **Screenshots and recordings** written straight into the thread's own
  storage, ready to preview or attach.
- A **Computer** tab in the thread side panel with a live view, and an inline
  preview card in chat — both with a "Take control" button that pauses
  automation so a person can type directly.
- An optional **goal-driven run**: hand over a goal and let a typed-choice
  decision loop (TypeSafe System One) drive the loop itself, escalating back
  to the agent on low confidence, a blocker, or no progress.

## How it works

The plugin supervises one Cua Driver daemon per machine, started on first use
against that machine's real display and accessibility bus. Every observation
is a snapshot of live AT-SPI elements, never a screenshot region; every action
re-checks that its element is still present before dispatching. A live view
polls the desktop at a few frames per second only while someone is watching
it, so a person's presence never adds latency to the agent's own loop.

## For agents

The bundled skill explains the fast loop, when to escalate, and how evidence
lands in thread storage. Goal-driven runs without a configured TypeSafe key
fall back to agent-driven mode automatically and say so.
