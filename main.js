import * as THREE from "three/webgpu";
import {
  step,
  normalWorld,
  output,
  texture,
  vec3,
  vec4,
  normalize,
  positionWorld,
  bumpMap,
  cameraPosition,
  color,
  uniform,
  mix,
  uv,
  max,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Minimal timer (THREE.Timer not in webgpu build). */
class Timer {
  constructor() {
    this._last = performance.now() / 1000;
    this._elapsed = 0;
    this._delta = 0;
  }
  connect() {}
  update() {
    const now = performance.now() / 1000;
    this._delta = now - this._last;
    this._last = now;
    this._elapsed += this._delta;
  }
  getDelta() {
    return this._delta;
  }
  getElapsed() {
    return this._elapsed;
  }
}

const timer = new Timer();

let camera, scene, renderer, controls, globe, atmosphere;
let markerMesh, institutions = [];
let markerScales = [];
let markerPulseUniform;
let userInteracting = false;
let markerHovered = false;
let tooltipEl, overlayEl, sidebarEl, searchInputEl;
let metaLastUpdated, metaTotalPapers, metaTotalInstitutions;

const textureBase = "./img/";
const ROTATION_SPEED_INITIAL = 0.025;  // rad/s when not hovering
const ROTATION_TRANSITION_DURATION = 0.3;  // seconds to blend 0 <-> initial
let currentRotationSpeed = ROTATION_SPEED_INITIAL;
let rotationTransitionStartTime = 0;
let rotationTransitionStartSpeed = ROTATION_SPEED_INITIAL;
let rotationTargetSpeed = ROTATION_SPEED_INITIAL;

function latLngToVector3(lat, lng, radius = 1.015) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function init() {
  timer.connect();

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 2.5);

  scene = new THREE.Scene();

  const sun = new THREE.DirectionalLight("#ffffff", 2);
  sun.position.set(0, 0, 3);
  scene.add(sun);

  const atmosphereDayColor = uniform(new THREE.Color("#4db2ff"));
  const atmosphereTwilightColor = uniform(new THREE.Color("#bc490b"));
  const roughnessLow = uniform(0.25);
  const roughnessHigh = uniform(0.35);

  const textureLoader = new THREE.TextureLoader();
  const dayTexture = textureLoader.load(textureBase + "earth_day.jpg");
  dayTexture.colorSpace = THREE.SRGBColorSpace;
  dayTexture.anisotropy = 8;

  const nightTexture = textureLoader.load(textureBase + "earth_night.jpg");
  nightTexture.colorSpace = THREE.SRGBColorSpace;
  nightTexture.anisotropy = 8;

  const bumpRoughnessCloudsTexture = textureLoader.load(textureBase + "earth_bump_roughness_clouds.jpg");
  bumpRoughnessCloudsTexture.anisotropy = 8;

  const viewDirection = positionWorld.sub(cameraPosition).normalize();
  const fresnel = viewDirection.dot(normalWorld).abs().oneMinus().toVar();

  const sunOrientation = normalWorld.dot(normalize(sun.position)).toVar();

  const atmosphereColor = mix(
    atmosphereTwilightColor,
    atmosphereDayColor,
    sunOrientation.smoothstep(-0.25, 0.75)
  );

  const globeMaterial = new THREE.MeshStandardNodeMaterial();
  const cloudsStrength = texture(bumpRoughnessCloudsTexture, uv()).b.smoothstep(0.2, 1);

  globeMaterial.colorNode = mix(texture(dayTexture), vec3(1), cloudsStrength.mul(2));

  const roughness = max(
    texture(bumpRoughnessCloudsTexture).g,
    step(0.01, cloudsStrength)
  );
  globeMaterial.roughnessNode = roughness.remap(0, 1, roughnessLow, roughnessHigh);

  const night = texture(nightTexture);
  const dayStrength = sunOrientation.smoothstep(-0.25, 0.5);

  const atmosphereDayStrength = sunOrientation.smoothstep(-0.5, 1);
  const atmosphereMix = atmosphereDayStrength.mul(fresnel.pow(2)).clamp(0, 1);

  let finalOutput = mix(night.rgb, output.rgb, dayStrength);
  finalOutput = mix(finalOutput, atmosphereColor, atmosphereMix);

  globeMaterial.outputNode = vec4(finalOutput, output.a);

  const bumpElevation = max(texture(bumpRoughnessCloudsTexture).r, cloudsStrength);
  globeMaterial.normalNode = bumpMap(bumpElevation);

  const sphereGeometry = new THREE.SphereGeometry(1, 64, 64);
  globe = new THREE.Mesh(sphereGeometry, globeMaterial);
  scene.add(globe);

  const atmosphereMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    transparent: true,
  });
  let alpha = fresnel.remap(0.73, 1, 1, 0).pow(3);
  alpha = alpha.mul(sunOrientation.smoothstep(-0.5, 1));
  atmosphereMaterial.outputNode = vec4(atmosphereColor, alpha);

  atmosphere = new THREE.Mesh(sphereGeometry.clone(), atmosphereMaterial);
  atmosphere.scale.setScalar(1.04);
  scene.add(atmosphere);

  renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  const canvas = document.getElementById("canvas");
  canvas.appendChild(renderer.domElement);
  // WebGPU backend must be initialized asynchronously before first render
  window._rendererReady = renderer.init().then(() => {
    console.log("[Globe] WebGPU renderer initialized");
    renderer.setAnimationLoop(animate);
  }).catch((err) => {
    console.error("[Globe] WebGPU init failed:", err);
    throw err;
  });

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 8;
  controls.addEventListener("start", () => {
    userInteracting = true;
    markerHovered = false;
    tooltipEl.classList.remove("visible");
  });
  controls.addEventListener("end", () => (userInteracting = false));

  window.addEventListener("resize", onWindowResize);

  tooltipEl = document.getElementById("tooltip");
  overlayEl = document.getElementById("loading-overlay");
  sidebarEl = document.getElementById("sidebar");
  searchInputEl = document.getElementById("search-input");
  metaLastUpdated = document.getElementById("meta-last-updated");
  metaTotalPapers = document.getElementById("meta-total-papers");
  metaTotalInstitutions = document.getElementById("meta-total-institutions");

  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    sidebarEl.classList.toggle("collapsed");
    document.getElementById("sidebar-toggle").textContent = sidebarEl.classList.contains("collapsed") ? "▶" : "◀";
  });

  searchInputEl.addEventListener("input", onSearchInput);
}

