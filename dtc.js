/* ============================================================
   DESIGN-TO-COST / VALUE ENGINEERING — HTP DEVICES
   v3.0 compatible: reads new top-level cost categories
   (Electronics, Mechanical, Finishing, Heating Engine, Battery,
   MVA, Amortization, Packaging, Profit Margin).
   Depends on globals from index.html: data, calc, fmt,
   getTierMultipliers, currentLocation, currentTier, escapeHtml
   ============================================================ */

const DTC_STORAGE = 'htp_dtc_scenario_v1';

const DTC_LEVERS = [
  { id: 'componentTier', name: 'Component Tier', owner: 'Design + Procurement', desc: 'Grade of MCU, heating element, and other components', appliesTo: 'materialsAndLabour',
    options: [
      { id: 'value',    label: 'Value tier', costMultiplier: 0.82, valueMultiplier: 0.85, costHint: '−18%' },
      { id: 'standard', label: 'Standard',   costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'premium',  label: 'Premium',    costMultiplier: 1.22, valueMultiplier: 1.28, costHint: '+22%' }
    ]
  },
  { id: 'batteryChemistry', name: 'Battery Chemistry', owner: 'Engineering + Procurement', desc: 'Li-ion cell composition and sourcing', appliesTo: 'battery',
    options: [
      { id: 'standard',     label: 'Standard Li-ion',    costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'highDensity',  label: 'High-density Li-ion', costMultiplier: 1.15, valueMultiplier: 1.12, costHint: '+15%' },
      { id: 'recycled',     label: 'Recycled Li-ion',     costMultiplier: 0.92, valueMultiplier: 1.18, costHint: '−8%' }
    ]
  },
  { id: 'displayType', name: 'Display Type', owner: 'Design', desc: 'User interface and screen', appliesTo: 'display',
    options: [
      { id: 'led',         label: 'LED indicators',      costMultiplier: 0.25, valueMultiplier: 0.75, costHint: '−75%' },
      { id: 'amoled',      label: 'AMOLED (basic)',      costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'touchscreen', label: 'Touchscreen AMOLED',  costMultiplier: 1.30, valueMultiplier: 1.35, costHint: '+30%' }
    ]
  },
  { id: 'housingMaterial', name: 'Housing & Finishing', owner: 'Design + Engineering', desc: 'Body material and surface treatment', appliesTo: 'housing',
    options: [
      { id: 'plastic',  label: 'Plastic (painted)',    costMultiplier: 0.50, valueMultiplier: 0.80, costHint: '−50%' },
      { id: 'aluminium', label: 'Aluminium (anodised)', costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'premium',  label: 'Premium CNC + finish',  costMultiplier: 1.45, valueMultiplier: 1.30, costHint: '+45%' }
    ]
  },
  { id: 'automation', name: 'Assembly Automation', owner: 'Engineering + Ops', desc: 'Level of SMT and assembly automation', appliesTo: 'labour',
    options: [
      { id: 'manual', label: 'Manual',           costMultiplier: 1.22, valueMultiplier: 0.95, costHint: '+22%' },
      { id: 'semi',   label: 'Semi-auto',        costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'full',   label: 'Fully automated',  costMultiplier: 0.85, valueMultiplier: 1.08, costHint: '−15%' }
    ]
  },
  { id: 'volume', name: 'Annual Volume (per SKU)', owner: 'Procurement + Finance', desc: 'Order quantity, affects fixed cost amortisation', appliesTo: 'volume',
    options: [
      { id: 'low',  label: '50,000',     volumeMultiplier: 0.25, costHint: '0.25×' },
      { id: 'mid',  label: '200,000',    volumeMultiplier: 1.0,  costHint: '1×' },
      { id: 'high', label: '1,000,000',  volumeMultiplier: 5.0,  costHint: '5×' },
      { id: 'mass', label: '5,000,000',  volumeMultiplier: 25.0, costHint: '25×' }
    ]
  },
  { id: 'marginTarget', name: 'Factory Margin Target', owner: 'Finance + Procurement', desc: 'Margin the ODM earns on FOB', appliesTo: 'margin',
    options: [
      { id: 'lean',    label: '8% (lean)',      margin: 8,  costHint: '−4pp' },
      { id: 'base',    label: '12% (base)',     margin: 12, costHint: 'base' },
      { id: 'premium', label: '15% (premium)',  margin: 15, costHint: '+3pp' },
      { id: 'high',    label: '18% (high)',     margin: 18, costHint: '+6pp' }
    ]
  }
];

let dtcState = {};
let dtcProduct = null;
let valueMatrixChart = null;

