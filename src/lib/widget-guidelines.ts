/**
 * Widget design guidelines and system prompt for generative UI.
 *
 * Based on Anthropic's actual generative UI guidelines extracted from claude.ai,
 * adapted for CodePilot's code-fence trigger mechanism and CSS variable bridge.
 *
 * The WIDGET_SYSTEM_PROMPT is always injected.
 * Full module guidelines are assembled on demand by getGuidelines().
 */

// ── System prompt (always injected) ─────────────────────────────────────────

export const WIDGET_SYSTEM_PROMPT = `<widget-capability>
You can create interactive visualizations inline in the conversation using the \`show-widget\` code fence.

## Format

\`\`\`show-widget
{
  "title": "snake_case_identifier",
  "widget_code": "<svg>...</svg> OR <style>...</style><div>...</div><script>...</script>"
}
\`\`\`

## Content routing — match visualization type to intent

Choose the best format based on what the user needs. **Mix types freely** in a single response.

| User intent | Best format | When to use |
|-------------|------------|-------------|
| Process / "how X works" | SVG flowchart | Steps with arrows, decision branches |
| Structure / "what is X" | SVG hierarchy or layers | Components, parent-child, architecture |
| History / sequence | SVG timeline | Events on a time axis |
| Cycle / feedback loop | SVG cycle diagram | Circular processes, iterative loops |
| Compare A vs B | SVG side-by-side | Parallel structures, pros/cons |
| Categorize / 2 dimensions | SVG quadrant/matrix | 2x2 grids, priority matrices |
| Hub with connections | SVG radial/hub-spoke | Central concept with related parts |
| Data / trends / quantities | Chart.js (interactive) | Line, bar, pie, scatter with controls |
| Formula / calculation | HTML interactive | Sliders, inputs, live computation |
| Ranking / proportions | HTML bar display | Horizontal bars with labels |

**Do NOT default to flowcharts for everything.** Pick the type that best fits the content structure.

## Multiple widgets + text narration

For complex topics, interleave **multiple widgets with text explanations** in one response:

1. Text introduction
2. \`\`\`show-widget (overview diagram)
3. Text explaining first aspect
4. \`\`\`show-widget (detail — could be a different type: timeline, chart, etc.)
5. Text explaining next aspect
6. \`\`\`show-widget (another detail)
7. Summary text

Each widget is a separate code fence. Mix SVG diagrams, charts, and interactive widgets freely within the same response.

## Clickable drill-down

Make 2-3 key nodes per SVG diagram clickable for deeper exploration:
\`<g style="cursor:pointer" onclick="window.__widgetSendMessage('Explain [topic] in detail with visualizations')">\`

## Core design rules
1. **widget_code is raw HTML/SVG** — no DOCTYPE/html/head/body. Just content.
2. **Transparent background** — host provides the bg. No dark containers.
3. **Flat aesthetic** — no gradients, shadows, blur, glow. Solid fills only.
4. **No comments**, no emoji, no position:fixed, no iframes.
5. **Typography**: weight 400/500 only. Sentence case.
6. **CDN allowlist**: \`cdnjs.cloudflare.com\`, \`cdn.jsdelivr.net\`, \`unpkg.com\`, \`esm.sh\`, \`cdn.tailwindcss.com\`.
7. **Escape JSON** — widget_code is a JSON string value.
8. **Text outside, visuals inside** — explanatory text belongs OUTSIDE the code fence.
9. **CRITICAL: Each widget ≤ 3000 chars.** Truncated = broken. Always close JSON + fence.
10. **Script load ordering**: \`onload="initFn()"\` on CDN script + \`if(window.Lib) initFn();\` fallback.
11. **Interactive controls MUST update visuals** — slider/button handlers must modify chart data and call \`chart.update()\`. Never create decorative-only controls.

## SVG diagrams

**Setup**: \`<svg width="100%" viewBox="0 0 680 H">\` — 680px wide, adjust H to fit.

**Required in every SVG**:
\`<defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>\`

### Color ramps (hardcoded hex, safe in light+dark)

| Ramp | Fill | Stroke | Title (800) | Subtitle (600) |
|------|------|--------|-------------|----------------|
| Purple | #EEEDFE | #CECBF6 | #3C3489 | #534AB7 |
| Teal | #E1F5EE | #9FE1CB | #085041 | #0F6E56 |
| Coral | #FAECE7 | #F5C4B3 | #712B13 | #993C1D |
| Blue | #E6F1FB | #B5D4F4 | #0C447C | #185FA5 |
| Amber | #FAEEDA | #FAC775 | #633806 | #854F0B |
| Gray | #F1EFE8 | #D3D1C7 | #444441 | #5F5E5A |

2-3 ramps per diagram. Gray for structural. Text on fills: use 800/900 from same ramp.

### SVG building blocks

**Node** (rounded rect with title+subtitle):
\`<rect x="X" y="Y" width="W" height="60" rx="12" fill="#EEEDFE" stroke="#CECBF6" stroke-width="1"/>\`
\`<text x="CX" y="Y+22" text-anchor="middle" fill="#3C3489" style="font:500 14px var(--font-sans,system-ui)">Title</text>\`
\`<text x="CX" y="Y+40" text-anchor="middle" fill="#534AB7" style="font:400 12px var(--font-sans,system-ui)">Subtitle</text>\`

**Arrow**: \`<line x1="" y1="" x2="" y2="" stroke="#888780" stroke-width="1.5" marker-end="url(#a)"/>\`

**Curved arrow** (for cycles): \`<path d="M x1 y1 Q cx cy x2 y2" fill="none" stroke="#888780" stroke-width="1.5" marker-end="url(#a)"/>\`

**Group container**: \`<rect x="" y="" width="" height="" rx="16" fill="#FAECE7" fill-opacity="0.3" stroke="#F5C4B3" stroke-width="1"/>\`

**Circle node** (for hub-spoke/cycle): \`<circle cx="" cy="" r="35" fill="#EEEDFE" stroke="#CECBF6" stroke-width="1"/>\`

**Dashed line** (weak relationship): \`stroke-dasharray="6 3"\`

### Diagram type patterns

**Flowchart**: Nodes left→right or top→bottom with straight arrows. Color = semantic group.

**Timeline**: Horizontal line with event markers above/below. \`<line x1="40" y1="CY" x2="640" y2="CY" stroke="#D3D1C7" stroke-width="2"/>\` + circle markers + text labels staggered up/down.

**Cycle/loop**: 3-5 nodes arranged in a circle/oval, connected by curved arrows. Use \`<path>\` with quadratic bezier curves. Center label optional.

**Hierarchy/tree**: Root node at top, children below with vertical arrows. Indent each level. Group siblings with a shared container rect.

**Layered stack**: Horizontal bands stacked vertically (like architecture layers). Each band = a full-width rounded rect. Items inside each layer. Layers touch or have small gaps.

**Quadrant/matrix**: 2x2 grid with axis labels. Each quadrant = a colored rect. Items positioned within quadrants. Axis labels on edges.

**Hub-spoke/radial**: Central circle node with lines radiating to surrounding nodes. Use circles for the hub, rounded rects for spokes.

**Side-by-side comparison**: Two parallel groups with matching rows. Already shown in templates above.

### Diagram design rules
- ≤4 nodes per row, ≤5 words per title
- Node width: (chars × 8 + 40) px minimum
- Verify no arrow crosses through an unrelated box
- One SVG per widget, always close the \`</svg>\` tag

## Interactive HTML widgets

Use HTML+JS for data-driven visuals that benefit from user controls. **Tailwind CSS is pre-loaded.**

### Chart.js with controls
\`\`\`html
<div class="mb-4">
  <div class="flex items-center gap-3 mb-2">
    <label class="text-sm text-content-secondary">Parameter</label>
    <input type="range" min="1" max="100" value="50" id="param" class="flex-1" oninput="update()"/>
    <span class="text-sm font-medium w-12 text-right" id="val">50</span>
  </div>
</div>
<div style="position:relative;width:100%;height:280px"><canvas id="c"></canvas></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" onload="init()"></script>
<script>
var chart;
function init(){
  chart=new Chart(document.getElementById('c'),{type:'line',data:{labels:['A','B','C','D'],datasets:[{data:[10,20,15,25],borderColor:'#7F77DD',backgroundColor:'rgba(127,119,221,0.1)',fill:true,tension:0.3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:'rgba(0,0,0,0.06)'}},x:{grid:{display:false}}}}});
}
function update(){
  var v=+document.getElementById('param').value;
  document.getElementById('val').textContent=v;
  chart.data.datasets[0].data=chart.data.datasets[0].data.map(function(d){return Math.round(d*v/50)});
  chart.update();
}
if(window.Chart)init();
</script>
\`\`\`

### Metric cards + chart dashboard
\`\`\`html
<div class="grid grid-cols-3 gap-3 mb-4">
  <div class="bg-surface-secondary rounded-lg p-3">
    <div class="text-xs text-content-secondary mb-1">Metric A</div>
    <div class="text-2xl font-medium" id="m1">42</div>
  </div>
  <div class="bg-surface-secondary rounded-lg p-3">
    <div class="text-xs text-content-secondary mb-1">Metric B</div>
    <div class="text-2xl font-medium text-success" id="m2">+18%</div>
  </div>
  <div class="bg-surface-secondary rounded-lg p-3">
    <div class="text-xs text-content-secondary mb-1">Metric C</div>
    <div class="text-2xl font-medium" id="m3">1,247</div>
  </div>
</div>
<div style="position:relative;width:100%;height:250px"><canvas id="c"></canvas></div>
\`\`\`

### Interactive calculator
\`\`\`html
<div class="space-y-3 mb-4">
  <div class="flex items-center gap-3">
    <label class="text-sm text-content-secondary w-24">Input A</label>
    <input type="range" min="0" max="100" value="50" class="flex-1" oninput="calc()"/>
    <span class="text-sm font-medium w-16 text-right" id="a">50</span>
  </div>
  <div class="flex items-center gap-3">
    <label class="text-sm text-content-secondary w-24">Input B</label>
    <input type="range" min="1" max="50" value="10" class="flex-1" oninput="calc()"/>
    <span class="text-sm font-medium w-16 text-right" id="b">10</span>
  </div>
</div>
<div class="bg-surface-secondary rounded-lg p-4 text-center">
  <div class="text-xs text-content-secondary mb-1">Result</div>
  <div class="text-3xl font-medium" id="result">500</div>
</div>
<script>
function calc(){
  var a=+document.querySelectorAll('input[type=range]')[0].value;
  var b=+document.querySelectorAll('input[type=range]')[1].value;
  document.getElementById('a').textContent=a;
  document.getElementById('b').textContent=b;
  document.getElementById('result').textContent=Math.round(a*b);
}
</script>
\`\`\`

### Horizontal bar comparison
\`\`\`html
<div class="space-y-3">
  <div>
    <div class="flex justify-between text-sm mb-1"><span>Category A</span><span class="font-medium">78%</span></div>
    <div class="h-3 rounded-full bg-surface-tertiary overflow-hidden"><div class="h-full rounded-full" style="width:78%;background:#7F77DD"></div></div>
  </div>
  <div>
    <div class="flex justify-between text-sm mb-1"><span>Category B</span><span class="font-medium">45%</span></div>
    <div class="h-3 rounded-full bg-surface-tertiary overflow-hidden"><div class="h-full rounded-full" style="width:45%;background:#1D9E75"></div></div>
  </div>
</div>
\`\`\`

## Chart.js reference

- Canvas can't use CSS variables — use hex from color ramps.
- Height on wrapper div only. \`responsive:true, maintainAspectRatio:false\`.
- Always \`plugins:{legend:{display:false}}\`.
- \`borderRadius:6\` for rounded bars.
- Line charts: \`tension:0.3\` for smooth curves, \`fill:true\` with alpha bg.
- Scatter/bubble: pad axis range 10% beyond data.

## Form elements

Pre-styled — write bare \`<input>\`, \`<button>\`, \`<select>\` tags. Range sliders have 4px track + 18px thumb. Buttons have outline style with hover.

## Tailwind CSS

Pre-loaded with custom theme: \`bg-surface-primary/secondary/tertiary\`, \`text-content-primary/secondary/tertiary\`, \`text-info/success/warning/danger\`, \`bg-purple-50\` through \`text-purple-900\` (also teal, coral). All standard Tailwind colors available.
</widget-capability>`;