function onSearchInput() {
  const q = searchInputEl.value.trim().toLowerCase();
  if (!markerMesh || !institutions.length) return;

  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let i = 0; i < institutions.length; i++) {
    const inst = institutions[i];
    const visible = !q || (inst.name || "").toLowerCase().includes(q);
    const s = visible ? markerScales[i] : 0;
    scale.set(s, s, s);
    pos.copy(latLngToVector3(inst.lat, inst.lng));
    quat.identity();
    matrix.compose(pos, quat, scale);
    markerMesh.setMatrixAt(i, matrix);
  }
  markerMesh.instanceMatrix.needsUpdate = true;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function buildMarkers() {
  if (!institutions.length) return;

  const count = institutions.length;
  const geometry = new THREE.SphereGeometry(0.004, 8, 8);
  markerPulseUniform = uniform(0.5);
  const pulse = markerPulseUniform.mul(0.5).add(0.5);

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  const baseColor = color(new THREE.Color("#00ffcc"));
  material.colorNode = baseColor;
  material.outputNode = vec4(baseColor, pulse);

  markerMesh = new THREE.InstancedMesh(geometry, material, count);
  markerMesh.count = count;

  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colorAttr = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const inst = institutions[i];
    const s = 1 + Math.log10(Math.max(1, inst.paper_count)) * 0.8;
    markerScales[i] = s;
    pos.copy(latLngToVector3(inst.lat, inst.lng));
    quat.identity();
    scale.set(s, s, s);
    matrix.compose(pos, quat, scale);
    markerMesh.setMatrixAt(i, matrix);
    colorAttr.setHex(0x00ffcc);
    markerMesh.setColorAt(i, colorAttr);
  }
  markerMesh.instanceMatrix.needsUpdate = true;
  if (markerMesh.instanceColor) markerMesh.instanceColor.needsUpdate = true;

  globe.add(markerMesh);
}

function updateMarkerPulse() {
  if (markerPulseUniform) {
    markerPulseUniform.value = Math.sin(timer.getElapsed() * 2) * 0.5 + 0.5;
  }
}

