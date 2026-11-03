import "server-only";
import type { Device, DeviceTrack, Farm, Fix, Member, MlJob, MlModel, Scan } from "./types";

// Synthetic but plausible data around DeKUT, Nyeri, used when Supabase isn't
// configured. Seeded so every render shows the same farm.

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export const demoFarms: Farm[] = [
  {
    id: "f-kiganjo",
    name: "Kiganjo Block A",
    location_name: "Nyeri, KE",
    center_lat: -0.3981,
    center_lng: 36.9616,
    boundary: {
      type: "Polygon",
      coordinates: [[[36.9545, -0.3925], [36.9688, -0.3921], [36.9702, -0.4038], [36.9551, -0.4046], [36.9545, -0.3925]]],
    },
  },
  {
    id: "f-mweiga",
    name: "Mweiga Dairy",
    location_name: "Mweiga, KE",
    center_lat: -0.3262,
    center_lng: 36.9011,
    boundary: null,
  },
];

export const demoDevices: Device[] = [
  { id: 1, name: "wb_1", status: "Active", color: "#34b36b", model: "wb_1", farmId: "f-kiganjo", kind: "Livestock · lead cow", notes: null },
  { id: 2, name: "wb_2", status: "Active", color: "#3aa0d8", model: "wb_1", farmId: "f-kiganjo", kind: "Livestock · goat herd", notes: null },
  { id: 3, name: "wb_3", status: "Active", color: "#e8a317", model: "test5", farmId: "f-kiganjo", kind: "Bird · crane", notes: "Grey crowned crane near the dam" },
  { id: 4, name: "wb_4", status: "Inactive", color: "#c45ab3", model: null, farmId: "f-mweiga", kind: "Asset · tractor", notes: null },
];

function track(device: Device, seed: number, radius: number, excursionAt: number): Fix[] {
  const farm = demoFarms.find((f) => f.id === device.farmId)!;
  const r = rng(seed);
  const n = 144; // 36 h at 15 min
  const now = Math.floor(Date.now() / 900_000) * 900_000;
  let lat = farm.center_lat! + (r() - 0.5) * radius;
  let lng = farm.center_lng! + (r() - 0.5) * radius;
  const fixes: Fix[] = [];
  for (let i = 0; i < n; i++) {
    const inExcursion = i >= excursionAt && i < excursionAt + 5;
    const pull = inExcursion ? 0 : 0.06;
    lat += (farm.center_lat! - lat) * pull + (r() - 0.5) * radius * 0.16 + (inExcursion ? -0.0011 : 0);
    lng += (farm.center_lng! - lng) * pull + (r() - 0.5) * radius * 0.16 + (inExcursion ? 0.0014 : 0);
    fixes.push({
      id: device.id * 10_000 + i,
      deviceId: device.id,
      t: new Date(now - (n - 1 - i) * 900_000).toISOString(),
      lat,
      lng,
      alt: 1790 + Math.round(r() * 40),
      anomaly: inExcursion ? -1 : 1,
    });
  }
  return fixes;
}

export function demoTracks(): DeviceTrack[] {
  return [
    { ...demoDevices[0], fixes: track(demoDevices[0], 11, 0.006, 118) },
    { ...demoDevices[1], fixes: track(demoDevices[1], 23, 0.005, 60) },
    { ...demoDevices[2], fixes: track(demoDevices[2], 37, 0.01, 131) },
    { ...demoDevices[3], fixes: track(demoDevices[3], 41, 0.004, 400).slice(0, 80) },
  ];
}

export const demoMembers: Member[] = [
  { id: "u-admin", email: "admin@watchbird.demo", full_name: "Demo Admin", role: "admin", created_at: "2026-10-01T08:00:00Z", farmIds: [] },
  { id: "u-farmer", email: "wanjiru@watchbird.demo", full_name: "Wanjiru Maina", role: "farmer", created_at: "2026-10-12T08:00:00Z", farmIds: ["f-kiganjo"] },
  { id: "u-farmer2", email: "otieno@watchbird.demo", full_name: "Otieno Okoth", role: "farmer", created_at: "2026-10-20T08:00:00Z", farmIds: ["f-mweiga"] },
];

export const demoScans: Scan[] = [
  {
    id: "s-1",
    user_id: "u-farmer",
    farm_id: "f-kiganjo",
    subject: "crop",
    note: "Maize, lower leaves going brown",
    status: "done",
    model: "Qwen/Qwen2.5-VL-7B-Instruct",
    error: null,
    imageUrl: null,
    created_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
    result: {
      title: "Maize — northern leaf blight",
      condition: "diseased",
      urgency: "medium",
      confidence: 0.78,
      summary:
        "Long cigar-shaped grey-green lesions on the lower leaves match northern leaf blight. It spreads upward in humid weather and can cut yield if it reaches the ear leaf before tasselling.",
      findings: ["Elliptical lesions 3–10 cm long on lower leaves", "No lesions visible on upper canopy yet", "Leaf tissue between lesions still green"],
      actions: [
        "Walk the block and check how many plants show lesions above knee height",
        "If the upper leaves are affected before tasselling, apply a registered fungicide (e.g. azoxystrobin-based)",
        "Bury or remove crop residue after harvest and rotate away from maize next season",
      ],
      classifier: [
        { label: "Corn (maize) Northern Leaf Blight", score: 0.81 },
        { label: "Corn (maize) Cercospora leaf spot", score: 0.09 },
      ],
    },
  },
  {
    id: "s-2",
    user_id: "u-farmer",
    farm_id: "f-kiganjo",
    subject: "livestock",
    note: "Heifer limping since morning",
    status: "done",
    model: "Qwen/Qwen2.5-VL-7B-Instruct",
    error: null,
    imageUrl: null,
    created_at: new Date(Date.now() - 4 * 3600_000).toISOString(),
    result: {
      title: "Heifer — possible hoof injury",
      condition: "injured",
      urgency: "high",
      confidence: 0.55,
      summary:
        "The animal is holding weight off the left hind leg. From the photo alone this looks like a hoof or lower-leg problem rather than a whole-body illness, but a close look at the hoof is needed.",
      findings: ["Weight shifted off left hind leg", "No visible swelling above the fetlock", "Body condition looks normal"],
      actions: ["Pen the heifer on dry ground and lift the hoof to check for stones, cracks or a puncture", "Call the vet if there is heat, swelling or a foul smell between the claws"],
    },
  },
];

export const demoModels: MlModel[] = [
  { name: "wb_1", algorithm: "isolation_forest", device_ids: [1, 2], metrics: { samples: 4120, anomaly_rate: 0.048 }, trained_at: "2026-10-28T09:12:00Z" },
  { name: "test5", algorithm: "isolation_forest", device_ids: [3], metrics: { samples: 1180, anomaly_rate: 0.061 }, trained_at: "2026-10-30T15:40:00Z" },
];

export const demoJobs: MlJob[] = [
  { id: "j-2", kind: "monitor", status: "done", payload: { device_ids: [1, 2, 3] }, result: { scored: 312, anomalies: 9 }, error: null, created_at: new Date(Date.now() - 900_000).toISOString(), finished_at: new Date(Date.now() - 880_000).toISOString() },
  { id: "j-1", kind: "train", status: "done", payload: { model_name: "test5", device_ids: [3] }, result: { samples: 1180 }, error: null, created_at: "2026-10-30T15:38:00Z", finished_at: "2026-10-30T15:40:00Z" },
];