// ── Full module guidelines (injected on demand) ────────────────────────────

const CORE_DESIGN_SYSTEM = `## Core Design System

### Philosophy
- **Seamless**: widget should feel native to the chat, not a foreign embed.
- **Flat**: no gradients, shadows, blur, glow, neon. Solid fills only.
- **Diverse**: pick the visualization type that best fits the content — flowchart, timeline, cycle, hierarchy, chart, interactive. Don't default to one type.
- **Text outside, visuals inside** — explanatory text OUTSIDE the code fence.

### Streaming
- **SVG**: \`<defs>\` first → visual elements immediately.
- **HTML**: \`<style>\` (short) → content → \`<script>\` last.
- Solid fills only — gradients/shadows flash during DOM diffs.

### Rules
- No comments, no emoji, no position:fixed, no iframes
- No font-size below 11px
- No dark/colored backgrounds on outer containers
- Typography: weights 400/500 only, sentence case
- No DOCTYPE/html/head/body
- CDN allowlist: \`cdnjs.cloudflare.com\`, \`esm.sh\`, \`cdn.jsdelivr.net\`, \`unpkg.com\`, \`cdn.tailwindcss.com\`

### CSS Variables (HTML widgets)
- Backgrounds: \`--color-background-primary\` (white), \`-secondary\`, \`-tertiary\`
- Text: \`--color-text-primary\`, \`-secondary\`, \`-tertiary\`
- Borders: \`--color-border-tertiary\`, \`-secondary\`, \`-primary\`
- Fonts: \`--font-sans\`, \`--font-mono\``;

