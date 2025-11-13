import { TelloState } from '../types';

export function parseState(stateStr: string): TelloState {
  const entries = stateStr
    .trim()
    .split(';')
    .filter(Boolean)
    .map((pair) => pair.split(':'));

  const obj: Partial<TelloState> = {};
  for (const [key, value] of entries) {
    obj[key as keyof TelloState] = Number(value);
  }

  return obj as TelloState;
}