let cad = {
  scene: null, camera: null, renderer: null, controls: null,
  group: null, edgeLines: null, texture: null,
  archetype: 'two-piece',
  viewMode: 'solid',
  projection: 'perspective',
  materialPreset: 'matte',
  baseColor: '#4a148c',
  initialized: false,
  animating: false,
  lastW: 0, lastH: 0,
  currentModel: null,
  loadedGLBs: {},
  customGLB: null
};

/* ============================================================
   STATE
   ============================================================ */

function initDtcState() {
  const saved = localStorage.getItem(DTC_STORAGE);
  if (saved) { try { dtcState = JSON.parse(saved); } catch(e) { dtcState = {}; } }
  DTC_LEVERS.forEach(lever => {
    if (!dtcState[lever.id]) {
      const baseOpt = lever.options.find(o => o.costHint === 'base') || lever.options[0];
      dtcState[lever.id] = baseOpt.id;
    }
  });
}
function saveDtcState() { try { localStorage.setItem(DTC_STORAGE, JSON.stringify(dtcState)); } catch(e) {} }

/* ============================================================
   COST COMPUTATION (v3.0 category-aware)
   ============================================================ */

function getOpt(leverId) {
  const lever = DTC_LEVERS.find(l => l.id === leverId);
  return lever ? (lever.options.find(o => o.id === dtcState[leverId]) || lever.options[0]) : null;
}

function computeDtcCost(product) {
  const base = calc(product);
  const cat = base.byCategory || {};

  const componentTier = getOpt('componentTier');
  const batteryChem   = getOpt('batteryChemistry');
  const displayType   = getOpt('displayType');
  const housingMat    = getOpt('housingMaterial');
  const automation    = getOpt('automation');
  const volume        = getOpt('volume');
  const margin        = getOpt('marginTarget');

  // Read v3.0 top-level categories directly
  const electronicsCost = cat['Electronics'] || 0;
  const mechanicalCost  = cat['Mechanical'] || 0;
  const finishingCost   = cat['Finishing'] || 0;
  const heatingCost     = cat['Heating Engine'] || 0;
  const batteryCost     = cat['Battery'] || 0;
  const mvaCost         = cat['MVA (Material Value Add)'] || 0;
  const amortCost       = cat['Amortization'] || 0;
  const packagingCost   = cat['Packaging'] || 0;

  const tierMult = componentTier.costMultiplier || 1;
  const housingMult = housingMat.costMultiplier || 1;

  // Apply lever multipliers
  const newElectronics = electronicsCost * tierMult;
  const newMechanical  = mechanicalCost * housingMult;
  const newFinishing   = finishingCost * housingMult;
  const newHeating     = heatingCost * tierMult;
  const newBattery     = batteryCost * (batteryChem.costMultiplier || 1);
  const newMva         = mvaCost * (automation.costMultiplier || 1);
  const newAmort       = amortCost;
  const newPackaging   = packagingCost;

  const totalMat = newElectronics + newMechanical + newFinishing + newHeating + newBattery;
  const labCost  = newMva;

  const subtotal   = totalMat + labCost + newAmort + newPackaging;
  const marginCost = subtotal * ((margin.margin || 12) / 100);
  const fob        = subtotal + marginCost;

  const tier = getTierMultipliers();
  const baseMoq = (product.moq ? product.moq.current : 100000) * tier.moqMultiplier;
  const newMoq  = baseMoq * (volume.volumeMultiplier || 1);
  const fixedPerUnit = (product.moq ? product.moq.fixedCostPool : 0) / newMoq;
  const totalUnitCost = fob + fixedPerUnit;

  let valueScore = 50;
  [componentTier, batteryChem, displayType, housingMat, automation].forEach(opt => {
    if (opt && opt.valueMultiplier) valueScore *= opt.valueMultiplier;
  });
  valueScore = Math.min(100, Math.round(valueScore));

  return {
    matCost: totalMat,
    labCost: labCost,
    ovhCost: newAmort,
    marginCost: marginCost,
    fob: fob,
    fixedPerUnit: fixedPerUnit,
    totalUnitCost: totalUnitCost,
    valueScore: valueScore,
    newMoq: newMoq
  };
}

/* ============================================================
   LEVERS UI
   ============================================================ */