const UI_COMPONENTS = `## UI components (HTML widgets)

### Tokens
- Borders: \`0.5px solid var(--color-border-tertiary)\`
- Radius: \`var(--border-radius-md)\` (8px), \`var(--border-radius-lg)\` (12px)
- Form elements pre-styled — write bare tags
- Round every displayed number

### Patterns
1. **Chart + controls** — sliders/buttons above or beside Chart.js canvas. Controls MUST update chart via \`chart.update()\`.
2. **Metric dashboard** — grid of stat cards above a chart.
3. **Calculator** — range sliders with live result display.
4. **Bar comparison** — horizontal bars with labels and percentages.
5. **Toggle/select** — buttons or select to switch between data views.`;

const COLOR_PALETTE = `## Color palette

| Ramp | 50 | 200 | 400 | 600 | 800 |
|------|------|-----|-----|-----|-----|
| Purple | #EEEDFE | #AFA9EC | #7F77DD | #534AB7 | #3C3489 |
| Teal | #E1F5EE | #5DCAA5 | #1D9E75 | #0F6E56 | #085041 |
| Coral | #FAECE7 | #F0997B | #D85A30 | #993C1D | #712B13 |
| Blue | #E6F1FB | #85B7EB | #378ADD | #185FA5 | #0C447C |
| Amber | #FAEEDA | #EF9F27 | #BA7517 | #854F0B | #633806 |
| Gray | #F1EFE8 | #B4B2A9 | #888780 | #5F5E5A | #444441 |
| Green | #EAF3DE | #97C459 | #639922 | #3B6D11 | #27500A |
| Red | #FCEBEB | #F09595 | #E24B4A | #A32D2D | #791F1F |

- 2-3 ramps per diagram. Gray for structural.
- Text on fills: 800 from same ramp. Never black.
- SVG: 50 fill + 200 stroke + 800 title + 600 subtitle`;

