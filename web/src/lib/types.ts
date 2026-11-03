export type Role = "admin" | "farmer";

export type Viewer = {
  id: string;
  email: string;
  name: string;
  role: Role;
  demo: boolean;
};

export type Farm = {
  id: string;
  name: string;
  location_name: string | null;
  center_lat: number | null;
  center_lng: number | null;
  boundary: GeoJSON.Polygon | null;
};

export type Device = {
  id: number;
  name: string;
  status: "Active" | "Inactive" | string;
  color: string;
  model: string | null;
  farmId: string | null;
  kind: string;
  notes: string | null;
};

/** One GPS fix. `anomaly` follows the IsolationForest convention: -1 anomalous, 1 normal. */
export type Fix = {
  id: number;
  deviceId: number;
  t: string;
  lat: number;
  lng: number;
  alt: number | null;
  anomaly: 1 | -1;
};

export type DeviceTrack = Device & { fixes: Fix[] };

/** A run of anomalous fixes close together in time — what the farmer actually cares about. */
export type AnomalyEvent = {
  deviceId: number;
  deviceName: string;
  start: string;
  end: string;
  points: number;
  /** Furthest the device strayed from its usual position during the event, metres. */
  maxOffsetM: number;
  lat: number;
  lng: number;
};

export type Member = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
  farmIds: string[];
};

export type ScanSubject = "crop" | "livestock" | "soil" | "other";

export type Insight = {
  title: string;
  condition: "healthy" | "stressed" | "diseased" | "pest" | "injured" | "unknown";
  urgency: "low" | "medium" | "high";
  confidence: number;
  summary: string;
  findings: string[];
  actions: string[];
  classifier?: { label: string; score: number }[];
};

export type Scan = {
  id: string;
  user_id: string;
  farm_id: string | null;
  subject: ScanSubject;
  note: string | null;
  status: "pending" | "done" | "failed";
  model: string | null;
  result: Insight | null;
  error: string | null;
  created_at: string;
  imageUrl: string | null;
};

export type MlModel = {
  name: string;
  algorithm: string;
  device_ids: number[];
  metrics: Record<string, number | string>;
  trained_at: string;
};

export type MlJob = {
  id: string;
  kind: "train" | "monitor";
  status: "queued" | "running" | "done" | "failed";
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};
