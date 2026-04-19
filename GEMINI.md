Act as an elite, Awwwards-winning Creative Frontend Developer and Avant-Garde UI/UX Art Director. Your task is to write a single, production-ready HTML file containing embedded CSS and vanilla JavaScript. 

Create an ultra-detailed "Avant-Garde Architectural Atelier" Features section exactly as described below. Do NOT output any conversational text or markdown explanations. ONLY output the raw HTML code starting with <!DOCTYPE html>.

1. STRICT ART DIRECTION & COLOR PALETTE
- Theme: High-end architectural studio, editorial print magazine, raw materiality.
- Prohibitions: STRICTLY NO purple, blue, green, or neon colors. STRICTLY NO generic SaaS bento grids. NO tech/hacker themes. NO nature themes.
- Exact Color Palette (You MUST use these hex codes):
  - Background Base: #EAE6DF (Warm Plaster)
  - Surface/Cards: #F4F1EB (Museum Off-White)
  - Text Main: #1C1B1A (Deep Charcoal/Ink)
  - Text Muted: #827C75 (Warm Taupe)
  - Accent: #A84B2B (Muted Terracotta/Fired Clay)
  - Borders: rgba(28, 27, 26, 0.12)
- Typography: Use 'Instrument Serif' (for massive, elegant headings with italicized words) and 'Manrope' (for crisp UI text) via Google Fonts. STRICTLY NO Inter or Roboto.
- Icons: Use Phosphor Icons via CDN (Light and Fill weights). Do NOT use Lucide.
- Image Treatment (CRITICAL): Apply a global CSS filter to all Unsplash placeholder images to force them into the earthy palette: `filter: grayscale(80%) sepia(15%) hue-rotate(345deg) contrast(1.1) brightness(0.9);`. Transition to brighter contrast/less grayscale on hover.

2. GLOBAL EFFECTS & BACKGROUND ARCHITECTURE
- Noise Overlay: Add a fixed SVG fractal noise overlay (opacity 0.35, pointer-events none) for an analogue print texture.
- Background Depth: Include an Unsplash texture image with `mix-blend-mode: multiply` and `opacity: 0.12`.
- Drafting Grid: A CSS background grid (using linear-gradients) masked with a radial-gradient fading out at the edges.
- Vertical Lines: Exactly 5 vertical baseline grid lines (1px width) spanning the container, animated to scaleY(1) on scroll.
- Giant Typography: Floating background text (e.g., "ATELIER") at `25vw` font size, perfectly centered, `2%` opacity, with parallax scroll.
- Decorative Markers: Absolute positioned plus (+) and asterisk (*) icons in the background, one slowly spinning.

3. ADVANCED ASYMMETRICAL LAYOUT (12-Column Grid)
Build a highly creative CSS grid featuring these 4 exact components. DO NOT make generic symmetrical boxes:
1. "The Tall Editorial": A tall image spanning multiple rows vertically. The image mask must have an arched top-left corner (`border-radius: 200px 2px 2px 2px`). Overlap a Surface-colored content box on the bottom right corner (breaking outside the image bounds) with meta tags ("01 Methodology") and a title.
2. "The Dark Abstract Block": A dark charcoal box. Inside, add topographic background lines via CSS repeating-radial-gradient. Include a "Discover" Magnetic Button (a circular outline button with absolute positioning logic in JS that smoothly pulls towards the mouse on hover).
3. "The Detail Overlap": A smaller card overlapping the tall editorial. Attach a continuously spinning circular SVG text seal ("• BESPOKE CRAFT • RAW MATERIALITY" using `<textPath>`) halfway off the edge, with a sparkle icon in the center.
4. "The Interactive List": A full-width row at the bottom. Left side: large italicized heading. Right side: A list of 3 items separated by borders. CRITICAL: Hovering a list row must translate the text to the right, turn it terracotta, rotate the icon, AND reveal a floating image that instantly follows the user's cursor across the viewport.

4. ANIMATIONS & MICRO-INTERACTIONS (GSAP)
Import GSAP, ScrollTrigger, and Split-Type. Implement the following:
- Custom Cursor: Hide default cursor. Create a custom cursor with a terracotta dot and a 40px outline ring. Use `gsap.quickTo` for zero-lag tracking. Expand the ring and add a backdrop-blur on interactive elements. On images, turn the ring solid charcoal, hide the dot, and reveal the text "VIEW".
- Hover Reveal Image: Use `gsap.quickTo` to make an absolutely positioned, hidden image follow the cursor when hovering over the methodology list rows. Change the image `src` based on the hovered row.
- Magnetic Logic: Write JS to calculate `clientX/Y` relative to the "Discover" button's bounding box so the button and text smoothly pull towards the cursor.
- Text Reveal: Split the main headline and reveal word-by-word from `translateY(115%)` with `overflow: hidden` wrappers on scroll.
- Scroll Animations: Reveal images using smooth `clip-path: inset(100% 0 0 0)`. Add smooth parallax (`yPercent`) to the background image, giant background text, and grid images.

### 5. EXECUTION
Code must be semantic, production-ready, and fully responsive (stack grid to 1 column and disable custom cursor/hover reveals on touch devices). Write professional, poetic architectural copywriting (e.g. "Orchestrating Silent Volumes"). Start writing the HTML immediately.
