import { GalaxyCache } from "@xwingz/procgen";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app not found");

root.innerHTML = `
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #05060b; color:#e7ecff; }
    #app { padding: 16px; display: grid; grid-template-columns: 320px 1fr; gap: 16px; }
    input { width: 100%; padding: 6px; margin-top: 4px; background:#0f1220; color:#e7ecff; border:1px solid #2a2f4a; border-radius:4px; }
    label { font-size: 12px; opacity: 0.9; display:block; margin-bottom:10px; }
    pre { background:#0b0e1a; padding:12px; border-radius:6px; overflow:auto; max-height:80vh; }
    .panel { background:#0b0e1a; padding:12px; border-radius:6px; }
    h2 { margin: 0 0 8px 0; font-size: 14px; }
  </style>
  <div class="panel">
    <h2>Seed / Coords</h2>
    <label>Global seed (bigint)
      <input id="seed" value="42" />
    </label>
    <label>Sector X
      <input id="sx" value="0" />
    </label>
    <label>Sector Y
      <input id="sy" value="0" />
    </label>
    <label>Sector Z
      <input id="sz" value="0" />
    </label>
    <label>Radius (sectors)
      <input id="rad" value="1" />
    </label>
    <div id="summary" style="font-size:12px;opacity:0.9;"></div>
  </div>
  <pre id="out"></pre>
`;

const seedEl = document.querySelector<HTMLInputElement>("#seed")!;
const sxEl = document.querySelector<HTMLInputElement>("#sx")!;
const syEl = document.querySelector<HTMLInputElement>("#sy")!;
const szEl = document.querySelector<HTMLInputElement>("#sz")!;
const radEl = document.querySelector<HTMLInputElement>("#rad")!;
const outEl = document.querySelector<HTMLPreElement>("#out")!;
const summaryEl = document.querySelector<HTMLDivElement>("#summary")!;

function parseIntSafe(v: string, def = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function refresh() {
  let seed = 42n;
  try {
    seed = BigInt(seedEl.value.trim());
  } catch {
    // keep prior
  }
  const center: [number, number, number] = [
    parseIntSafe(sxEl.value),
    parseIntSafe(syEl.value),
    parseIntSafe(szEl.value)
  ];
  const radius = Math.max(0, parseIntSafe(radEl.value, 1));

  const cache = new GalaxyCache({ globalSeed: seed });
  const sectors = cache.sectorsInRadius(center, radius);
  const systems = sectors.flatMap((sector) =>
    sector.systems.map((_, i) => cache.system(sector.coord, i))
  );

  summaryEl.textContent = `Sectors: ${sectors.length} | Systems: ${systems.length}`;
  outEl.textContent = JSON.stringify(
    {
      globalSeed: seed.toString(),
      centerSector: center,
      radius,
      sectors: sectors.map((s) => ({
        id: s.id,
        coord: s.coord,
        archetypeId: s.archetypeId,
        controllingFaction: s.controllingFaction,
        systemCount: s.systemCount
      })),
      systems: systems.slice(0, 50) // cap for readability
    },
    null,
    2
  );
}

for (const el of [seedEl, sxEl, syEl, szEl, radEl]) {
  el.addEventListener("input", refresh);
}

refresh();