function setupRaycasting() {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (!markerMesh) {
      tooltipEl.classList.remove("visible");
      return;
    }

    const hits = raycaster.intersectObject(markerMesh, false);
    if (hits.length > 0 && hits[0].instanceId !== undefined) {
      const idx = hits[0].instanceId;
      const inst = institutions[idx];
      if (inst) {
        tooltipEl.querySelector(".tooltip-name").textContent = inst.name || "—";
        tooltipEl.querySelector(".tooltip-country").textContent = inst.country_code ? `Country: ${inst.country_code}` : "";
        tooltipEl.querySelector(".tooltip-papers").textContent = `Papers: ${inst.paper_count ?? 0}`;
        tooltipEl.style.left = `${event.clientX + 12}px`;
        tooltipEl.style.top = `${event.clientY + 12}px`;
        tooltipEl.classList.add("visible");
        markerHovered = true;
      } else {
        markerHovered = false;
        tooltipEl.classList.remove("visible");
      }
    } else {
      markerHovered = false;
      tooltipEl.classList.remove("visible");
    }
  }

  function onMouseLeave() {
    markerHovered = false;
    tooltipEl.classList.remove("visible");
  }

  renderer.domElement.addEventListener("mousemove", onMouseMove);
  renderer.domElement.addEventListener("mouseleave", onMouseLeave);
}

async function loadData() {
  console.log("[Globe] loadData started");
  overlayEl.classList.remove("hidden");
  overlayEl.classList.remove("error");
  overlayEl.querySelector("p").textContent = "Loading globe…";

  let institutionsData = [];
  let metaData = null;

  try {
    console.log("[Globe] Fetching data/institutions.json and data/meta.json…");
    const [instRes, metaRes] = await Promise.all([
      fetch("data/institutions.json"),
      fetch("data/meta.json"),
    ]);

    console.log("[Globe] Fetch done.", "institutions:", instRes.status, "meta:", metaRes.status);

    if (!instRes.ok) throw new Error("Failed to load institutions.json: " + instRes.status);
    institutionsData = await instRes.json();

    if (metaRes.ok) {
      metaData = await metaRes.json();
    }
  } catch (e) {
    console.error("[Globe] Fetch error:", e);
    overlayEl.classList.add("error");
    overlayEl.querySelector("p").textContent = "Error loading data. " + (e.message || "");
    overlayEl.classList.remove("hidden");
    return;
  }

  institutions = Array.isArray(institutionsData) ? institutionsData : [];
  markerScales = [];
  console.log("[Globe] Loaded", institutions.length, "institutions");

  if (metaData) {
    metaLastUpdated.textContent = "Last updated: " + (metaData.last_updated || "—");
    metaTotalPapers.textContent = "Total papers: " + (metaData.total_papers ?? "—");
    metaTotalInstitutions.textContent = "Total institutions: " + (metaData.total_institutions ?? "—");
  } else {
    metaLastUpdated.textContent = "Last updated: —";
    metaTotalPapers.textContent = "Total papers: —";
    metaTotalInstitutions.textContent = "Total institutions: " + institutions.length;
  }

  try {
    console.log("[Globe] Building markers…");
    buildMarkers();
    setupRaycasting();
  } catch (e) {
    console.error("[Globe] buildMarkers/setup error:", e);
    overlayEl.classList.add("error");
    overlayEl.querySelector("p").textContent = "Error building markers. " + (e.message || "");
    overlayEl.classList.remove("hidden");
    return;
  }

  console.log("[Globe] Ready, hiding overlay");
  overlayEl.classList.add("hidden");
}

async function animate() {
  timer.update();
  const delta = timer.getDelta();

  if (!userInteracting) {
    const targetSpeed = markerHovered ? 0 : ROTATION_SPEED_INITIAL;
    if (targetSpeed !== rotationTargetSpeed) {
      rotationTransitionStartTime = timer.getElapsed();
      rotationTransitionStartSpeed = currentRotationSpeed;
      rotationTargetSpeed = targetSpeed;
    }
    const elapsed = timer.getElapsed() - rotationTransitionStartTime;
    const t = Math.min(1, elapsed / ROTATION_TRANSITION_DURATION);
    currentRotationSpeed = rotationTransitionStartSpeed + (rotationTargetSpeed - rotationTransitionStartSpeed) * t;
    globe.rotation.y += delta * currentRotationSpeed;
  }

  updateMarkerPulse();
  controls.update();
  if (typeof renderer.renderAsync === "function") {
    await renderer.renderAsync(scene, camera);
  } else {
    renderer.render(scene, camera);
  }
}

function main() {
  console.log("[Globe] init started");
  init();
  console.log("[Globe] init done, waiting for WebGPU…");
  window._rendererReady
    .then(() => loadData())
    .catch((e) => {
      console.error("[Globe] Fatal:", e);
      if (overlayEl) {
        overlayEl.classList.add("error");
        overlayEl.querySelector("p").textContent = "WebGPU failed. " + (e.message || String(e));
        overlayEl.classList.remove("hidden");
      }
    });
}

main();
