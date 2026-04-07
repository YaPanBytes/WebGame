// A simple object to track our essential game keys
export const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  space: false,
  shift: false,
  f: false       // Fire weapon
};

// ... keep your existing event listeners below ...

// When a key is pressed down, set its value to true
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (keys.hasOwnProperty(key)) {
    keys[key] = true;
  }
  if (e.code === 'Space') keys.space = true;
  if (e.shiftKey) keys.shift = true;
  if (e.code === 'KeyF') keys.f = true;
});

// When the key is released, set its value back to false
window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (keys.hasOwnProperty(key)) {
    keys[key] = false;
  }
  if (e.code === 'Space') keys.space = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
  if (e.code === 'KeyF') keys.f = false;
});