function renderLevers() {
  const panel = document.getElementById('leversPanel');
  if (!panel) return;
  panel.innerHTML = '';
  DTC_LEVERS.forEach(lever => {
    const wrap = document.createElement('div');
    wrap.className = 'lever';
    const optionsHtml = lever.options.map(opt => {
      const active = dtcState[lever.id] === opt.id ? ' active' : '';
      return '<button class="lever-opt' + active + '" onclick="selectLeverOption(\'' + lever.id + '\',\'' + opt.id + '\')">'
        + escapeHtml(opt.label) + '<span class="cost-hint">' + (opt.costHint || '') + '</span></button>';
    }).join('');
    wrap.innerHTML = '<div class="lever-header">'
      + '<span class="lever-name">' + escapeHtml(lever.name) + '</span>'
      + '<span class="lever-owner">' + escapeHtml(lever.owner) + '</span>'
      + '</div>'
      + '<div class="lever-options">' + optionsHtml + '</div>';
    panel.appendChild(wrap);
  });
}

function selectLeverOption(leverId, optionId) {
  dtcState[leverId] = optionId;
  saveDtcState();
  renderLevers(); updateDtcImpact(); renderActionBoard();
  renderScenarioCompare(); renderValueMatrix();
}

function resetLevers() {
  localStorage.removeItem(DTC_STORAGE);
  dtcState = {};
  initDtcState(); saveDtcState();
  renderLevers(); updateDtcImpact(); renderActionBoard();
  renderScenarioCompare(); renderValueMatrix();
}
function applyLeanScenario() {
  dtcState.componentTier = 'value';
  dtcState.batteryChemistry = 'recycled';
  dtcState.displayType = 'led';
  dtcState.housingMaterial = 'plastic';
  dtcState.automation = 'full';
  dtcState.volume = 'mass';
  dtcState.marginTarget = 'lean';
  saveDtcState();
  renderLevers(); updateDtcImpact(); renderActionBoard();
  renderScenarioCompare(); renderValueMatrix();
}
function applyPremiumScenario() {
  dtcState.componentTier = 'premium';
  dtcState.batteryChemistry = 'highDensity';
  dtcState.displayType = 'touchscreen';
  dtcState.housingMaterial = 'premium';
  dtcState.automation = 'full';
  dtcState.volume = 'high';
  dtcState.marginTarget = 'premium';
  saveDtcState();
  renderLevers(); updateDtcImpact(); renderActionBoard();
  renderScenarioCompare(); renderValueMatrix();
}

/* ============================================================
   IMPACT
   ============================================================ */

function updateDtcImpact() {
  if (!dtcProduct) return;
  const base = calc(dtcProduct);
  const curr = computeDtcCost(dtcProduct);
  document.getElementById('dtcBaseFob').textContent = fmt(base.fob);
  document.getElementById('dtcCurrentFob').textContent = fmt(curr.fob);
  const delta = curr.fob - base.fob;
  const deltaPct = base.fob ? (delta / base.fob) * 100 : 0;
  const deltaEl = document.getElementById('dtcDelta');
  deltaEl.textContent = (delta > 0 ? '+' : '') + fmt(delta) + ' (' + (delta > 0 ? '+' : '') + deltaPct.toFixed(1) + '%)';
  deltaEl.classList.toggle('positive', delta < 0);
  document.getElementById('dtcLanded').textContent = fmt(curr.totalUnitCost);
  document.getElementById('dtcValueScore').textContent = curr.valueScore + ' / 100';
}

/* ============================================================
   VALUE MATRIX
   ============================================================ */

function renderValueMatrix() {
  const ctx = document.getElementById('valueMatrixChart');
  if (!ctx) return;
  if (valueMatrixChart) { try { valueMatrixChart.destroy(); } catch(e){} }
  const palette = ['#4a148c', '#00695c', '#bf360c', '#283593', '#6a1b9a'];
  const datasets = [];
  DTC_LEVERS.forEach((lever, idx) => {
    if (lever.appliesTo === 'volume' || lever.appliesTo === 'margin') return;
    const points = lever.options.map(opt => ({
      x: ((opt.costMultiplier || 1) - 1) * 100,
      y: ((opt.valueMultiplier || 1) - 1) * 100,
      label: opt.label, lever: lever.name,
      r: dtcState[lever.id] === opt.id ? 12 : 6
    }));
    datasets.push({
      label: lever.name,
      data: points,
      backgroundColor: palette[idx % palette.length],
      borderColor: '#fff', borderWidth: 2,
      pointRadius: points.map(p => p.r),
      pointHoverRadius: 14
    });
  });
  valueMatrixChart = new Chart(ctx, {
    type: 'scatter', data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => {
          const p = ctx.raw;
          return p.lever + ': ' + p.label + ' (Cost ' + (p.x >= 0 ? '+' : '') + p.x.toFixed(0) + '%, Value ' + (p.y >= 0 ? '+' : '') + p.y.toFixed(0) + '%)';
        }}},
        title: { display: true, text: 'Cost impact (X) vs Value impact (Y) — larger bubbles = currently selected',
          font: { size: 12, weight: 'normal' }, color: '#666' }
      },
      scales: {
        x: { title: { display: true, text: 'Cost impact (%) — negative = cheaper' },
             grid: { color: c => c.tick.value === 0 ? '#999' : '#eee' }, min: -60, max: 60 },
        y: { title: { display: true, text: 'Value impact (%) — positive = higher perceived value' },
             grid: { color: c => c.tick.value === 0 ? '#999' : '#eee' }, min: -30, max: 45 }
      }
    }
  });
}

