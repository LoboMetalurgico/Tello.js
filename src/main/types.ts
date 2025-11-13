export interface TelloState {
  pitch: number;
  roll: number;
  yaw: number;
  vgx: number;
  vgy: number;
  vgz: number;
  templ: number;
  temph: number;
  tof: number;
  h: number;
  bat: number;
  baro: number;
  time: number;
  agx: number;
  agy: number;
  agz: number;
}

export interface CommandResponse {
  success: boolean;
  message: string;
}
