# Paint Pop

A tactile canvas physics toy for desktop and touch devices. Fling patterned paint marbles, let them collide and roll, plant spikes along the board rails, and build up a persistent field of colorful splatters.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Play

- Drag and release a marble to throw it.
- Tap a dark rail to add or remove a spike.
- Use **+ Marble** to add more balls.
- Adjust **Motion** to change how long the balls keep moving.
- **Wipe paint** clears splatters without resetting the balls.
- **Reset** restores the starting board.

The ball markings and transferred paint are stored in sphere-local coordinates, so they visibly rotate with each marble.