/* ============================================================
   ACTION BOARD
   ============================================================ */

function renderActionBoard() {
  const board = document.getElementById('actionBoard'); if (!board) return;
  board.innerHTML = '';
  DTC_LEVERS.forEach(lever => {
    const selectedOpt = lever.options.find(o => o.id === dtcState[lever.id]);
    if (!selectedOpt) return;
    const card = document.createElement('div');
    card.className = 'action-card';
    card.innerHTML = '<div class="owner">' + escapeHtml(lever.owner) + '</div>'
      + '<div class="lever-name">' + escapeHtml(lever.name) + '</div>'
      + '<div class="lever-desc">' + escapeHtml(lever.desc) + '</div>'
      + '<div class="lever-impact"><strong>Current:</strong> ' + escapeHtml(selectedOpt.label) + '<br>'
      + '<strong>Impact:</strong> ' + (selectedOpt.costHint || '—') + ' on cost'
      + (selectedOpt.valueMultiplier ? ' · value ' + ((selectedOpt.valueMultiplier - 1) * 100).toFixed(0) + '%' : '')
      + '</div>';
    board.appendChild(card);
  });
}

/* ============================================================
   SCENARIO COMPARE
   ============================================================ */

function renderScenarioCompare() {
  const wrap = document.getElementById('scenarioCompare');
  if (!wrap || !dtcProduct) return;
  wrap.innerHTML = '';
  const base = calc(dtcProduct);
  const curr = computeDtcCost(dtcProduct);
  const baselineCol = document.createElement('div');
  baselineCol.className = 'scenario-col current';
  baselineCol.innerHTML = '<h4>📌 Baseline (from Dashboard)</h4>'
    + '<div class="scenario-line"><span class="lbl">Materials</span><span class="val">' + fmt(base.mat) + '</span></div>'
    + '<div class="scenario-line"><span class="lbl">Labour (MVA)</span><span class="val">' + fmt(base.lab) + '</span></div>'
    + '<div class="scenario-line"><span class="lbl">Factory margin</span><span class="val">' + fmt(base.margin) + '</span></div>'
    + '<div class="scenario-line highlight"><span class="lbl"><strong>FOB</strong></span><span class="val">' + fmt(base.fob) + '</span></div>';
  const optCol = document.createElement('div');
  optCol.className = 'scenario-col optimized';
  optCol.innerHTML = '<h4>🎯 Your Scenario</h4>'
    + '<div class="scenario-line"><span class="lbl">Materials</span><span class="val">' + fmt(curr.matCost) + '</span></div>'
    + '<div class="scenario-line"><span class="lbl">Labour (MVA)</span><span class="val">' + fmt(curr.labCost) + '</span></div>'
    + '<div class="scenario-line"><span class="lbl">Amortization</span><span class="val">' + fmt(curr.ovhCost) + '</span></div>'
    + '<div class="scenario-line"><span class="lbl">Factory margin</span><span class="val">' + fmt(curr.marginCost) + '</span></div>'
    + '<div class="scenario-line highlight"><span class="lbl"><strong>FOB</strong></span><span class="val">' + fmt(curr.fob) + '</span></div>'
    + '<div class="scenario-line"><span class="lbl">Fixed / unit @ MOQ ' + Math.round(curr.newMoq).toLocaleString() + '</span><span class="val">' + fmt(curr.fixedPerUnit) + '</span></div>'
    + '<div class="scenario-line highlight"><span class="lbl"><strong>Total Unit Cost</strong></span><span class="val">' + fmt(curr.totalUnitCost) + '</span></div>';
  wrap.appendChild(baselineCol);
  wrap.appendChild(optCol);
}

/* ============================================================
   3D VIEWER
   ============================================================ */

function getMaterialPreset(name) {
  switch (name) {
    case 'matte':    return { roughness: 0.75, metalness: 0.05 };
    case 'gloss':    return { roughness: 0.25, metalness: 0.15 };
    case 'metal':    return { roughness: 0.35, metalness: 0.85 };
    case 'leather':  return { roughness: 0.85, metalness: 0.02 };
    case 'fabric':   return { roughness: 0.95, metalness: 0.00 };
    default:         return { roughness: 0.6,  metalness: 0.05 };
  }
}

