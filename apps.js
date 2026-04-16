// Add a new game/app by appending an entry below.
// - title    : (used for alt text + fallback if no image)
// - href     : where the card links (internal path like "/moon-landing/" or external URL)
// - image    : path to a card image (recommended aspect ratio 285:107, e.g. an SVG)
// - bg       : (fallback) any CSS background if no image is supplied
// - sub      : optional small caption shown only on text cards
// - external : true if href is on another domain (adds an EXTERNAL badge + target=_blank)
window.COOL_STEM_APPS = [
  {
    title: "Moon Landing — Artemis II Mission Tracker",
    href: "https://moonlanding.site/",
    image: "/link-images/moon-landing.svg",
    bg: "radial-gradient(circle at 40% 40%, #1c2541 0%, #060a1c 70%)",
    external: true,
  },
  {
    title: "Collatz Cascade",
    sub: "Explore the 3n+1 conjecture",
    href: "/collatz-cascade/",
    bg: "radial-gradient(circle at 50% 40%, #1a3a5c 0%, #0a0f1e 80%)",
  },
  {
    title: "Fibonacci Zoom",
    sub: "Spiral through 1, 1, 2, 3, 5, 8…",
    href: "/fibonacci-zoom/",
    image: "/fibonacci-zoom/assets/images/FibonacciZoomLogo.png",
    bg: "radial-gradient(circle at 50% 50%, #3b1e0d 0%, #0a0f1e 80%)",
  },
];
