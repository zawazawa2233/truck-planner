export type FuelBrand = 'EW' | 'USAMI' | 'BOTH';

export type RestStyle = 'SINGLE_30' | 'MULTI_10';

export type FacilityTypeFilter = {
  saPa: boolean;
  expresswayRest: boolean;
  michiNoEki: boolean;
};

export type FacilityEquipmentFilter = {
  shower: boolean;
  open24h: boolean;
  convenience: boolean;
  largeParking: boolean;
};

export type PlanRequest = {
  mapUrl: string;
  departAtIso: string;
  extraWaypoints?: string[];
  includeRouteDetails?: boolean;
  allowExtendedDrive: boolean;
  restStyle: RestStyle;
  facilityTypes: FacilityTypeFilter;
  equipment: FacilityEquipmentFilter;
  fuelBrand: FuelBrand;
  prioritizeHighwayStations: boolean;
  fuelRangeKm?: number;
  fuelRangePreset?: 50 | 100 | 150 | 200;
};

export type RoutePoint = {
  lat: number;
  lng: number;
  cumulativeDistanceKm: number;
  cumulativeDurationMin: number;
};

export type RouteSummary = {
  origin: string;
  destination: string;
  waypoints: string[];
  totalDistanceKm: number;
  totalDurationMin: number;
  polyline: string;
  points: RoutePoint[];
};

export type StopCandidate = {
  id: string;
  kind: 'REST' | 'FUEL';
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: 'OSM' | 'GOOGLE' | 'MASTER';
  isHighway: boolean;
  distanceFromRouteKm: number;
  distanceFromStartKm: number;
  etaIso: string;
  equipment: {
    shower: boolean;
    open24h: boolean;
    convenience: boolean;
    largeParking: boolean;
  };
  tags: string[];
  brand?: 'EW' | 'USAMI';
};

export type RestWindow = {
  windowId: number;
  targetDriveLimitMin: number;
  startAfterMin: number;
  endByMin: number;
  targetBreakMin: number;
  etaIso: string;
  primaryCandidates: StopCandidate[];
  backupCandidates: StopCandidate[];
};

export type PlanResponse = {
  status: 'ok' | 'fallback';
  warnings: string[];
  extractedRouteInput: {
    finalExpandedUrl: string;
    origin: string;
    destination: string;
    waypoints: string[];
  };
  route: RouteSummary;
  restWindows: RestWindow[];
  fuelCandidates: StopCandidate[];
};