function roundedBox(w, h, d, r) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d, bevelEnabled: true,
    bevelThickness: r * 0.35, bevelSize: r * 0.35,
    bevelSegments: 5, curveSegments: 16, steps: 1
  });
  geo.translate(0, 0, -d / 2);
  return geo;
}

function buildProceduralTwoPiece() {
  const group = new THREE.Group();
  const holderGeo = roundedBox(1.05, 2.6, 0.55, 0.18);
  const holder = new THREE.Mesh(holderGeo, new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.72 }));
  holder.userData.isMainSurface = true;
  holder.position.set(-0.6, 0.4, 0);
  group.add(holder);
  const chargerGeo = roundedBox(1.35, 2.9, 0.65, 0.22);
  const charger = new THREE.Mesh(chargerGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.65 }));
  charger.position.set(0.6, 0.2, -0.35);
  group.add(charger);
  const ringGeo = new THREE.TorusGeometry(0.34, 0.04, 12, 32);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x4a148c, metalness: 0.6, roughness: 0.3 }));
  ring.position.set(-0.6, 0.9, 0.32);
  group.add(ring);
  for (let i = 0; i < 3; i++) {
    const dotGeo = new THREE.SphereGeometry(0.055, 12, 12);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x4a148c, emissiveIntensity: 0.6 }));
    dot.position.set(0.6 + (i - 1) * 0.22, -1.05, 0.05);
    group.add(dot);
  }
  group.position.set(0, -0.4, 0);
  return group;
}

function buildProceduralAllInOne() {
  const group = new THREE.Group();
  const bodyGeo = roundedBox(1.15, 3.1, 0.62, 0.22);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x4a148c, roughness: 0.65 }));
  body.userData.isMainSurface = true;
  group.add(body);
  const displayGeo = roundedBox(0.85, 0.75, 0.08, 0.08);
  const display = new THREE.Mesh(displayGeo, new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2, metalness: 0.5 }));
  display.position.set(0, 0.85, 0.33);
  group.add(display);
  const btnGeo = roundedBox(0.08, 0.42, 0.12, 0.03);
  const btn = new THREE.Mesh(btnGeo, new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.7, roughness: 0.25 }));
  btn.position.set(0.60, 0.3, 0);
  group.add(btn);
  const portGeo = new THREE.BoxGeometry(0.28, 0.09, 0.06);
  const port = new THREE.Mesh(portGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
  port.position.set(0, -1.53, 0);
  group.add(port);
  group.position.set(0, -0.3, 0);
  return group;
}

function buildProceduralPocketCharger() {
  const group = new THREE.Group();
  const bodyGeo = roundedBox(1.5, 3.0, 0.85, 0.28);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 }));
  body.userData.isMainSurface = true;
  group.add(body);
  const slotGeo = roundedBox(1.0, 0.55, 0.6, 0.12);
  const slot = new THREE.Mesh(slotGeo, new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 }));
  slot.position.set(0, 1.05, 0.15);
  group.add(slot);
  for (let i = 0; i < 4; i++) {
    const dotGeo = new THREE.SphereGeometry(0.055, 12, 12);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x86efac, emissiveIntensity: 0.7 }));
    dot.position.set(-0.45 + i * 0.30, -1.15, 0.42);
    group.add(dot);
  }
  group.position.set(0, -0.2, 0);
  return group;
}

function buildProceduralHolder() {
  const group = new THREE.Group();
  const bodyGeo = roundedBox(1.05, 2.9, 0.55, 0.2);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 }));
  body.userData.isMainSurface = true;
  group.add(body);
  const ringGeo = new THREE.TorusGeometry(0.33, 0.045, 12, 32);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x4a148c, metalness: 0.6, roughness: 0.3 }));
  ring.position.set(0, 1.05, 0.28);
  group.add(ring);
  group.position.set(0, -0.2, 0);
  return group;
}

function buildArchetypeModel(archetype) {
  switch (archetype) {
    case 'all-in-one':     return buildProceduralAllInOne();
    case 'pocket-charger': return buildProceduralPocketCharger();
    case 'holder':         return buildProceduralHolder();
    case 'two-piece':
    default:               return buildProceduralTwoPiece();
  }
}

