/**
 * Shared types untuk frontend components.
 */

export type Role = 'operator' | 'supervisor' | 'manager';

export const ROLES: Role[] = ['operator', 'supervisor', 'manager'];

export interface SessionUser {
  id:    string;
  email: string;
  name:  string;
  role:  Role;
}

export interface InspectionRow {
  id:           number;
  object_name:  string | null;
  dimension_mm: number;
  width_mm:     number | null;
  confidence:   number | null;
  status:       'GOOD' | 'NOT GOOD';
  timestamp:    string; // ISO
}

export interface UserRow {
  id:        string;
  email:     string;
  name:      string | null;
  role:      Role;
  edge_url:  string | null;
  createdAt: string;
}

export interface InspectionStats {
  total:    number;
  good:     number;
  notGood:  number;
  goodPct:  number;
  ngPct:    number;
}