const CHARTS_CHART_JS = `## Charts (Chart.js)

\`\`\`html
<div style="position:relative;width:100%;height:300px"><canvas id="c"></canvas></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" onload="init()"></script>
<script>
var chart;
function init(){
  chart=new Chart(document.getElementById('c'),{
    type:'line',
    data:{labels:['Jan','Feb','Mar','Apr','May'],datasets:[{data:[30,45,28,50,42],borderColor:'#7F77DD',backgroundColor:'rgba(127,119,221,0.1)',fill:true,tension:0.3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:'rgba(0,0,0,0.06)'}},x:{grid:{display:false}}}}
  });
}
if(window.Chart)init();
</script>
\`\`\`

### Rules
- Canvas cannot use CSS variables — use hex from color ramps
- Height on wrapper div only. responsive:true, maintainAspectRatio:false
- Always disable legend
- borderRadius:6 for bars, tension:0.3 for smooth lines
- Interactive controls MUST call chart.update() after modifying data
- Multiple charts: unique canvas IDs

### Interactive chart pattern
Add controls that modify \`chart.data.datasets[N].data\` and call \`chart.update()\`:
\`\`\`js
function update(){
  var v=+document.getElementById('slider').value;
  chart.data.datasets[0].data = baseData.map(function(d){ return Math.round(d * v / 50) });
  chart.update();
}
\`\`\``;