function applyMaterialPresetToModel(model) {
  const preset = getMaterialPreset(cad.materialPreset);
  model.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.roughness = preset.roughness;
      child.material.metalness = preset.metalness;
      child.material.wireframe = (cad.viewMode === 'wireframe');
      if (cad.texture && child.userData.isMainSurface) {
        child.material.map = cad.texture;
        child.material.color.set(0xffffff);
      }
      child.material.needsUpdate = true;
    }
  });
}

function rebuildCadModel() {
  if (!cad.group) return;
  while (cad.group.children.length) cad.group.remove(cad.group.children[0]);
  cad.edgeLines = null;

  if (cad.customGLB) {
    applyMaterialPresetToModel(cad.customGLB);
    cad.group.add(cad.customGLB);
    cad.currentModel = cad.customGLB;
    updateEdgeOverlay(cad.customGLB);
    return;
  }

  const model = buildArchetypeModel(cad.archetype);
  const preset = getMaterialPreset(cad.materialPreset);
  model.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (cad.texture && child.userData.isMainSurface) {
        child.material.map = cad.texture;
        child.material.color.set(0xffffff);
      } else if (child.userData.isMainSurface) {
        child.material.color.set(cad.baseColor);
      }
      child.material.roughness = preset.roughness;
      child.material.metalness = preset.metalness;
      if (cad.viewMode === 'wireframe') child.material.wireframe = true;
      child.material.needsUpdate = true;
    }
  });

  cad.group.add(model);
  cad.currentModel = model;
  updateEdgeOverlay(model);
}

function updateEdgeOverlay(model) {
  if (!model) return;
  if (cad.edgeLines) { cad.group.remove(cad.edgeLines); cad.edgeLines = null; }
  if (cad.viewMode !== 'technical' || !THREE.EdgesGeometry) return;
  const edgesGroup = new THREE.Group();
  model.traverse(child => {
    if (child.isMesh) {
      try {
        const edges = new THREE.EdgesGeometry(child.geometry, 30);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1a237e }));
        line.position.copy(child.position);
        line.rotation.copy(child.rotation);
        line.scale.copy(child.scale);
        edgesGroup.add(line);
      } catch (e) {}
    }
  });
  cad.edgeLines = edgesGroup;
  cad.group.add(cad.edgeLines);
}

/* ============================================================
   SCENE INIT
   ============================================================ */

function initCadViewer() {
  const container = document.getElementById('viewer3d');
  if (!container) return;
  if (!window.THREE) {
    container.innerHTML = '<p style="padding:20px;color:#c62828;font-size:13px;">Three.js failed to load.</p>';
    return;
  }
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w < 10 || h < 10) { setTimeout(initCadViewer, 200); return; }
  if (cad.initialized) {
    cad.renderer.setSize(w, h);
    cad.camera.aspect = w / h;
    cad.camera.updateProjectionMatrix();
    cad.lastW = w; cad.lastH = h;
    return;
  }

  cad.scene = new THREE.Scene();
  cad.scene.background = new THREE.Color(0xf1f5f9);
  cad.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 1000);
  cad.camera.position.set(4.2, 2.6, 5.2);
  cad.camera.lookAt(0, 0, 0);

  cad.renderer = new THREE.WebGLRenderer({ antialias: true });
  cad.renderer.setSize(w, h);
  cad.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (cad.renderer.shadowMap) {
    cad.renderer.shadowMap.enabled = true;
    cad.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  container.innerHTML = '';
  container.appendChild(cad.renderer.domElement);

  cad.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  cad.scene.add(key);
  const rim = new THREE.DirectionalLight(0xc7d2fe, 0.45);
  rim.position.set(-5, 2, -4);
  cad.scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(2, -2, 3);
  cad.scene.add(fill);

  if (THREE.GridHelper) {
    const grid = new THREE.GridHelper(10, 20, 0xcbd5e1, 0xe2e8f0);
    grid.position.y = -2.0;
    cad.scene.add(grid);
  }

  cad.group = new THREE.Group();
  cad.scene.add(cad.group);

  rebuildCadModel();

  if (typeof THREE.OrbitControls === 'function') {
    cad.controls = new THREE.OrbitControls(cad.camera, cad.renderer.domElement);
    cad.controls.enableDamping = true;
    cad.controls.dampingFactor = 0.08;
    cad.controls.enablePan = true;
    cad.controls.minDistance = 2.5;
    cad.controls.maxDistance = 14;
    cad.controls.target.set(0, 0, 0);
    cad.controls.update();
  }

  cad.initialized = true;
  cad.lastW = w;
  cad.lastH = h;
  if (!cad.animating) { cad.animating = true; animateCad(); }
}

