export type QuaternionEditorMode = 'euler' | 'quat' | 'axis';
export type QuaternionField = 'x' | 'y' | 'z' | 'w';
export type VectorField = 'x' | 'y' | 'z';
export type AxisAngleField = VectorField | 'angle';

export interface QuaternionFields {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface EulerDegFields {
  x: number;
  y: number;
  z: number;
}

export interface AxisAngleFields {
  x: number;
  y: number;
  z: number;
  angle: number;
}

export interface QuaternionEditorState {
  quat: QuaternionFields;
  eulerDeg: EulerDegFields;
  axisAngle: AxisAngleFields;
}