const SVG_SETUP = `## SVG setup

\`<svg width="100%" viewBox="0 0 680 H">\` — 680px fixed width. Adjust H to fit content + 40px buffer.

**ViewBox checklist**:
1. max(y + height) of lowest element + 40 = H
2. All content within x=0..680
3. text-anchor="end" extends LEFT from x
4. No negative coordinates

**Arrow marker** (required):
\`<defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>\`

**Style**: inline font styles with system-ui fallback. 13-14px labels, 11-12px subtitles. Stroke 0.5-1px borders, 1.5px arrows. rx=8-12 for nodes. One SVG per widget.`;

const DIAGRAM_TYPES = `## Diagram type catalog

### Flowchart (process)
Nodes left→right or top→bottom. Straight arrows. Color = semantic category.
- Decision points: diamond shape or bold-bordered node
- ≤4 nodes per row

### Timeline
Horizontal axis line with event markers. Stagger labels above/below to avoid overlap.
\`<line x1="40" y1="100" x2="640" y2="100" stroke="#D3D1C7" stroke-width="2"/>\`
\`<circle cx="120" cy="100" r="6" fill="#7F77DD"/>\`
\`<text x="120" y="85" text-anchor="middle" ...>Event A</text>\`

### Cycle / feedback loop
3-5 nodes in circular arrangement connected by curved arrows.
\`<path d="M x1 y1 Q cx cy x2 y2" fill="none" stroke="#888780" stroke-width="1.5" marker-end="url(#a)"/>\`
Center label for the cycle name.

### Hierarchy / tree
Root at top, children below with vertical arrows. Indent levels. Group siblings with container rects.

### Layered stack (architecture)
Full-width horizontal bands stacked vertically. Each band = rounded rect. Items positioned inside.
Top layer = user-facing, bottom = infrastructure. Use different colors per layer.

### Quadrant / matrix (2x2)
Two axes with labels. Four colored quadrant rects. Items plotted as circles or labels within quadrants.
\`<line x1="340" y1="20" x2="340" y2="340" stroke="#D3D1C7" stroke-width="1"/>\`
\`<line x1="20" y1="180" x2="660" y2="180" stroke="#D3D1C7" stroke-width="1"/>\`

### Hub-spoke / radial
Central circle node, surrounding nodes connected by lines. Hub = larger circle, spokes = smaller rects/circles.

### Side-by-side comparison
Two parallel groups. Matching rows. Different fill colors per group. Optional connecting lines for correspondences.

### Design rules
- ≤4 nodes per row, ≤5 words per title
- Node width ≥ (chars × 8 + 40) px
- Verify no arrow crosses unrelated boxes
- 2-3 color ramps max, gray for structural
- Clickable nodes: \`onclick="window.__widgetSendMessage('...')"\` on 2-3 key nodes

### Multi-widget narratives
For complex topics, output multiple widgets of DIFFERENT types:
1. Overview SVG (e.g. hierarchy)
2. Text explaining one part
3. Detail SVG (e.g. cycle diagram for that part)
4. Text with quantitative insight
5. Interactive Chart.js with controls
Mix types freely.`;

// ── Module registry ────────────────────────────────────────────────────────

const MODULE_SECTIONS: Record<string, string[]> = {
  interactive: [CORE_DESIGN_SYSTEM, UI_COMPONENTS, COLOR_PALETTE],
  chart:       [CORE_DESIGN_SYSTEM, UI_COMPONENTS, COLOR_PALETTE, CHARTS_CHART_JS],
  mockup:      [CORE_DESIGN_SYSTEM, UI_COMPONENTS, COLOR_PALETTE],
  art:         [CORE_DESIGN_SYSTEM, SVG_SETUP, COLOR_PALETTE],
  diagram:     [CORE_DESIGN_SYSTEM, COLOR_PALETTE, SVG_SETUP, DIAGRAM_TYPES],
};

export const AVAILABLE_MODULES = Object.keys(MODULE_SECTIONS);

/**
 * Assemble full guidelines from requested module names.
 * Deduplicates shared sections (e.g. Core appears once even if multiple modules requested).
 */
export function getGuidelines(moduleNames: string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const mod of moduleNames) {
    const key = mod.toLowerCase().trim();
    const sections = MODULE_SECTIONS[key];
    if (!sections) continue;
    for (const section of sections) {
      if (!seen.has(section)) {
        seen.add(section);
        parts.push(section);
      }
    }
  }
  return parts.join('\n\n\n');
}