function animateCad() {
  requestAnimationFrame(animateCad);
  if (!cad.renderer) return;
  const container = document.getElementById('viewer3d');
  if (container) {
    const w = container.clientWidth, h = container.clientHeight;
    if ((w !== cad.lastW || h !== cad.lastH) && w > 10 && h > 10) {
      cad.renderer.setSize(w, h);
      cad.camera.aspect = w / h;
      cad.camera.updateProjectionMatrix();
      cad.lastW = w; cad.lastH = h;
    }
  }
  if (cad.controls) cad.controls.update();
  else if (cad.group) cad.group.rotation.y += 0.003;
  cad.renderer.render(cad.scene, cad.camera);
}

/* ============================================================
   VIEW CONTROLS
   ============================================================ */

function setArchetype(type) {
  cad.archetype = type;
  cad.customGLB = null;
  rebuildCadModel();
  setActiveChip('archetypeChips', type);
  const hint = document.getElementById('viewerHint');
  if (hint) { hint.textContent = '🖱️ Drag to rotate · Scroll to zoom · Right-click drag to pan'; hint.style.color = '#999'; }
}
function setViewMode(mode) {
  cad.viewMode = mode;
  cad.group.traverse(c => {
    if (c.isMesh) { c.material.wireframe = (mode === 'wireframe'); c.material.needsUpdate = true; }
  });
  const model = cad.currentModel;
  if (model) updateEdgeOverlay(model);
  setActiveChip('viewChips', mode);
}
function setProjection(proj) {
  const container = document.getElementById('viewer3d');
  if (!container) return;
  const w = container.clientWidth, h = container.clientHeight;
  if (w < 10 || h < 10) return;
  const aspect = w / h;
  const target = cad.controls ? cad.controls.target.clone() : new THREE.Vector3(0, 0, 0);
  const oldPos = cad.camera.position.clone();
  if (proj === 'orthographic') {
    const size = 3.8;
    cad.camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, 0.1, 1000);
  } else {
    cad.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 1000);
  }
  cad.camera.position.copy(oldPos);
  cad.camera.lookAt(target);
  if (typeof THREE.OrbitControls === 'function') {
    if (cad.controls) cad.controls.dispose();
    cad.controls = new THREE.OrbitControls(cad.camera, cad.renderer.domElement);
    cad.controls.enableDamping = true;
    cad.controls.dampingFactor = 0.08;
    cad.controls.target.copy(target);
    cad.controls.update();
  }
  cad.projection = proj;
  setActiveChip('projectionChips', proj);
}
function setViewPreset(view) {
  if (!cad.camera) return;
  const t = new THREE.Vector3(0, 0, 0);
  const d = 6.0;
  if (view === 'front') cad.camera.position.set(0, 0, d);
  else if (view === 'side') cad.camera.position.set(d, 0, 0);
  else if (view === 'top') cad.camera.position.set(0.01, d, 0.01);
  else cad.camera.position.set(d * 0.7, d * 0.5, d * 0.7);
  cad.camera.lookAt(t);
  if (cad.controls) { cad.controls.target.copy(t); cad.controls.update(); }
}
function setMaterialPreset(preset) {
  cad.materialPreset = preset;
  applyMaterialPresetToModel(cad.currentModel);
  setActiveChip('materialChips', preset);
}
function setBaseColor(hex) {
  cad.baseColor = hex;
  if (cad.texture) return;
  cad.group.traverse(c => {
    if (c.isMesh && c.userData.isMainSurface) {
      c.material.color.set(hex);
      c.material.needsUpdate = true;
    }
  });
}
function setActiveChip(containerId, activeId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.querySelectorAll('.cad-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.id === activeId);
  });
}
function resetToBuiltIn() {
  cad.customGLB = null;
  const hint = document.getElementById('viewerHint');
  if (hint) {
    hint.textContent = '🖱️ Drag to rotate · Scroll to zoom · Right-click drag to pan';
    hint.style.color = '#999';
  }
  rebuildCadModel();
}

/* ============================================================
   GLB UPLOAD
   ============================================================ */

function initUploadZone() {
  const zone = document.getElementById('glbUploadZone');
  const input = document.getElementById('glbInput');
  if (!zone || !input) return;
  if (zone.dataset.wired === '1') return;
  zone.dataset.wired = '1';

  zone.addEventListener('click', e => { if (e.target === input) return; input.click(); });
  zone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('dragover'); });
  zone.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleGLBFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files && e.target.files.length) handleGLBFile(e.target.files[0]);
    e.target.value = '';
  });
}

function setProgressState(o) {
  const progress = document.getElementById('uploadProgress');
  const fill = document.getElementById('uploadProgressFill');
  const text = document.getElementById('uploadProgressText');
  const etaEl = document.getElementById('uploadProgressEta');
  if (!progress || !fill || !text || !etaEl) return;
  progress.style.display = 'block';
  if (o.percent != null) fill.style.width = o.percent + '%';
  if (o.status != null) text.textContent = o.status;
  if (o.eta != null) etaEl.textContent = o.eta;
  if (o.state === 'error') fill.classList.add('error'); else fill.classList.remove('error');
  if (o.state === 'success') fill.classList.add('success'); else fill.classList.remove('success');
}
function hideProgress(delay) {
  setTimeout(() => {
    const progress = document.getElementById('uploadProgress');
    if (progress) progress.style.display = 'none';
    const fill = document.getElementById('uploadProgressFill');
    if (fill) { fill.style.width = '0%'; fill.classList.remove('error', 'success'); }
    const zone = document.getElementById('glbUploadZone');
    if (zone) zone.classList.remove('uploading');
  }, delay || 2500);
}
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function handleGLBFile(file) {
  const zone = document.getElementById('glbUploadZone');
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  if (!name.endsWith('.glb') && !name.endsWith('.gltf')) {
    setProgressState({ percent: 100, status: '❌ Not a valid .glb or .gltf file', state: 'error' });
    hideProgress(3500);
    return;
  }
  if (zone) zone.classList.add('uploading');
  const sizeText = formatBytes(file.size);
  setProgressState({ percent: 0, status: 'Reading ' + file.name + ' (' + sizeText + ')…', eta: '', state: 'normal' });

  const reader = new FileReader();
  reader.onprogress = e => {
    if (e.lengthComputable) {
      const percent = Math.min(99, (e.loaded / e.total) * 100);
      setProgressState({ percent, status: 'Reading file… ' + percent.toFixed(0) + '% · ' + formatBytes(e.loaded) + ' / ' + sizeText, eta: '', state: 'normal' });
    }
  };
  reader.onload = e => {
    setProgressState({ percent: 100, status: '✅ File read. Parsing…', eta: 'this may take a moment', state: 'normal' });
    if (!THREE.GLTFLoader) {
      setProgressState({ status: '❌ GLTFLoader not available', state: 'error' });
      hideProgress(3500); if (zone) zone.classList.remove('uploading');
      return;
    }
    const loader = new THREE.GLTFLoader();
    loader.parse(e.target.result, '', gltf => {
      const scene = gltf.scene;
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 3.2 / maxDim;
      scene.scale.setScalar(scale);
      scene.position.sub(center.multiplyScalar(scale));
      scene.position.y += 0.1;
      scene.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) child.material.side = THREE.DoubleSide;
        }
      });
      cad.customGLB = scene;
      applyMaterialPresetToModel(scene);
      while (cad.group.children.length) cad.group.remove(cad.group.children[0]);
      cad.group.add(scene);
      cad.currentModel = scene;
      updateEdgeOverlay(scene);
      setProgressState({ percent: 100, status: '✅ ' + file.name + ' loaded', eta: '', state: 'success' });
      hideProgress(3000);
      const hint = document.getElementById('viewerHint');
      if (hint) { hint.textContent = '✅ Loaded: ' + file.name + ' (' + sizeText + ') · Drag to rotate'; hint.style.color = '#2d6a4f'; }
    }, err => {
      console.error('GLTF parse error:', err);
      setProgressState({ status: '❌ Failed to parse. The file may be corrupted or in an unsupported format.', state: 'error' });
      hideProgress(5000); if (zone) zone.classList.remove('uploading');
    });
  };
  reader.onerror = () => {
    setProgressState({ status: '❌ Failed to read the file', state: 'error' });
    hideProgress(3500); if (zone) zone.classList.remove('uploading');
  };
  reader.readAsArrayBuffer(file);
}

/* ============================================================
   MAIN RENDER
   ============================================================ */

function renderDtcTab() {
  if (!data || !data.products || !data.products.length) return;
  if (!dtcProduct) dtcProduct = data.products[0];
  initDtcState();
  renderLevers();
  updateDtcImpact();
  renderValueMatrix();
  renderActionBoard();
  renderScenarioCompare();
  initUploadZone();
  setTimeout(() => {
    try { initCadViewer(); } catch (err) { console.error('CAD init failed:', err); }
  }, 250);
}

(function watchDtcTab() {
  const target = document.getElementById('tab-dtc');
  if (!target) return;
  const observer = new MutationObserver(() => {
    if (target.classList.contains('active')) renderDtcTab();
  });
  observer.observe(target, { attributes: true, attributeFilter: ['class'] });
})();
